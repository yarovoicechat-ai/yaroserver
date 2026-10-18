import axios, { AxiosError } from 'axios';
import mongoose from 'mongoose';
import { AgoraProject } from '../../models/agoraProject.model';
import { AgoraUsageSnapshot } from '../../models/agoraUsage.model';
import { AgoraConfigurationAuditLog } from '../../models/agoraAudit.model';

export interface ProviderSyncResult {
  status: 'SYNCHRONIZED' | 'PENDING_EXTERNAL_PROVIDER_VERIFICATION' | 'FAILED';
  month: string;
  projectsSynced: number;
  totalOfficialUnits: number;
  errors?: string[];
  message: string;
  syncedAt: Date;
}

/**
 * Service responsible for official Agora REST API usage synchronization.
 * Uses official dev/v3/usage/total endpoint with HTTP Basic Authentication.
 * Strictly separates internal session minutes from official provider billable units.
 * Never logs credentials or exposes secret headers.
 */
export class AgoraProviderSyncService {
  private static readonly AGORA_USAGE_API_BASE = 'https://api.agora.io/dev/v3/usage/total';
  private static isSyncInProgress = false;

  /**
   * Retrieves Agora REST API Basic Auth credentials from environment.
   */
  private static getCustomerCredentials(): { customerId: string; customerSecret: string } | null {
    const customerId = (
      process.env.AGORA_CUSTOMER_ID ||
      process.env.AGORA_REST_API_KEY ||
      ''
    ).trim();

    const customerSecret = (
      process.env.AGORA_CUSTOMER_SECRET ||
      process.env.AGORA_REST_API_SECRET ||
      ''
    ).trim();

    if (!customerId || !customerSecret) {
      return null;
    }

    return { customerId, customerSecret };
  }

  /**
   * Returns current provider synchronization status across all projects.
   */
  static async getProviderSyncStatus(month?: string) {
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    const credentials = this.getCustomerCredentials();
    const isDbConnected = mongoose.connection.readyState === 1;
    const snapshots = isDbConnected
      ? await AgoraUsageSnapshot.find({ month: targetMonth }).lean()
      : [];

    return {
      month: targetMonth,
      hasCredentialsConfigured: Boolean(credentials),
      providerApiEndpoint: this.AGORA_USAGE_API_BASE,
      authMethod: 'HTTP Basic Auth (Customer ID : Customer Secret)',
      prerequisitesMet: Boolean(credentials),
      status: credentials ? 'CONFIGURED' : 'PENDING_EXTERNAL_PROVIDER_VERIFICATION',
      requiredEnvironmentVariables: [
        'AGORA_CUSTOMER_ID',
        'AGORA_CUSTOMER_SECRET',
      ],
      snapshotsCount: snapshots.length,
      lastSyncTimestamp: snapshots[0]?.officialSyncAt || null,
      officialSyncStatus: snapshots[0]?.officialSyncStatus || 'PENDING_PROVIDER_SYNC',
    };
  }

