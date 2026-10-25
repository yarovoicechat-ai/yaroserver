import mongoose, { Schema, Document, Model } from 'mongoose';

export type UniqueIdRequestStatus = 'pending' | 'approved' | 'rejected';

export interface IUniqueIdRequest extends Document {
  userId: mongoose.Types.ObjectId;
  originalUserId: number;
  userName: string;
  userAvatar?: string;
  levelType: 'wealth' | 'charm' | 'vip';
  levelNumber: number;
  requestedId: string;
  badgeName?: string;
  badgeIcon?: string;
  status: UniqueIdRequestStatus;
  reviewedBy?: mongoose.Types.ObjectId;
  reviewedAt?: Date;
  rejectionReason?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UniqueIdRequestSchema = new Schema<IUniqueIdRequest>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    originalUserId: { type: Number, required: true, index: true },
    userName: { type: String, default: '' },
    userAvatar: { type: String, default: '' },
    levelType: { type: String, enum: ['wealth', 'charm', 'vip'], default: 'wealth', required: true },
    levelNumber: { type: Number, required: true },
    requestedId: { type: String, required: true, trim: true, index: true },
    badgeName: { type: String, default: '' },
    badgeIcon: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

export const UniqueIdRequest: Model<IUniqueIdRequest> =
  mongoose.models.UniqueIdRequest ||
  mongoose.model<IUniqueIdRequest>('UniqueIdRequest', UniqueIdRequestSchema);

export default UniqueIdRequest;
