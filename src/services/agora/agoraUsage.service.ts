import mongoose, { Types } from 'mongoose';
import { AgoraProject } from '../../models/agoraProject.model';
import { AgoraUsageSnapshot, AgoraCallSessionUsage, AgoraSessionType } from '../../models/agoraUsage.model';
import { CoinsTransaction } from '../../models/spentCoinModel';
import { ActiveAgoraConfiguration } from '../../models/agoraConfig.model';
import { AgoraFailoverService } from './agoraFailover.service';

export interface StartSessionParams {
  sessionId: string;
  sessionType: AgoraSessionType;
  projectId: string | Types.ObjectId;
  appId: string;
  channelName: string;
  callerId?: string;
  hostId?: string;
  startTime?: Date;
}

export interface EndSessionParams {
  sessionId: string;
  endTime?: Date;
  durationSeconds?: number;
}

export class AgoraUsageService {
  /**
   * Helper to get current UTC month key in YYYY-MM format.
   */
  static getMonthKey(date = new Date()): string {
    return date.toISOString().slice(0, 7);
  }

  /**
   * Records the start of an Agora session (idempotent).
   */
  static async recordSessionStart(params: StartSessionParams) {
    try {
      const month = this.getMonthKey(params.startTime || new Date());
      const existing = await AgoraCallSessionUsage.findOne({ sessionId: params.sessionId });
      if (existing) return existing;

      return await AgoraCallSessionUsage.create({
        sessionId: params.sessionId,
        sessionType: params.sessionType,
        projectId: new Types.ObjectId(params.projectId),
        appId: params.appId,
        channelName: params.channelName,
        callerId: params.callerId || '',
        hostId: params.hostId || '',
        startTime: params.startTime || new Date(),
        month,
        isFinalized: false,
      });
    } catch (err: any) {
      console.warn('[AgoraUsageService] Record session start warning:', err?.message || err);
    }
  }

  /**
   * Records the end of an Agora session, calculates billable minutes, and updates monthly snapshot.
   */
  static async recordSessionEnd(params: EndSessionParams) {
    try {
      const session = await AgoraCallSessionUsage.findOne({ sessionId: params.sessionId });
      if (!session) return null;
      if (session.isFinalized) return session; // Idempotent check

      const endTime = params.endTime || new Date();
      let durationSeconds = params.durationSeconds;
      if (typeof durationSeconds !== 'number' || durationSeconds <= 0) {
        durationSeconds = Math.max(0, Math.round((endTime.getTime() - session.startTime.getTime()) / 1000));
      }

      const billableMinutes = Math.max(1, Math.ceil(durationSeconds / 60)); // Minimum 1 minute per connected session

      session.endTime = endTime;
      session.durationSeconds = durationSeconds;
      session.billableMinutes = billableMinutes;
      session.isFinalized = true;
      await session.save();

      // Update Monthly Snapshot
      await this.incrementMonthlySnapshot({
        projectId: session.projectId,
        appId: session.appId,
        month: session.month,
        sessionType: session.sessionType,
        minutes: billableMinutes,
      });

      // Trigger automatic failover check after usage increase
      AgoraFailoverService.evaluateProjectUsage(session.projectId).catch((err) => {
        console.error('[AgoraUsageService] Failover check error:', err);
      });

      return session;
    } catch (err: any) {
      console.error('[AgoraUsageService] Record session end error:', err);
      return null;
    }
  }

