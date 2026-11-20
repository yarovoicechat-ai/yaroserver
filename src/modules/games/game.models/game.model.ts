import mongoose, { Schema, Document } from 'mongoose';

export interface IGameDocument extends Document {
  gameId: string;
  title: string;
  subtitle: string;
  description: string;
  category: 'Wheel' | 'Casino' | 'Casual' | 'Board';
  icon: string;
  gameUrl: string;
  minBet: number;
  maxBet: number;
  multipliers: number[];
  isActive: boolean;
  isHidden: boolean;
  showInVoiceRoom: boolean;
  showInLiveRoom: boolean;
  showFloatingBanner: boolean;
  isMultiplayer: boolean;
  maxPlayers: number;
  engineVersion: string;
  tag: string;
  gradient: string[];
  createdAt: Date;
  updatedAt: Date;
}

const GameSchema = new Schema<IGameDocument>(
  {
    gameId: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    description: { type: String, default: '' },
    category: {
      type: String,
      enum: ['Wheel', 'Casino', 'Casual', 'Board'],
      default: 'Wheel',
    },
    icon: { type: String, default: 'gamepad-variant' },
    gameUrl: { type: String, required: true },
    minBet: { type: Number, default: 50 },
    maxBet: { type: Number, default: 50000 },
    multipliers: { type: [Number], default: [2, 5, 10, 15, 20, 25, 30, 50] },
    isActive: { type: Boolean, default: true, index: true },
    isHidden: { type: Boolean, default: false, index: true },
    showInVoiceRoom: { type: Boolean, default: true },
    showInLiveRoom: { type: Boolean, default: true },
    showFloatingBanner: { type: Boolean, default: true },
    isMultiplayer: { type: Boolean, default: true },
    maxPlayers: { type: Number, default: 100 },
    engineVersion: { type: String, default: 'Cocos Creator 3.8.x' },
    tag: { type: String, default: 'COCOS' },
    gradient: { type: [String], default: ['#FF007F', '#7928CA'] },
  },
  { timestamps: true }
);

export const Game = mongoose.model<IGameDocument>('Game', GameSchema);
