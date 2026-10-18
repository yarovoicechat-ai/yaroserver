import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IAgoraUsageSnapshot extends Document {
  projectId: Types.ObjectId;
  appId: string;
  month: string; // YYYY-MM UTC format
  voiceMinutes: number;
  videoMinutes: number;
  roomMinutes: number;
  totalAppCallMinutes: number;
  officialBilledUnits?: number; // From Agora billing report if synchronized
  officialSyncStatus: 'PENDING_PROVIDER_SYNC' | 'SYNCHRONIZED' | 'MANUAL_OVERRIDE';
  officialSyncAt?: Date;
  officialSyncError?: string | null;
  usageSource: 'INTERNAL_SESSION_TRACKING' | 'AGORA_REST_API';
  freeTierBudgetMinutes: number;
  estimatedRemainingMinutes: number;
  isStale: boolean;
  lastSynchronizedAt: Date;
  alertsTriggered: string[]; // e.g. ['70%', '85%', '95%', '100%']
  createdAt: Date;
  updatedAt: Date;
}

const agoraUsageSnapshotSchema = new Schema<IAgoraUsageSnapshot>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'AgoraProject',
      required: true,
      index: true,
    },
    appId: {
      type: String,
      required: true,
      index: true,
    },
    month: {
      type: String, // YYYY-MM
      required: true,
      index: true,
    },
    voiceMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    videoMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    roomMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalAppCallMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    officialBilledUnits: {
      type: Number,
      default: 0,
      min: 0,
    },
    officialSyncStatus: {
      type: String,
      enum: ['PENDING_PROVIDER_SYNC', 'SYNCHRONIZED', 'MANUAL_OVERRIDE'],
      default: 'PENDING_PROVIDER_SYNC',
    },
    officialSyncAt: {
      type: Date,
      default: null,
    },
    officialSyncError: {
      type: String,
      default: null,
    },
    usageSource: {
      type: String,
      default: 'INTERNAL_SESSION_TRACKING',
    },
    freeTierBudgetMinutes: {
      type: Number,
      default: 10000,
    },
    estimatedRemainingMinutes: {
      type: Number,
      default: 10000,
    },
    isStale: {
      type: Boolean,
      default: false,
    },
    lastSynchronizedAt: {
      type: Date,
      default: Date.now,
    },
    alertsTriggered: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

agoraUsageSnapshotSchema.index({ projectId: 1, month: 1 }, { unique: true });

export const AgoraUsageSnapshot = mongoose.model<IAgoraUsageSnapshot>(
  'AgoraUsageSnapshot',
  agoraUsageSnapshotSchema
);

export type AgoraSessionType = '1v1_audio' | '1v1_video' | 'voice_room';

export interface IAgoraCallSessionUsage extends Document {
  sessionId: string; // TransactionId or voice room channel session ID
  sessionType: AgoraSessionType;
  projectId: Types.ObjectId;
  appId: string;
  channelName: string;
  callerId?: string;
  hostId?: string;
  startTime: Date;
  endTime?: Date | null;
  durationSeconds: number;
  billableMinutes: number; // Math.ceil(durationSeconds / 60)
  isFinalized: boolean;
  month: string; // YYYY-MM
  createdAt: Date;
  updatedAt: Date;
}

const agoraCallSessionUsageSchema = new Schema<IAgoraCallSessionUsage>(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    sessionType: {
      type: String,
      enum: ['1v1_audio', '1v1_video', 'voice_room'],
      required: true,
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'AgoraProject',
      required: true,
      index: true,
    },
    appId: {
      type: String,
      required: true,
      index: true,
    },
    channelName: {
      type: String,
      required: true,
    },
    callerId: {
      type: String,
      default: '',
    },
    hostId: {
      type: String,
      default: '',
    },
    startTime: {
      type: Date,
      required: true,
      index: true,
    },
    endTime: {
      type: Date,
      default: null,
    },
    durationSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    billableMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    isFinalized: {
      type: Boolean,
      default: false,
      index: true,
    },
    month: {
      type: String, // YYYY-MM
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

agoraCallSessionUsageSchema.index({ projectId: 1, month: 1, isFinalized: 1 });

export const AgoraCallSessionUsage = mongoose.model<IAgoraCallSessionUsage>(
  'AgoraCallSessionUsage',
  agoraCallSessionUsageSchema
);
