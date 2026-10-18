import mongoose, { Schema, Document, Types } from 'mongoose';

export type AgoraProjectStatus = 'active' | 'standby' | 'disabled';
export type AgoraEnvironment = 'production' | 'staging';
export type AgoraValidationStatus = 'VALID' | 'INVALID' | 'UNTESTED';

export interface IAgoraProject extends Document {
  _id: Types.ObjectId;
  name: string;
  appId: string;
  appCertificateEncrypted: string;
  environment: AgoraEnvironment;
  status: AgoraProjectStatus;
  isEnabled: boolean;
  priority: number; // 1 = Highest, 2, 3...
  monthlyUsageBudgetMinutes: number; // Default 10000 free-tier or custom
  switchingThresholdPercent: number; // e.g., 85%
  hardLimitMinutes: number; // e.g., 9900 or 10000
  lastValidatedAt?: Date | null;
  validationStatus: AgoraValidationStatus;
  validationMessage?: string;
  lastSyncAt?: Date | null;
  notes?: string;
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const agoraProjectSchema = new Schema<IAgoraProject>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    appId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: /^[a-zA-Z0-9]{32}$/,
      index: true,
    },
    appCertificateEncrypted: {
      type: String,
      required: true,
      select: false, // Never returned by default in queries
    },
    environment: {
      type: String,
      enum: ['production', 'staging'],
      default: 'production',
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'standby', 'disabled'],
      default: 'standby',
      index: true,
    },
    isEnabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    priority: {
      type: Number,
      default: 10,
      min: 1,
      max: 1000,
      index: true,
    },
    monthlyUsageBudgetMinutes: {
      type: Number,
      default: 10000, // Agora typical monthly free allowance
      min: 100,
    },
    switchingThresholdPercent: {
      type: Number,
      default: 85,
      min: 50,
      max: 100,
    },
    hardLimitMinutes: {
      type: Number,
      default: 9900,
      min: 100,
    },
    lastValidatedAt: {
      type: Date,
      default: null,
    },
    validationStatus: {
      type: String,
      enum: ['VALID', 'INVALID', 'UNTESTED'],
      default: 'UNTESTED',
    },
    validationMessage: {
      type: String,
      default: '',
    },
    lastSyncAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      default: '',
      maxlength: 1000,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

agoraProjectSchema.index({ status: 1, priority: 1, isEnabled: 1 });

export const AgoraProject = mongoose.model<IAgoraProject>('AgoraProject', agoraProjectSchema);
