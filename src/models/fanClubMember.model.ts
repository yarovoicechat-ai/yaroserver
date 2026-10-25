import mongoose, { Schema, Document } from 'mongoose';

export interface IFanClubMember extends Document {
  roomId: string;
  hostId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  joinedAt: Date;
  expiresAt: Date;
  isActive: boolean;
  tier: number;
  exp: number;
  stayMinutes: number;
  diamondsSent: number;
  createdAt: Date;
  updatedAt: Date;
}

const FanClubMemberSchema = new Schema<IFanClubMember>(
  {
    roomId: { type: String, required: true, index: true },
    hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    joinedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true, index: true },
    tier: { type: Number, default: 1, min: 1, max: 5 },
    exp: { type: Number, default: 0, min: 0 },
    stayMinutes: { type: Number, default: 0, min: 0 },
    diamondsSent: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

FanClubMemberSchema.index({ roomId: 1, userId: 1 }, { unique: true });
FanClubMemberSchema.index({ hostId: 1, userId: 1 });
FanClubMemberSchema.index({ roomId: 1, isActive: 1, exp: -1 });

export const FanClubMember =
  (mongoose.models.FanClubMember as mongoose.Model<IFanClubMember>) ||
  mongoose.model<IFanClubMember>('FanClubMember', FanClubMemberSchema);