  /**
   * Increments the monthly snapshot atomically for a project.
   */
  static async incrementMonthlySnapshot(params: {
    projectId: Types.ObjectId;
    appId: string;
    month: string;
    sessionType: AgoraSessionType;
    minutes: number;
  }) {
    const project = await AgoraProject.findById(params.projectId);
    const budget = project?.monthlyUsageBudgetMinutes || 10000;

    let updateFields: Record<string, any> = {
      $inc: {
        totalAppCallMinutes: params.minutes,
      },
      $set: {
        freeTierBudgetMinutes: budget,
        lastSynchronizedAt: new Date(),
      },
    };

    if (params.sessionType === '1v1_audio') {
      updateFields.$inc.voiceMinutes = params.minutes;
    } else if (params.sessionType === '1v1_video') {
      updateFields.$inc.videoMinutes = params.minutes;
    } else if (params.sessionType === 'voice_room') {
      updateFields.$inc.roomMinutes = params.minutes;
    }

    const snapshot = await AgoraUsageSnapshot.findOneAndUpdate(
      { projectId: params.projectId, month: params.month },
      updateFields,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Update remaining allowance calculation
    snapshot.estimatedRemainingMinutes = Math.max(0, budget - snapshot.totalAppCallMinutes);

    // Check alert thresholds
    const usagePercent = (snapshot.totalAppCallMinutes / budget) * 100;
    const currentAlerts = new Set(snapshot.alertsTriggered || []);

    if (usagePercent >= 100 && !currentAlerts.has('100%')) {
      currentAlerts.add('100%');
      console.warn(`🚨 [AgoraAlert] Project ${project?.name} (${params.appId}) reached 100% usage cap!`);
    } else if (usagePercent >= 95 && !currentAlerts.has('95%')) {
      currentAlerts.add('95%');
      console.warn(`⚠️ [AgoraAlert] Project ${project?.name} (${params.appId}) reached 95% usage cap!`);
    } else if (usagePercent >= 85 && !currentAlerts.has('85%')) {
      currentAlerts.add('85%');
      console.warn(`⚠️ [AgoraAlert] Project ${project?.name} (${params.appId}) reached 85% usage threshold!`);
    } else if (usagePercent >= 70 && !currentAlerts.has('70%')) {
      currentAlerts.add('70%');
      console.log(`ℹ️ [AgoraAlert] Project ${project?.name} (${params.appId}) reached 70% warning threshold.`);
    }

    snapshot.alertsTriggered = Array.from(currentAlerts);
    await snapshot.save();

    return snapshot;
  }

  /**
   * Reconciles usage from completed CoinsTransactions for the current month.
   */
  static async reconcileMonthlyUsage(month = this.getMonthKey()): Promise<{ reconciledSnapshots: number }> {
    const startOfMonth = new Date(`${month}-01T00:00:00.000Z`);
    const nextMonthDate = new Date(startOfMonth);
    nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);

    // Aggregate completed call transactions
    const callAgg = await CoinsTransaction.aggregate([
      {
        $match: {
          type: 'VOICE_CALL',
          createdAt: { $gte: startOfMonth, $lt: nextMonthDate },
          status: { $in: ['ended', 'completed', 'EXPIRED'] },
        },
      },
      {
        $group: {
          _id: {
            appId: { $ifNull: ['$meta.appId', 'd23c897f9305450faa7809ffcf666e57'] },
            isVideo: { $ifNull: ['$meta.isVideo', false] },
          },
          totalSeconds: {
            $sum: {
              $cond: [
                { $and: ['$callStart', '$callEnd'] },
                { $divide: [{ $subtract: ['$callEnd', '$callStart'] }, 1000] },
                { $multiply: [{ $ifNull: ['$duration', 1] }, 60] },
              ],
            },
          },
        },
      },
    ]);

    const projects = await AgoraProject.find().lean();
    let reconciledCount = 0;

    for (const project of projects) {
      const budget = project.monthlyUsageBudgetMinutes || 10000;
      let voiceMinutes = 0;
      let videoMinutes = 0;

      for (const item of callAgg) {
        if (item._id.appId === project.appId) {
          const mins = Math.ceil(item.totalSeconds / 60);
          if (item._id.isVideo) {
            videoMinutes += mins;
          } else {
            voiceMinutes += mins;
          }
        }
      }

      // Also sum Voice Room session usage from AgoraCallSessionUsage
      const roomUsage = await AgoraCallSessionUsage.aggregate([
        {
          $match: {
            projectId: project._id,
            month,
            sessionType: 'voice_room',
          },
        },
        {
          $group: {
            _id: null,
            totalMinutes: { $sum: '$billableMinutes' },
          },
        },
      ]);
      const roomMinutes = roomUsage[0]?.totalMinutes || 0;

      const totalAppCallMinutes = voiceMinutes + videoMinutes + roomMinutes;
      const estimatedRemainingMinutes = Math.max(0, budget - totalAppCallMinutes);

      await AgoraUsageSnapshot.findOneAndUpdate(
        { projectId: project._id, month },
        {
          $set: {
            appId: project.appId,
            voiceMinutes,
            videoMinutes,
            roomMinutes,
            totalAppCallMinutes,
            freeTierBudgetMinutes: budget,
            estimatedRemainingMinutes,
            isStale: false,
            lastSynchronizedAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );
      reconciledCount++;
    }

    return { reconciledSnapshots: reconciledCount };
  }

  /**
   * Retrieves usage summary across all projects for current month.
   */
  static async getUsageOverview(targetMonth = this.getMonthKey()) {
    const activeConfig = await ActiveAgoraConfiguration.findOne().lean();
    const snapshots = await AgoraUsageSnapshot.find({ month: targetMonth }).populate('projectId').lean();

    let totalSystemMinutes = 0;
    let totalVoiceMinutes = 0;
    let totalVideoMinutes = 0;
    let totalRoomMinutes = 0;

    const projectBreakdowns = snapshots.map((s: any) => {
      totalSystemMinutes += s.totalAppCallMinutes || 0;
      totalVoiceMinutes += s.voiceMinutes || 0;
      totalVideoMinutes += s.videoMinutes || 0;
      totalRoomMinutes += s.roomMinutes || 0;

      const budget = s.freeTierBudgetMinutes || 10000;
      const used = s.totalAppCallMinutes || 0;
      const usagePercent = Math.min(100, Math.round((used / budget) * 1000) / 10);

      return {
        projectId: s.projectId?._id,
        projectName: s.projectId?.name || 'Unknown Project',
        appId: s.appId,
        environment: s.projectId?.environment || 'production',
        isActive: activeConfig?.activeProjectId && String(activeConfig.activeProjectId) === String(s.projectId?._id),
        month: s.month,
        totalMinutes: used,
        voiceMinutes: s.voiceMinutes,
        videoMinutes: s.videoMinutes,
        roomMinutes: s.roomMinutes,
        budgetMinutes: budget,
        remainingMinutes: s.estimatedRemainingMinutes,
        usagePercent,
        isStale: s.isStale,
        lastSynchronizedAt: s.lastSynchronizedAt,
        alertsTriggered: s.alertsTriggered || [],
      };
    });

    return {
      month: targetMonth,
      totalSystemMinutes,
      totalVoiceMinutes,
      totalVideoMinutes,
      totalRoomMinutes,
      projectCount: projectBreakdowns.length,
      activeProjectId: activeConfig?.activeProjectId || null,
      switchingMode: activeConfig?.switchingMode || 'automatic',
      projects: projectBreakdowns,
      lastSyncTimestamp: new Date(),
    };
  }

  /**
   * Retrieves historical monthly usage.
   */
  static async getUsageHistory(limitMonths = 12) {
    return AgoraUsageSnapshot.find()
      .populate('projectId', 'name appId environment')
      .sort({ month: -1 })
      .limit(limitMonths * 5)
      .lean();
  }
}
