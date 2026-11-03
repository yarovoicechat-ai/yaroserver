import agoraToken from 'agora-token';
const { RtcTokenBuilder, RtcRole } = agoraToken;
import { Types } from 'mongoose';

import { AgoraProject, IAgoraProject } from '../../models/agoraProject.model';
import { ActiveAgoraConfiguration } from '../../models/agoraConfig.model';
import { decryptAgoraSecret } from './agoraSecurity';
import { AgoraProjectService } from './agoraProject.service';

export interface GeneratedCallTokens {
  appId: string;
  projectId: string;
  channelName: string;
  callerAgoraUid: number;
  hostAgoraUid: number;
  callerToken: string;
  hostToken: string;
  configVersion: number;
}

export interface GeneratedRoomToken {
  appId: string;
  projectId: string;
  channelName: string;
  agoraUid: number;
  token: string;
  configVersion: number;
}

export class AgoraTokenService {
  /**
   * Resolves the authoritative active project or an explicit project/AppId for ongoing sessions.
   */
  static async resolveProject(preferredProjectIdOrAppId?: string): Promise<{ project: IAgoraProject; certificate: string; configVersion: number }> {
    let project: IAgoraProject | null = null;

    if (preferredProjectIdOrAppId) {
      if (Types.ObjectId.isValid(preferredProjectIdOrAppId)) {
        project = await AgoraProject.findById(preferredProjectIdOrAppId).select('+appCertificateEncrypted');
      }
      if (!project) {
        project = await AgoraProject.findOne({ appId: preferredProjectIdOrAppId }).select('+appCertificateEncrypted');
      }
    }

    const activeConfig = await AgoraProjectService.ensureActiveConfiguration();

    if (!project && activeConfig.activeProjectId) {
      project = await AgoraProject.findById(activeConfig.activeProjectId).select('+appCertificateEncrypted');
    }

    if (!project || !project.isEnabled) {
      // Fallback to highest priority enabled project
      project = await AgoraProject.findOne({ isEnabled: true, validationStatus: 'VALID' })
        .sort({ priority: 1, createdAt: 1 })
        .select('+appCertificateEncrypted');
    }

    if (!project) {
      // If still none, ensure the default project
      const seeded = await AgoraProjectService.ensureDefaultProject();
      project = await AgoraProject.findById(seeded._id).select('+appCertificateEncrypted');
    }

    if (!project) {
      throw new Error('No valid Agora project is available in the system.');
    }

    const certificate = decryptAgoraSecret(project.appCertificateEncrypted);
    return {
      project,
      certificate,
      configVersion: activeConfig.configVersion || 1,
    };
  }

  /**
   * Generates paired RTC tokens for 1-on-1 calls (both caller and host).
   */
  static async generateCallTokens(
    channelName: string,
    callerAgoraUid: number,
    hostAgoraUid: number,
    maxMinutes = 10,
    preferredProjectIdOrAppId?: string
  ): Promise<GeneratedCallTokens> {
    const { project, certificate, configVersion } = await this.resolveProject(preferredProjectIdOrAppId);

    // AccessToken2 accepts a duration, independent of the account balance.
    const tokenExpireSeconds = 86400;

    const callerToken = RtcTokenBuilder.buildTokenWithUid(
      project.appId,
      certificate,
      channelName,
      callerAgoraUid,
      RtcRole.PUBLISHER,
      tokenExpireSeconds,
      tokenExpireSeconds
    );

    const hostToken = RtcTokenBuilder.buildTokenWithUid(
      project.appId,
      certificate,
      channelName,
      hostAgoraUid,
      RtcRole.PUBLISHER,
      tokenExpireSeconds,
      tokenExpireSeconds
    );

    return {
      appId: project.appId,
      projectId: String(project._id),
      channelName,
      callerAgoraUid,
      hostAgoraUid,
      callerToken,
      hostToken,
      configVersion,
    };
  }

  /**
   * Generates an RTC token for a Voice Club room session.
   */
  static async generateRoomToken(
    roomId: string,
    agoraUid: number,
    isPublisher = true,
    preferredProjectIdOrAppId?: string
  ): Promise<GeneratedRoomToken> {
    const { project, certificate, configVersion } = await this.resolveProject(preferredProjectIdOrAppId);

    const channelName = `voiceroom_${roomId}`;
    const tokenExpireSeconds = 86400; // 24 hours

    let token = '';
    if (certificate) {
      token = RtcTokenBuilder.buildTokenWithUid(
        project.appId,
        certificate,
        channelName,
        agoraUid,
        RtcRole.PUBLISHER,
        tokenExpireSeconds,
        tokenExpireSeconds
      );
    }

    return {
      appId: project.appId,
      projectId: String(project._id),
      channelName,
      agoraUid,
      token,
      configVersion,
    };
  }
}
