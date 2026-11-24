import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IBanHistory extends Document {
  targetType: 'USER' | 'DEVICE';
  targetId: string;
  action: 'BAN' | 'TEMPORARY_BAN' | 'PERMANENT_BAN' | 'UNBAN' | 'AUTO_EXPIRE';
  banType?: 'temporary' | 'permanent' | null;
  duration?: string;
  reason?: string;
  adminNote?: string;
  adminId?: Types.ObjectId | null;
  adminName?: string;
  bannedAt?: Date | null;
  bannedUntil?: Date | null;
  metadata?: Record<string, any>;
  createdAt: Date;
}

const BanHistorySchema = new Schema<IBanHistory>(
  {
    targetType: { type: String, enum: ['USER', 'DEVICE'], required: true, index: true },
    targetId: { type: String, required: true, index: true },
    action: {
      type: String,
      enum: ['BAN', 'TEMPORARY_BAN', 'PERMANENT_BAN', 'UNBAN', 'AUTO_EXPIRE'],
      required: true,
      index: true,
    },
    banType: { type: String, enum: ['temporary', 'permanent', null], default: null },
    duration: { type: String, default: '' },
    reason: { type: String, default: '' },
    adminNote: { type: String, default: '' },
    adminId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    adminName: { type: String, default: '' },
    bannedAt: { type: Date, default: null },
    bannedUntil: { type: Date, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

BanHistorySchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

export const BanHistory = mongoose.model<IBanHistory>('BanHistory', BanHistorySchema);
