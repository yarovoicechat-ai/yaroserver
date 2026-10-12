import mongoose, { Schema, Document } from 'mongoose';

export interface IRoomSupportStats extends Document {
  roomId: string;
  roomOwnerId: mongoose.Types.ObjectId;
  weekKey: string; // YYYY-MM-DD_YYYY-MM-DD representing Monday 00:00 to Sunday 23:59 (UTC+5:30)
  roomCoins: number;
  roomVisitors: number;
  uniqueVisitorIds: string[];
  bonusCoins: number;
  currentLevel: number;
  autoSendRewards: boolean;
  rewardSendStatus: 'pending' | 'sent';
  rewardSentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RoomSupportStatsSchema = new Schema<IRoomSupportStats>(
  {
    roomId: { type: String, required: true, index: true },
    roomOwnerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    weekKey: { type: String, required: true, index: true },
    roomCoins: { type: Number, default: 0 },
    roomVisitors: { type: Number, default: 0 },
    uniqueVisitorIds: [{ type: String }],
    bonusCoins: { type: Number, default: 0 },
    currentLevel: { type: Number, default: 0 },
    autoSendRewards: { type: Boolean, default: true },
    rewardSendStatus: { type: String, enum: ['pending', 'sent'], default: 'pending' },
    rewardSentAt: { type: Date },
  },
  { timestamps: true }
);

RoomSupportStatsSchema.index({ roomId: 1, weekKey: 1 }, { unique: true });
RoomSupportStatsSchema.index({ roomOwnerId: 1, weekKey: 1 });

export const RoomSupportStats = mongoose.model<IRoomSupportStats>(
  'RoomSupportStats',
  RoomSupportStatsSchema
);
