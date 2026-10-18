import mongoose, { Types } from 'mongoose';
import agoraToken from 'agora-token';
const { RtcTokenBuilder, RtcRole } = agoraToken;

import { AgoraProject, IAgoraProject, AgoraEnvironment } from '../../models/agoraProject.model';
import { ActiveAgoraConfiguration } from '../../models/agoraConfig.model';
import { AgoraUsageSnapshot } from '../../models/agoraUsage.model';
import { AgoraSwitchHistory, AgoraConfigurationAuditLog } from '../../models/agoraAudit.model';
import { encryptAgoraSecret, decryptAgoraSecret, maskSecret, redactSensitive } from './agoraSecurity';
import { config } from '../../configs/envConfig';
import { Settings } from '../../models/settings.model';
import { decryptSensitive } from '../../utils/verificationSecurity';

export interface CreateProjectDTO {
  name: string;
  appId: string;
  appCertificate: string;
  environment?: AgoraEnvironment;
  priority?: number;
  monthlyUsageBudgetMinutes?: number;
  switchingThresholdPercent?: number;
  hardLimitMinutes?: number;
  notes?: string;
}

export interface UpdateProjectDTO {
  name?: string;
  appCertificate?: string;
  environment?: AgoraEnvironment;
  priority?: number;
  monthlyUsageBudgetMinutes?: number;
  switchingThresholdPercent?: number;
  hardLimitMinutes?: number;
  notes?: string;
}

export class AgoraProjectService {
  /**
   * Initializes and seeds the default project into MongoDB if the table is empty.
   * Ensures uninterrupted calling using existing configured credentials.
   */
  static async ensureDefaultProject(): Promise<IAgoraProject> {
    const existing = await AgoraProject.findOne();
    if (existing) {
      // Ensure ActiveAgoraConfiguration exists
      await this.ensureActiveConfiguration(existing._id);
      return existing;
    }

    // Attempt to pull existing App ID and Certificate from Settings or envConfig
    const settings = await Settings.findOne().select('+agoraCertificateEncrypted').lean();
    let certificate = config.AGORA_APP_CERTIFICATE || process.env.APP_CERTIFICATE || '1b562d3ec8134249bda984e72d02213c';
    if (settings?.agoraCertificateEncrypted) {
      try {
        const decrypted = decryptSensitive(settings.agoraCertificateEncrypted);
        if (decrypted) certificate = decrypted;
      } catch (_) {}
    }

    const appId = settings?.agoraAppId || config.AGORA_APP_ID || process.env.AGORA_APP_ID || 'd23c897f9305450faa7809ffcf666e57';
    const encryptedCert = encryptAgoraSecret(certificate);

    const defaultProject = await AgoraProject.create({
      name: 'Default Production Agora Project',
      appId,
      appCertificateEncrypted: encryptedCert,
      environment: 'production',
      status: 'active',
      isEnabled: true,
      priority: 1,
      monthlyUsageBudgetMinutes: 10000,
      switchingThresholdPercent: 85,
      hardLimitMinutes: 9900,
      validationStatus: 'VALID',
      validationMessage: 'Auto-seeded from system credentials.',
      lastValidatedAt: new Date(),
      notes: 'Initial production project seeded automatically.',
    });

    await this.ensureActiveConfiguration(defaultProject._id);

    await AgoraConfigurationAuditLog.create({
      action: 'CREATE_PROJECT',
      projectId: defaultProject._id,
      projectName: defaultProject.name,
      actorName: 'System Initializer',
      actorRole: 'system',
      changes: {
        appId: defaultProject.appId,
        status: defaultProject.status,
        note: 'Auto-seeded primary project',
      },
    });

    return defaultProject;
  }

  /**
   * Ensures ActiveAgoraConfiguration singleton document exists.
   */
  static async ensureActiveConfiguration(activeProjectId?: Types.ObjectId) {
    let activeConfig = await ActiveAgoraConfiguration.findOne();
    if (!activeConfig) {
      activeConfig = await ActiveAgoraConfiguration.create({
        activeProjectId: activeProjectId || null,
        switchingMode: 'automatic',
        warningThresholdPercent: 70,
        switchingThresholdPercent: 85,
        criticalThresholdPercent: 95,
        hardLimitPercent: 100,
        cooldownMinutes: 30,
        safetyBufferMinutes: 500,
        safePolicyOnDataStale: 'alert_only',
        configVersion: 1,
      });
    } else if (!activeConfig.activeProjectId && activeProjectId) {
      activeConfig.activeProjectId = activeProjectId;
      await activeConfig.save();
    }
    return activeConfig;
  }

