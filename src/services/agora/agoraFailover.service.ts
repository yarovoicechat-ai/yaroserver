import mongoose, { Types } from 'mongoose';
import { AgoraProject } from '../../models/agoraProject.model';
import { ActiveAgoraConfiguration } from '../../models/agoraConfig.model';
import { AgoraUsageSnapshot } from '../../models/agoraUsage.model';
import { AgoraSwitchHistory, AgoraConfigurationAuditLog } from '../../models/agoraAudit.model';
import { AgoraProjectService } from './agoraProject.service';

export class AgoraFailoverService {
  private static isEvaluating = false;

  /**
   * Evaluates whether the given project (or current active project) has reached its switching threshold.
   */
  static async evaluateProjectUsage(projectId?: Types.ObjectId | string): Promise<{ switched: boolean; reason?: string; newProjectId?: string }> {
    if (this.isEvaluating) return { switched: false, reason: 'Evaluation in progress' };
    this.isEvaluating = true;

    try {
      const activeConfig = await AgoraProjectService.ensureActiveConfiguration();
      if (activeConfig.switchingMode !== 'automatic') {
        return { switched: false, reason: 'Automatic switching is disabled (Manual mode active).' };
      }

      const targetProjectId = projectId || activeConfig.activeProjectId;
      if (!targetProjectId) {
        return { switched: false, reason: 'No active project configured.' };
      }

      // Check Cooldown
      if (activeConfig.lastSwitchedAt && activeConfig.cooldownMinutes > 0) {
        const cooldownMs = activeConfig.cooldownMinutes * 60 * 1000;
        const elapsedMs = Date.now() - new Date(activeConfig.lastSwitchedAt).getTime();
        if (elapsedMs < cooldownMs) {
          const remainingMinutes = Math.ceil((cooldownMs - elapsedMs) / 60000);
          return { switched: false, reason: `Switch cooldown active (${remainingMinutes} mins remaining).` };
        }
      }

      const currentMonth = new Date().toISOString().slice(0, 7);
      const project = await AgoraProject.findById(targetProjectId);
      if (!project) return { switched: false, reason: 'Project not found.' };

      const snapshot = await AgoraUsageSnapshot.findOne({
        projectId: project._id,
        month: currentMonth,
      });

      const totalMinutes = snapshot ? snapshot.totalAppCallMinutes : 0;
      const budget = project.monthlyUsageBudgetMinutes || 10000;
      const thresholdPercent = project.switchingThresholdPercent || activeConfig.switchingThresholdPercent || 85;
      const thresholdMinutes = (budget * thresholdPercent) / 100;

      // Check if threshold is reached
      if (totalMinutes < thresholdMinutes) {
        return { switched: false, reason: `Usage (${totalMinutes}m) is below threshold (${thresholdMinutes}m / ${thresholdPercent}%).` };
      }

      console.warn(`⚡ [AgoraFailover] Project ${project.name} reached ${thresholdPercent}% threshold (${totalMinutes}/${budget} min). Initiating failover...`);

      // Find best available standby project
      const candidate = await AgoraProject.findOne({
        _id: { $ne: project._id },
        isEnabled: true,
        validationStatus: 'VALID',
        status: { $in: ['standby', 'active'] },
      }).sort({ priority: 1, createdAt: 1 });

      if (!candidate) {
        console.error(`🚨 [AgoraFailover] FAILOVER BLOCKED: No validated standby Agora project available!`);
        await AgoraConfigurationAuditLog.create({
          action: 'UPDATE_POLICY',
          projectId: project._id,
          projectName: project.name,
          actorName: 'Failover Automator',
          actorRole: 'system',
          changes: {
            warning: 'Threshold exceeded but no healthy standby candidate available.',
            totalMinutes,
            budget,
          },
        });
        return { switched: false, reason: 'Threshold exceeded but no eligible standby project found.' };
      }

      // Atomic project switch
      const switchReason = `Automatic failover: Project "${project.name}" reached ${thresholdPercent}% usage limit (${totalMinutes}/${budget} min).`;
      
      const previousId = project._id;
      project.status = 'standby';
      await project.save();

      candidate.status = 'active';
      await candidate.save();

      activeConfig.previousProjectId = previousId;
      activeConfig.activeProjectId = candidate._id;
      activeConfig.lastSwitchedAt = new Date();
      activeConfig.lastSwitchReason = switchReason;
      activeConfig.configVersion += 1;
      await activeConfig.save();

      // Record in Switch History
      await AgoraSwitchHistory.create({
        fromProjectId: previousId,
        fromProjectName: project.name,
        toProjectId: candidate._id,
        toProjectName: candidate.name,
        toAppId: candidate.appId,
        reason: switchReason,
        triggerType: 'AUTOMATIC_THRESHOLD',
        status: 'SUCCESS',
        usageSnapshotAtSwitch: {
          minutesUsed: totalMinutes,
          budgetMinutes: budget,
          usagePercent: Math.round((totalMinutes / budget) * 100),
        },
      });

      // Audit Log
      await AgoraConfigurationAuditLog.create({
        action: 'ACTIVATE_PROJECT',
        projectId: candidate._id,
        projectName: candidate.name,
        actorName: 'Automatic Failover System',
        actorRole: 'system',
        changes: {
          fromProjectId: previousId,
          toProjectId: candidate._id,
          reason: switchReason,
          configVersion: activeConfig.configVersion,
        },
      });

      console.log(`✅ [AgoraFailover] Successfully switched active Agora project to "${candidate.name}" (${candidate.appId})`);
      return {
        switched: true,
        reason: switchReason,
        newProjectId: String(candidate._id),
      };
    } catch (err: any) {
      console.error('[AgoraFailover] Failover error:', err);
      return { switched: false, reason: err?.message || 'Failover failed' };
    } finally {
      this.isEvaluating = false;
    }
  }

