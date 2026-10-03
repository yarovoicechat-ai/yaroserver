import mongoose, { Schema, Document } from 'mongoose';

export interface IFamily extends Document {
  name: string;
  badgeText: string;
  avatar: string;
  cover?: string;
  notice?: string;
  level: number;
  exp: number;
  leader: mongoose.Types.ObjectId;
  coLeaders: mongoose.Types.ObjectId[];
  members: mongoose.Types.ObjectId[];
  memberCount: number;
  ranking: number;
  diamondsEarned: number;
  isActive: boolean;
  joinRequests: {
    user: mongoose.Types.ObjectId;
    requestedAt: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const FamilySchema = new Schema<IFamily>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    badgeText: { type: String, required: true, trim: true, default: 'YARO' },
    avatar: {
      type: String,
      default: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200',
    },
    cover: {
      type: String,
      default: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800',
    },
    notice: { type: String, default: 'Welcome to our Family! Let us conquer the leaderboards together.' },
    level: { type: Number, default: 1, min: 1 },
    exp: { type: Number, default: 0, min: 0 },
    leader: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    coLeaders: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    members: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    memberCount: { type: Number, default: 1 },
    ranking: { type: Number, default: 999 },
    diamondsEarned: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true, index: true },
    joinRequests: [
      {
        user: { type: Schema.Types.ObjectId, ref: 'User' },
        requestedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

FamilySchema.index({ ranking: 1, diamondsEarned: -1, level: -1 });

export const Family =
  (mongoose.models.Family as mongoose.Model<IFamily>) ||
  mongoose.model<IFamily>('Family', FamilySchema);

export default Family;