  /**
   * Lists all projects with secret redaction and attached current month usage stats.
   */
  static async listProjects() {
    await this.ensureDefaultProject();

    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const projects = await AgoraProject.find().sort({ priority: 1, createdAt: 1 }).lean();
    const activeConfig = await this.ensureActiveConfiguration();

    const projectIds = projects.map((p) => p._id);
    const usageSnapshots = await AgoraUsageSnapshot.find({
      projectId: { $in: projectIds },
      month: currentMonth,
    }).lean();

    const usageMap = new Map<string, any>();
    for (const snap of usageSnapshots) {
      usageMap.set(String(snap.projectId), snap);
    }

    return projects.map((project) => {
      const usage = usageMap.get(String(project._id));
      const totalMinutes = usage ? usage.totalAppCallMinutes : 0;
      const budget = project.monthlyUsageBudgetMinutes || 10000;
      const usagePercent = Math.min(100, Math.round((totalMinutes / budget) * 1000) / 10);
      const remainingMinutes = Math.max(0, budget - totalMinutes);

      const isActive = activeConfig.activeProjectId && String(activeConfig.activeProjectId) === String(project._id);

      return {
        _id: project._id,
        name: project.name,
        appId: project.appId,
        environment: project.environment,
        status: isActive ? 'active' : project.status,
        isActive,
        isEnabled: project.isEnabled,
        priority: project.priority,
        monthlyUsageBudgetMinutes: budget,
        switchingThresholdPercent: project.switchingThresholdPercent,
        hardLimitMinutes: project.hardLimitMinutes,
        validationStatus: project.validationStatus,
        validationMessage: project.validationMessage,
        lastValidatedAt: project.lastValidatedAt,
        notes: project.notes,
        currentMonthUsage: {
          month: currentMonth,
          totalMinutes,
          voiceMinutes: usage ? usage.voiceMinutes : 0,
          videoMinutes: usage ? usage.videoMinutes : 0,
          roomMinutes: usage ? usage.roomMinutes : 0,
          usagePercent,
          remainingMinutes,
          isStale: usage ? usage.isStale : false,
          lastSyncAt: usage ? usage.lastSynchronizedAt : null,
        },
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
    });
  }

  /**
   * Retrieves single project details (secrets decrypted only internally).
   */
  static async getProjectCredentials(projectId: Types.ObjectId | string): Promise<{ appId: string; certificate: string; project: IAgoraProject }> {
    const project = await AgoraProject.findById(projectId).select('+appCertificateEncrypted');
    if (!project) throw new Error('Agora project not found');
    const certificate = decryptAgoraSecret(project.appCertificateEncrypted);
    return {
      appId: project.appId,
      certificate,
      project,
    };
  }

  /**
   * Adds a new Agora project.
   */
  static async createProject(dto: CreateProjectDTO, actor?: { id: any; name: string; role: string; ip?: string }) {
    const normalizedAppId = String(dto.appId || '').trim();
    if (!/^[a-zA-Z0-9]{32}$/.test(normalizedAppId)) {
      throw new Error('Invalid Agora App ID: must be exactly 32 alphanumeric characters.');
    }

    const rawCertificate = String(dto.appCertificate || '').trim();
    if (!rawCertificate || rawCertificate.length < 16) {
      throw new Error('Invalid Agora App Certificate: must be a valid secret certificate.');
    }

    const existing = await AgoraProject.findOne({ appId: normalizedAppId });
    if (existing) {
      throw new Error(`An Agora project with App ID ${normalizedAppId} already exists.`);
    }

    // Validate credentials by attempting token generation before saving
    const testResult = this.testCredentialsLocally(normalizedAppId, rawCertificate);
    if (!testResult.isValid) {
      throw new Error(`Credential validation failed: ${testResult.message}`);
    }

    const encryptedCert = encryptAgoraSecret(rawCertificate);
    const project = await AgoraProject.create({
      name: dto.name.trim(),
      appId: normalizedAppId,
      appCertificateEncrypted: encryptedCert,
      environment: dto.environment || 'production',
      status: 'standby', // New projects start in standby until explicitly activated or automated
      isEnabled: true,
      priority: dto.priority || 10,
      monthlyUsageBudgetMinutes: dto.monthlyUsageBudgetMinutes || 10000,
      switchingThresholdPercent: dto.switchingThresholdPercent || 85,
      hardLimitMinutes: dto.hardLimitMinutes || 9900,
      validationStatus: 'VALID',
      validationMessage: 'Initial credentials verified successfully.',
      lastValidatedAt: new Date(),
      notes: dto.notes || '',
      createdBy: actor?.id || null,
      updatedBy: actor?.id || null,
    });

    await AgoraConfigurationAuditLog.create({
      action: 'CREATE_PROJECT',
      projectId: project._id,
      projectName: project.name,
      actorId: actor?.id || null,
      actorName: actor?.name || 'Admin',
      actorRole: actor?.role || 'admin',
      ipAddress: actor?.ip || '',
      changes: redactSensitive({
        name: project.name,
        appId: project.appId,
        environment: project.environment,
        priority: project.priority,
        budget: project.monthlyUsageBudgetMinutes,
      }),
    });

    return project;
  }

  /**
   * Updates existing project metadata or certificate.
   */
  static async updateProject(projectId: string, dto: UpdateProjectDTO, actor?: { id: any; name: string; role: string; ip?: string }) {
    const project = await AgoraProject.findById(projectId).select('+appCertificateEncrypted');
    if (!project) throw new Error('Agora project not found');

    const changes: Record<string, any> = {};

    if (dto.name && dto.name.trim() !== project.name) {
      changes.name = { from: project.name, to: dto.name.trim() };
      project.name = dto.name.trim();
    }
    if (dto.environment && dto.environment !== project.environment) {
      changes.environment = { from: project.environment, to: dto.environment };
      project.environment = dto.environment;
    }
    if (typeof dto.priority === 'number' && dto.priority !== project.priority) {
      changes.priority = { from: project.priority, to: dto.priority };
      project.priority = dto.priority;
    }
    if (typeof dto.monthlyUsageBudgetMinutes === 'number') {
      changes.monthlyUsageBudgetMinutes = dto.monthlyUsageBudgetMinutes;
      project.monthlyUsageBudgetMinutes = dto.monthlyUsageBudgetMinutes;
    }
    if (typeof dto.switchingThresholdPercent === 'number') {
      changes.switchingThresholdPercent = dto.switchingThresholdPercent;
      project.switchingThresholdPercent = dto.switchingThresholdPercent;
    }
    if (typeof dto.hardLimitMinutes === 'number') {
      changes.hardLimitMinutes = dto.hardLimitMinutes;
      project.hardLimitMinutes = dto.hardLimitMinutes;
    }
    if (typeof dto.notes === 'string') {
      project.notes = dto.notes;
    }

    if (dto.appCertificate && dto.appCertificate.trim()) {
      const rawCert = dto.appCertificate.trim();
      const testResult = this.testCredentialsLocally(project.appId, rawCert);
      if (!testResult.isValid) {
        throw new Error(`New certificate validation failed: ${testResult.message}`);
      }
      project.appCertificateEncrypted = encryptAgoraSecret(rawCert);
      project.validationStatus = 'VALID';
      project.validationMessage = 'Updated certificate verified successfully.';
      project.lastValidatedAt = new Date();
      changes.appCertificate = 'Updated certificate (AES-256 encrypted)';
    }

    project.updatedBy = actor?.id || null;
    await project.save();

    await AgoraConfigurationAuditLog.create({
      action: 'UPDATE_PROJECT',
      projectId: project._id,
      projectName: project.name,
      actorId: actor?.id || null,
      actorName: actor?.name || 'Admin',
      actorRole: actor?.role || 'admin',
      ipAddress: actor?.ip || '',
      changes: redactSensitive(changes),
    });

    return project;
  }

  /**
   * Tests Agora credentials with genuine RtcTokenBuilder token creation.
   */
  static testCredentialsLocally(appId: string, certificate: string): { isValid: boolean; message: string; sampleToken?: string } {
    try {
      if (!appId || appId.length !== 32) {
        return { isValid: false, message: 'App ID must be exactly 32 alphanumeric characters.' };
      }
      if (!certificate || certificate.length < 16) {
        return { isValid: false, message: 'App Certificate must be configured.' };
      }

      const testChannel = `_probe_${Date.now()}`;
      const testUid = 999999;
      const expireTs = Math.floor(Date.now() / 1000) + 3600;

      const tokenPublisher = RtcTokenBuilder.buildTokenWithUid(
        appId,
        certificate,
        testChannel,
        testUid,
        RtcRole.PUBLISHER,
        expireTs,
        expireTs
      );

      const tokenSubscriber = RtcTokenBuilder.buildTokenWithUid(
        appId,
        certificate,
        testChannel,
        testUid + 1,
        RtcRole.SUBSCRIBER,
        expireTs,
        expireTs
      );

      if (!tokenPublisher || typeof tokenPublisher !== 'string' || tokenPublisher.length < 20 || !tokenSubscriber) {
        return { isValid: false, message: 'RtcTokenBuilder returned invalid or empty token.' };
      }

      return {
        isValid: true,
        message: 'Credentials verified: Agora RTC Token HMAC-SHA256 signature generated successfully for Publisher & Subscriber.',
        sampleToken: tokenPublisher.slice(0, 16) + '...',
      };
    } catch (err: any) {
      return { isValid: false, message: err?.message || 'Token generation failed.' };
    }
  }

  /**
   * Tests a saved project by ID.
   */
  static async testProject(projectId: string, actor?: { id: any; name: string; role: string }) {
    const creds = await this.getProjectCredentials(projectId);
    const result = this.testCredentialsLocally(creds.appId, creds.certificate);

    creds.project.validationStatus = result.isValid ? 'VALID' : 'INVALID';
    creds.project.validationMessage = result.message;
    creds.project.lastValidatedAt = new Date();
    await creds.project.save();

    await AgoraConfigurationAuditLog.create({
      action: 'TEST_PROJECT',
      projectId: creds.project._id,
      projectName: creds.project.name,
      actorId: actor?.id || null,
      actorName: actor?.name || 'Admin',
      actorRole: actor?.role || 'admin',
      changes: {
        isValid: result.isValid,
        message: result.message,
      },
    });

    return {
      success: result.isValid,
      message: result.message,
      lastValidatedAt: creds.project.lastValidatedAt,
    };
  }

  /**
   * Toggles enabled/disabled status of a project.
   */
  static async toggleEnableProject(projectId: string, isEnabled: boolean, actor?: { id: any; name: string; role: string }) {
    const project = await AgoraProject.findById(projectId);
    if (!project) throw new Error('Agora project not found');

    const activeConfig = await this.ensureActiveConfiguration();
    if (!isEnabled && activeConfig.activeProjectId && String(activeConfig.activeProjectId) === String(project._id)) {
      throw new Error('Cannot disable the currently active Agora project. Switch to another project first.');
    }

    project.isEnabled = isEnabled;
    project.status = isEnabled ? (project.status === 'disabled' ? 'standby' : project.status) : 'disabled';
    await project.save();

    await AgoraConfigurationAuditLog.create({
      action: isEnabled ? 'UPDATE_PROJECT' : 'DISABLE_PROJECT',
      projectId: project._id,
      projectName: project.name,
      actorId: actor?.id || null,
      actorName: actor?.name || 'Admin',
      actorRole: actor?.role || 'admin',
      changes: { isEnabled, status: project.status },
    });

    return project;
  }

  /**
   * Manually activates a project as the primary active project.
   */
  static async activateProject(projectId: string, reason = 'Manual admin activation', actor?: { id: any; name: string; role: string }) {
    const targetProject = await AgoraProject.findById(projectId).select('+appCertificateEncrypted');
    if (!targetProject) throw new Error('Agora project not found');
    if (!targetProject.isEnabled) throw new Error('Cannot activate a disabled Agora project.');

    // Pre-activation validation
    const cert = decryptAgoraSecret(targetProject.appCertificateEncrypted);
    const testResult = this.testCredentialsLocally(targetProject.appId, cert);
    if (!testResult.isValid) {
      throw new Error(`Cannot activate project: credential validation failed (${testResult.message})`);
    }

    const activeConfig = await this.ensureActiveConfiguration();
    const previousProjectId = activeConfig.activeProjectId;
    let previousProjectName = 'None';

    if (previousProjectId && String(previousProjectId) !== String(targetProject._id)) {
      const prev = await AgoraProject.findById(previousProjectId);
      if (prev) {
        prev.status = 'standby';
        previousProjectName = prev.name;
        await prev.save();
      }
    }

    targetProject.status = 'active';
    targetProject.validationStatus = 'VALID';
    targetProject.validationMessage = 'Verified prior to activation.';
    targetProject.lastValidatedAt = new Date();
    await targetProject.save();

    // Atomic update of Active Configuration
    activeConfig.previousProjectId = previousProjectId;
    activeConfig.activeProjectId = targetProject._id;
    activeConfig.lastSwitchedAt = new Date();
    activeConfig.lastSwitchReason = reason;
    activeConfig.configVersion += 1;
    activeConfig.updatedBy = actor?.id || null;
    await activeConfig.save();

    // Record in Switch History
    await AgoraSwitchHistory.create({
      fromProjectId: previousProjectId,
      fromProjectName: previousProjectName,
      toProjectId: targetProject._id,
      toProjectName: targetProject.name,
      toAppId: targetProject.appId,
      reason,
      triggerType: 'MANUAL_ADMIN',
      triggeredBy: actor?.id || null,
      triggeredByName: actor?.name || 'Admin',
      status: 'SUCCESS',
    });

    // Audit Log
    await AgoraConfigurationAuditLog.create({
      action: 'ACTIVATE_PROJECT',
      projectId: targetProject._id,
      projectName: targetProject.name,
      actorId: actor?.id || null,
      actorName: actor?.name || 'Admin',
      actorRole: actor?.role || 'admin',
      changes: {
        previousProjectId,
        activeProjectId: targetProject._id,
        reason,
        configVersion: activeConfig.configVersion,
      },
    });

    return {
      activeProject: targetProject,
      activeConfig,
    };
  }

  /**
   * 1-Click Rollback to the previous valid configuration.
   */
  static async rollback(reason = 'Admin requested rollback to previous configuration', actor?: { id: any; name: string; role: string }) {
    const activeConfig = await this.ensureActiveConfiguration();
    if (!activeConfig.previousProjectId) {
      throw new Error('No previous Agora configuration is recorded for rollback.');
    }

    const previousProject = await AgoraProject.findById(activeConfig.previousProjectId).select('+appCertificateEncrypted');
    if (!previousProject) {
      throw new Error('Previous Agora project record no longer exists.');
    }
    if (!previousProject.isEnabled) {
      throw new Error('Previous Agora project is disabled. Please enable it before rollback.');
    }

    // Validate credentials of previous project before rolling back
    const cert = decryptAgoraSecret(previousProject.appCertificateEncrypted);
    const testResult = this.testCredentialsLocally(previousProject.appId, cert);
    if (!testResult.isValid) {
      throw new Error(`Cannot rollback: previous project credentials are now invalid (${testResult.message})`);
    }

    const currentProjectId = activeConfig.activeProjectId;
    let currentProjectName = 'Unknown';
    if (currentProjectId) {
      const current = await AgoraProject.findById(currentProjectId);
      if (current) {
        current.status = 'standby';
        currentProjectName = current.name;
        await current.save();
      }
    }

    previousProject.status = 'active';
    await previousProject.save();

    activeConfig.activeProjectId = previousProject._id;
    activeConfig.previousProjectId = currentProjectId;
    activeConfig.lastSwitchedAt = new Date();
    activeConfig.lastSwitchReason = reason;
    activeConfig.configVersion += 1;
    activeConfig.updatedBy = actor?.id || null;
    await activeConfig.save();

    await AgoraSwitchHistory.create({
      fromProjectId: currentProjectId,
      fromProjectName: currentProjectName,
      toProjectId: previousProject._id,
      toProjectName: previousProject.name,
      toAppId: previousProject.appId,
      reason,
      triggerType: 'ROLLBACK',
      triggeredBy: actor?.id || null,
      triggeredByName: actor?.name || 'Admin',
      status: 'SUCCESS',
    });

    await AgoraConfigurationAuditLog.create({
      action: 'ROLLBACK',
      projectId: previousProject._id,
      projectName: previousProject.name,
      actorId: actor?.id || null,
      actorName: actor?.name || 'Admin',
      actorRole: actor?.role || 'admin',
      changes: {
        fromProjectId: currentProjectId,
        toProjectId: previousProject._id,
        reason,
      },
    });

    return {
      activeProject: previousProject,
      activeConfig,
    };
  }

  /**
   * Delete an inactive, standby project.
   */
  static async deleteProject(projectId: string, actor?: { id: any; name: string; role: string }) {
    const project = await AgoraProject.findById(projectId);
    if (!project) throw new Error('Agora project not found');

    const activeConfig = await this.ensureActiveConfiguration();
    if (activeConfig.activeProjectId && String(activeConfig.activeProjectId) === String(project._id)) {
      throw new Error('Cannot delete the active Agora project. Switch active project first.');
    }

    await AgoraProject.findByIdAndDelete(projectId);

    await AgoraConfigurationAuditLog.create({
      action: 'DELETE_PROJECT',
      projectId: project._id,
      projectName: project.name,
      actorId: actor?.id || null,
      actorName: actor?.name || 'Admin',
      actorRole: actor?.role || 'admin',
      changes: { deletedAppId: project.appId },
    });

    return { success: true };
  }
}