  /**
   * Updates switching policy parameters.
   */
  static async updateSwitchingPolicy(params: {
    switchingMode?: 'automatic' | 'manual';
    warningThresholdPercent?: number;
    switchingThresholdPercent?: number;
    criticalThresholdPercent?: number;
    hardLimitPercent?: number;
    cooldownMinutes?: number;
    safetyBufferMinutes?: number;
    safePolicyOnDataStale?: 'stay_on_current' | 'switch_to_standby' | 'alert_only';
  }, actor?: { id: any; name: string; role: string }) {
    const config = await AgoraProjectService.ensureActiveConfiguration();

    const changes: Record<string, any> = {};

    if (params.switchingMode) {
      changes.switchingMode = { from: config.switchingMode, to: params.switchingMode };
      config.switchingMode = params.switchingMode;
    }
    if (typeof params.warningThresholdPercent === 'number') {
      changes.warningThresholdPercent = params.warningThresholdPercent;
      config.warningThresholdPercent = params.warningThresholdPercent;
    }
    if (typeof params.switchingThresholdPercent === 'number') {
      changes.switchingThresholdPercent = params.switchingThresholdPercent;
      config.switchingThresholdPercent = params.switchingThresholdPercent;
    }
    if (typeof params.criticalThresholdPercent === 'number') {
      changes.criticalThresholdPercent = params.criticalThresholdPercent;
      config.criticalThresholdPercent = params.criticalThresholdPercent;
    }
    if (typeof params.hardLimitPercent === 'number') {
      changes.hardLimitPercent = params.hardLimitPercent;
      config.hardLimitPercent = params.hardLimitPercent;
    }
    if (typeof params.cooldownMinutes === 'number') {
      changes.cooldownMinutes = params.cooldownMinutes;
      config.cooldownMinutes = params.cooldownMinutes;
    }
    if (typeof params.safetyBufferMinutes === 'number') {
      changes.safetyBufferMinutes = params.safetyBufferMinutes;
      config.safetyBufferMinutes = params.safetyBufferMinutes;
    }
    if (params.safePolicyOnDataStale) {
      changes.safePolicyOnDataStale = params.safePolicyOnDataStale;
      config.safePolicyOnDataStale = params.safePolicyOnDataStale;
    }

    config.updatedBy = actor?.id || null;
    await config.save();

    await AgoraConfigurationAuditLog.create({
      action: 'UPDATE_POLICY',
      actorId: actor?.id || null,
      actorName: actor?.name || 'Admin',
      actorRole: actor?.role || 'admin',
      changes,
    });

    return config;
  }
}
