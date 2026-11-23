import mongoose, { Schema } from 'mongoose';

export interface IRoomPKVote {
  pkId: mongoose.Types.ObjectId;
  roomId: string;
  voterId: string;
  voterName?: string;
  voterAvatar?: string;
  side: number;
  targetUserId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const RoomPKVoteSchema = new Schema<IRoomPKVote>({
  pkId: { type: Schema.Types.ObjectId, ref: 'RoomPK', required: true, index: true },
  roomId: { type: String, required: true, index: true },
  voterId: { type: String, required: true, index: true },
  voterName: { type: String, default: '' },
  voterAvatar: { type: String, default: '' },
  side: { type: Number, enum: [0, 1], required: true },
  targetUserId: { type: String, default: '' },
}, { timestamps: true });

RoomPKVoteSchema.index({ pkId: 1, voterId: 1 }, { unique: true });

export const RoomPKVote = mongoose.models.RoomPKVote || mongoose.model<IRoomPKVote>('RoomPKVote', RoomPKVoteSchema);
