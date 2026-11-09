import mongoose, { Schema, Document } from 'mongoose';

export interface ICouple extends Document {
  user1: mongoose.Types.ObjectId;
  user2: mongoose.Types.ObjectId;
  ringName: string;
  ringImage: string;
  ringTier?: number;
  intimacyScore: number;
  cpLevel: number;
  status: 'active' | 'broken';
  anniversaryDate: Date;
  cpTitle: string;
  lastCheckinDate?: Date;
  loveWall: {
    sender: mongoose.Types.ObjectId;
    text: string;
    createdAt: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const CoupleSchema = new Schema<ICouple>(
  {
    user1: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    user2: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ringName: { type: String, default: 'Diamond Promise Ring' },
    ringImage: {
      type: String,
      default: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=200',
    },
    ringTier: { type: Number, default: 1 },
    intimacyScore: { type: Number, default: 520, min: 0 },
    cpLevel: { type: Number, default: 1, min: 1 },
    status: { type: String, enum: ['active', 'broken'], default: 'active', index: true },
    anniversaryDate: { type: Date, default: Date.now },
    cpTitle: { type: String, default: 'Eternal Soulmates' },
    lastCheckinDate: { type: Date },
    loveWall: [
      {
        sender: { type: Schema.Types.ObjectId, ref: 'User' },
        text: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

CoupleSchema.index({ user1: 1, user2: 1 });

export const Couple =
  (mongoose.models.Couple as mongoose.Model<ICouple>) ||
  mongoose.model<ICouple>('Couple', CoupleSchema);

export interface ICoupleProposal extends Document {
  sender: mongoose.Types.ObjectId;
  receiver: mongoose.Types.ObjectId;
  ringName: string;
  ringImage: string;
  message: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: Date;
  updatedAt: Date;
}

const CoupleProposalSchema = new Schema<ICoupleProposal>(
  {
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    receiver: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ringName: { type: String, default: 'Diamond Promise Ring' },
    ringImage: {
      type: String,
      default: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=200',
    },
    message: { type: String, default: 'Will you be my CP and share this journey with me?' },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending', index: true },
  },
  { timestamps: true }
);

CoupleProposalSchema.index({ receiver: 1, status: 1 });

export const CoupleProposal =
  (mongoose.models.CoupleProposal as mongoose.Model<ICoupleProposal>) ||
  mongoose.model<ICoupleProposal>('CoupleProposal', CoupleProposalSchema);

export default Couple;
