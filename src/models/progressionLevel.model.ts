import mongoose, { Schema, model, Document } from "mongoose";

export type LevelJourneyType = 'wealth' | 'charm';
export type LevelRewardType = 'frame' | 'entry' | 'badge' | 'tag' | 'vehicle' | 'micWave' | 'theme' | 'uniqueId';

export interface IUniqueIdRewardConfig {
  mode: 'request' | 'select'; // 'request' = user inputs desired number in app; 'select' = selected from catalog/predefined
  uniqueDisplayId?: string;
  uniqueIdLevelId?: string;
  badgeName?: string;
  badgeIconUrl?: string;
}

export interface IProgressionLevelReward {
  type: LevelRewardType;
  name: string;
  imageUrl?: string;
  animationUrl?: string;
  durationDays: number; // 0 means permanent
  uniqueIdConfig?: IUniqueIdRewardConfig;
}

export interface IProgressionLevel extends Document {
  type: LevelJourneyType; // 'wealth' | 'charm'
  level: number;
  name: string;
  requiredExp: number; // EXP required to complete/unlock this level
  badgeIcon?: string;  // Static PNG/WebP uploaded icon
  badgeAnimation?: string; // SVGA / GIF uploaded animation
  badgeColor?: string; // Badge accent color e.g. #F59E0B
  levelTag?: string;   // Title / Tag e.g. 👑 Gold Monarch
  rewards: IProgressionLevelReward[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UniqueIdRewardConfigSchema = new Schema<IUniqueIdRewardConfig>(
  {
    mode: { type: String, enum: ['request', 'select'], default: 'request' },
    uniqueDisplayId: { type: String, default: '' },
    uniqueIdLevelId: { type: String, default: '' },
    badgeName: { type: String, default: '' },
    badgeIconUrl: { type: String, default: '' },
  },
  { _id: false }
);

const ProgressionLevelRewardSchema = new Schema<IProgressionLevelReward>(
  {
    type: {
      type: String,
      enum: ['frame', 'entry', 'badge', 'tag', 'vehicle', 'micWave', 'theme', 'uniqueId'],
      required: true,
    },
    name: { type: String, required: true, trim: true },
    imageUrl: { type: String, default: '' },
    animationUrl: { type: String, default: '' },
    durationDays: { type: Number, min: 0, default: 30 },
    uniqueIdConfig: { type: UniqueIdRewardConfigSchema, default: null },
  },
  { _id: false }
);

const ProgressionLevelSchema = new Schema<IProgressionLevel>(
  {
    type: { type: String, enum: ['wealth', 'charm'], default: 'wealth', required: true, index: true },
    level: { type: Number, required: true },
    name: { type: String, required: true, trim: true },
    requiredExp: { type: Number, required: true, min: 0, default: 0 },
    badgeIcon: { type: String, default: '' },
    badgeAnimation: { type: String, default: '' },
    badgeColor: { type: String, default: '#F59E0B' },
    levelTag: { type: String, default: '' },
    rewards: { type: [ProgressionLevelRewardSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

ProgressionLevelSchema.index({ type: 1, level: 1 }, { unique: true });

export const ProgressionLevel =
  mongoose.models.ProgressionLevel || model<IProgressionLevel>("ProgressionLevel", ProgressionLevelSchema);

export default ProgressionLevel;