  /**
   * Synchronizes official usage data from Agora REST API.
   * If credentials are unavailable, idempotently records PENDING status without fabricating data.
   */
  static async syncOfficialUsage(
    targetMonth = new Date().toISOString().slice(0, 7),
    actorName = 'System Scheduler',
    actorRole = 'system'
  ): Promise<ProviderSyncResult> {
    const credentials = this.getCustomerCredentials();

    if (!credentials) {
      // Mark snapshots with pending status and record missing prerequisite reason if DB connected
      if (mongoose.connection.readyState === 1) {
        await AgoraUsageSnapshot.updateMany(
          { month: targetMonth },
          {
            $set: {
              officialSyncStatus: 'PENDING_PROVIDER_SYNC',
              usageSource: 'INTERNAL_SESSION_TRACKING',
              officialSyncError:
                'Prerequisite missing: AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET required for Agora dev/v3/usage/total REST API.',
              lastSynchronizedAt: new Date(),
            },
          }
        );
      }

      return {
        status: 'PENDING_EXTERNAL_PROVIDER_VERIFICATION',
        month: targetMonth,
        projectsSynced: 0,
        totalOfficialUnits: 0,
        message:
          'Provider synchronization pending: AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET are not defined in the environment. Internal call minutes are retained separately.',
        syncedAt: new Date(),
      };
    }

    if (this.isSyncInProgress) {
      return {
        status: 'FAILED',
        month: targetMonth,
        projectsSynced: 0,
        totalOfficialUnits: 0,
        message:
          'Provider synchronization is already in progress. Please wait for current operation to complete.',
        syncedAt: new Date(),
      };
    }

    this.isSyncInProgress = true;
    try {
      const projects = await AgoraProject.find({ isEnabled: true }).lean();
      if (projects.length === 0) {
        return {
          status: 'SYNCHRONIZED',
          month: targetMonth,
          projectsSynced: 0,
          totalOfficialUnits: 0,
          message: 'No enabled Agora projects found to synchronize.',
          syncedAt: new Date(),
        };
      }

      // Determine date range for target month
      const [year, monthNum] = targetMonth.split('-').map(Number);
      const startDate = `${targetMonth}-01`;
      const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
      const endDate = `${targetMonth}-${String(lastDay).padStart(2, '0')}`;

      const authHeader = `Basic ${Buffer.from(`${credentials.customerId}:${credentials.customerSecret}`).toString('base64')}`;

      let syncedCount = 0;
      let totalBilledUnits = 0;
      const syncErrors: string[] = [];

      for (const project of projects) {
        try {
          const officialUnits = await this.fetchWithRetry(
            project.appId,
            startDate,
            endDate,
            authHeader
          );

          await AgoraUsageSnapshot.findOneAndUpdate(
            { projectId: project._id, month: targetMonth },
            {
              $set: {
                appId: project.appId,
                officialBilledUnits: officialUnits,
                officialSyncStatus: 'SYNCHRONIZED',
                officialSyncAt: new Date(),
                officialSyncError: null,
                usageSource: 'AGORA_REST_API',
                lastSynchronizedAt: new Date(),
              },
            },
            { upsert: true, new: true }
          );

          syncedCount++;
          totalBilledUnits += officialUnits;
        } catch (err: any) {
          const safeErrorMsg = err?.message || 'Agora API request error';
          syncErrors.push(`Project ${project.name} (${project.appId}): ${safeErrorMsg}`);

          await AgoraUsageSnapshot.findOneAndUpdate(
            { projectId: project._id, month: targetMonth },
            {
              $set: {
                officialSyncError: safeErrorMsg,
                lastSynchronizedAt: new Date(),
              },
            }
          );
        }
      }

      await AgoraConfigurationAuditLog.create({
        action: 'UPDATE_PROJECT',
        projectName: 'All Projects',
        actorName,
        actorRole,
        changes: {
          action: 'OFFICIAL_PROVIDER_SYNC',
          targetMonth,
          syncedCount,
          totalBilledUnits,
          hasErrors: syncErrors.length > 0,
        },
      });

      return {
        status: syncErrors.length === 0 ? 'SYNCHRONIZED' : 'FAILED',
        month: targetMonth,
        projectsSynced: syncedCount,
        totalOfficialUnits: totalBilledUnits,
        errors: syncErrors.length > 0 ? syncErrors : undefined,
        message:
          syncErrors.length === 0
            ? `Successfully synchronized official Agora usage for ${syncedCount} projects.`
            : `Synchronization completed with ${syncErrors.length} errors.`,
        syncedAt: new Date(),
      };
    } finally {
      this.isSyncInProgress = false;
    }
  }

  /**
   * Helper that calls official Agora API dev/v3/usage/total with exponential backoff and rate limit handling.
   */
  private static async fetchWithRetry(
    appId: string,
    startDate: string,
    endDate: string,
    authHeader: string,
    maxRetries = 3
  ): Promise<number> {
    let attempt = 0;
    let delay = 1000;

    while (attempt < maxRetries) {
      attempt++;
      try {
        const response = await axios.get(this.AGORA_USAGE_API_BASE, {
          params: {
            project_id: appId,
            date_from: startDate,
            date_to: endDate,
            business: 'rtc',
          },
          headers: {
            Authorization: authHeader,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        });

        if (response.data && response.data.code === 200 && Array.isArray(response.data.data)) {
          let totalMinutes = 0;
          for (const dayEntry of response.data.data) {
            if (Array.isArray(dayEntry.usage)) {
              for (const u of dayEntry.usage) {
                totalMinutes += Number(u.duration || 0);
              }
            }
          }
          return Math.round(totalMinutes);
        }

        return 0;
      } catch (err: any) {
        const status = (err as AxiosError)?.response?.status;
        // Rate limit (429) or transient server error (500, 502, 503)
        if ((status === 429 || (status && status >= 500)) && attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }
        throw new Error(err?.response?.data?.message || err?.message || 'Agora Usage API error');
      }
    }

    return 0;
  }
}
