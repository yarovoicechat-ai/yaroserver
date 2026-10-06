// levelLog.model.ts - Audit & Transaction Log for Level EXP & Manual Adjustments
import mongoose, { Schema, Document } from 'mongoose';

export interface LevelExpLogInterface extends Document {
  userId: mongoose.Types.ObjectId;
  type: 'wealth' | 'charm';
  amount: number;
  source: string;
  referenceId?: string;
  oldExp: number;
  newExp: number;
  oldLevel: number;
  newLevel: number;
  adminId?: mongoose.Types.ObjectId;
  reason?: string;
  createdAt: Date;
}

const levelExpLogSchema = new Schema<LevelExpLogInterface>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['wealth', 'charm'], required: true, index: true },
    amount: { type: Number, required: true },
    source: { type: String, required: true, index: true },
    referenceId: { type: String, default: '' },
    oldExp: { type: Number, required: true },
    newExp: { type: Number, required: true },
    oldLevel: { type: Number, required: true },
    newLevel: { type: Number, required: true },
    adminId: { type: Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

levelExpLogSchema.index({ userId: 1, type: 1, createdAt: -1 });

export const LevelExpLog = mongoose.model<LevelExpLogInterface>('LevelExpLog', levelExpLogSchema);
