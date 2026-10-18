import mongoose, { Schema, Document, Types } from 'mongoose';

export type AgoraSwitchTrigger = 'AUTOMATIC_THRESHOLD' | 'MANUAL_ADMIN' | 'ROLLBACK' | 'EMERGENCY_FAILOVER';
export type AgoraSwitchStatus = 'SUCCESS' | 'FAILED';

export interface IAgoraSwitchHistory extends Document {
  fromProjectId?: Types.ObjectId | null;
  fromProjectName?: string;
  toProjectId: Types.ObjectId;
  toProjectName: string;
  toAppId: string;
  reason: string;
  triggerType: AgoraSwitchTrigger;
  triggeredBy?: Types.ObjectId | null;
  triggeredByName?: string;
  status: AgoraSwitchStatus;
  errorMessage?: string;
  usageSnapshotAtSwitch?: {
    minutesUsed: number;
    budgetMinutes: number;
    usagePercent: number;
  };
  createdAt: Date;
}

const agoraSwitchHistorySchema = new Schema<IAgoraSwitchHistory>(
  {
    fromProjectId: {
      type: Schema.Types.ObjectId,
      ref: 'AgoraProject',
      default: null,
    },
    fromProjectName: {
      type: String,
      default: 'None',
    },
    toProjectId: {
      type: Schema.Types.ObjectId,
      ref: 'AgoraProject',
      required: true,
      index: true,
    },
    toProjectName: {
      type: String,
      required: true,
    },
    toAppId: {
      type: String,
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    triggerType: {
      type: String,
      enum: ['AUTOMATIC_THRESHOLD', 'MANUAL_ADMIN', 'ROLLBACK', 'EMERGENCY_FAILOVER'],
      required: true,
      index: true,
    },
    triggeredBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    triggeredByName: {
      type: String,
      default: 'System Automator',
    },
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED'],
      default: 'SUCCESS',
      index: true,
    },
    errorMessage: {
      type: String,
      default: '',
    },
    usageSnapshotAtSwitch: {
      minutesUsed: { type: Number, default: 0 },
      budgetMinutes: { type: Number, default: 0 },
      usagePercent: { type: Number, default: 0 },
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

agoraSwitchHistorySchema.index({ createdAt: -1 });

export const AgoraSwitchHistory = mongoose.model<IAgoraSwitchHistory>(
  'AgoraSwitchHistory',
  agoraSwitchHistorySchema
);

export type AgoraAuditAction =
  | 'CREATE_PROJECT'
  | 'UPDATE_PROJECT'
  | 'DELETE_PROJECT'
  | 'ACTIVATE_PROJECT'
  | 'DISABLE_PROJECT'
  | 'TEST_PROJECT'
  | 'UPDATE_POLICY'
  | 'ROLLBACK'
  | 'SYNC_USAGE';

export interface IAgoraConfigurationAuditLog extends Document {
  action: AgoraAuditAction;
  projectId?: Types.ObjectId | null;
  projectName?: string;
  actorId?: Types.ObjectId | null;
  actorName: string;
  actorRole: string;
  ipAddress?: string;
  changes: Record<string, any>; // Strictly redacted of any plain secrets!
  createdAt: Date;
}

const agoraConfigurationAuditLogSchema = new Schema<IAgoraConfigurationAuditLog>(
  {
    action: {
      type: String,
      enum: [
        'CREATE_PROJECT',
        'UPDATE_PROJECT',
        'DELETE_PROJECT',
        'ACTIVATE_PROJECT',
        'DISABLE_PROJECT',
        'TEST_PROJECT',
        'UPDATE_POLICY',
        'ROLLBACK',
        'SYNC_USAGE',
      ],
      required: true,
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'AgoraProject',
      default: null,
      index: true,
    },
    projectName: {
      type: String,
      default: '',
    },
    actorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    actorName: {
      type: String,
      default: 'System',
    },
    actorRole: {
      type: String,
      default: 'system',
    },
    ipAddress: {
      type: String,
      default: '',
    },
    changes: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

agoraConfigurationAuditLogSchema.index({ createdAt: -1 });

export const AgoraConfigurationAuditLog = mongoose.model<IAgoraConfigurationAuditLog>(
  'AgoraConfigurationAuditLog',
  agoraConfigurationAuditLogSchema
);
