import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IDevice extends Document {
  deviceId: string;
  platform: string;
  appVersion?: string;
  associatedUserIds: number[];
  isBanned: boolean;
  banType?: 'temporary' | 'permanent' | null;
  banReason?: string;
  adminNote?: string;
  bannedAt?: Date | null;
  bannedUntil?: Date | null;
  bannedBy?: Types.ObjectId | null;
  bannedByName?: string;
  lastSeenAt: Date;
  firstSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DeviceSchema = new Schema<IDevice>(
  {
    deviceId: { type: String, required: true, unique: true, index: true, trim: true },
    platform: { type: String, default: 'android' },
    appVersion: { type: String, default: '' },
    associatedUserIds: { type: [Number], default: [] },
    isBanned: { type: Boolean, default: false, index: true },
    banType: { type: String, enum: ['temporary', 'permanent', null], default: null },
    banReason: { type: String, default: '' },
    adminNote: { type: String, default: '' },
    bannedAt: { type: Date, default: null },
    bannedUntil: { type: Date, default: null, index: true },
    bannedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    bannedByName: { type: String, default: '' },
    lastSeenAt: { type: Date, default: Date.now },
    firstSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

DeviceSchema.index({ isBanned: 1, bannedUntil: 1 });
DeviceSchema.index({ associatedUserIds: 1 });

export const Device = mongoose.model<IDevice>('Device', DeviceSchema);
