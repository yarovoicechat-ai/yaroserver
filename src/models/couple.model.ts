import mongoose, { Schema, Document } from 'mongoose';

export interface ICouple extends Document {
  user1: mongoose.Types.ObjectId;
  user2: mongoose.Types.ObjectId;
  ringName: string;
  ringImage: string;
  intimacyScore: number;
  cpLevel: number;
  status: 'active' | 'broken';
  anniversaryDate: Date;
  cpTitle: string;
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
    intimacyScore: { type: Number, default: 520, min: 0 },
    cpLevel: { type: Number, default: 1, min: 1 },
    status: { type: String, enum: ['active', 'broken'], default: 'active', index: true },
    anniversaryDate: { type: Date, default: Date.now },
    cpTitle: { type: String, default: 'Eternal Soulmates' },
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

export default Couple;
