import mongoose, { Schema, Document, Types } from 'mongoose';

export type AgoraSwitchingMode = 'automatic' | 'manual';
export type AgoraStalePolicy = 'stay_on_current' | 'switch_to_standby' | 'alert_only';

export interface IActiveAgoraConfiguration extends Document {
  activeProjectId: Types.ObjectId | null;
  previousProjectId: Types.ObjectId | null;
  switchingMode: AgoraSwitchingMode;
  warningThresholdPercent: number; // e.g. 70
  switchingThresholdPercent: number; // e.g. 85
  criticalThresholdPercent: number; // e.g. 95
  hardLimitPercent: number; // e.g. 100
  cooldownMinutes: number; // e.g. 30 minutes
  safetyBufferMinutes: number; // e.g. 500 minutes before limit
  safePolicyOnDataStale: AgoraStalePolicy;
  lastSwitchedAt?: Date | null;
  lastSwitchReason?: string;
  configVersion: number;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const activeAgoraConfigurationSchema = new Schema<IActiveAgoraConfiguration>(
  {
    activeProjectId: {
      type: Schema.Types.ObjectId,
      ref: 'AgoraProject',
      default: null,
      index: true,
    },
    previousProjectId: {
      type: Schema.Types.ObjectId,
      ref: 'AgoraProject',
      default: null,
    },
    switchingMode: {
      type: String,
      enum: ['automatic', 'manual'],
      default: 'automatic',
    },
    warningThresholdPercent: {
      type: Number,
      default: 70,
      min: 10,
      max: 95,
    },
    switchingThresholdPercent: {
      type: Number,
      default: 85,
      min: 20,
      max: 99,
    },
    criticalThresholdPercent: {
      type: Number,
      default: 95,
      min: 30,
      max: 100,
    },
    hardLimitPercent: {
      type: Number,
      default: 100,
      min: 50,
      max: 100,
    },
    cooldownMinutes: {
      type: Number,
      default: 30,
      min: 1,
      max: 1440,
    },
    safetyBufferMinutes: {
      type: Number,
      default: 500,
      min: 0,
      max: 5000,
    },
    safePolicyOnDataStale: {
      type: String,
      enum: ['stay_on_current', 'switch_to_standby', 'alert_only'],
      default: 'alert_only',
    },
    lastSwitchedAt: {
      type: Date,
      default: null,
    },
    lastSwitchReason: {
      type: String,
      default: '',
    },
    configVersion: {
      type: Number,
      default: 1,
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

export const ActiveAgoraConfiguration = mongoose.model<IActiveAgoraConfiguration>(
  'ActiveAgoraConfiguration',
  activeAgoraConfigurationSchema
);
