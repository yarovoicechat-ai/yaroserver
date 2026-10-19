import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IRewardItemConfig {
  enabled: boolean;
  name: string;
  url?: string;
  animationUrl?: string;
  days: number; // 0 = permanent, or 7, 15, 30, etc.
  itemId?: string; // If selected from store/catalog
  itemSource: 'upload' | 'catalog';
  uniqueDisplayId?: string; // If unique ID
}

export interface IWealthLevel extends Document {
  level: number;
  name: string;
  diamondsRequired: number;
  levelTag?: string; // Optional level tag
  levelBadge?: string; // Optional level badge icon/url
  badgeColor?: string;
  perks?: string[];

  // 9 Configurable Rewards:
  frameReward?: IRewardItemConfig;
  entryReward?: IRewardItemConfig;
  badgeReward?: IRewardItemConfig;
  tagReward?: IRewardItemConfig;
  uniqueIdReward?: IRewardItemConfig;
  tasselReward?: IRewardItemConfig;
  profileBorderReward?: IRewardItemConfig;
  customThemeReward?: IRewardItemConfig;
  coverBannerReward?: IRewardItemConfig;

  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RewardItemConfigSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    name: { type: String, default: '' },
    url: { type: String, default: '' },
    animationUrl: { type: String, default: '' },
    days: { type: Number, default: 30 },
    itemId: { type: String, default: '' },
    itemSource: { type: String, enum: ['upload', 'catalog'], default: 'upload' },
    uniqueDisplayId: { type: String, default: '' },
  },
  { _id: false }
);

const WealthLevelSchema = new Schema<IWealthLevel>(
  {
    level: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true },
    diamondsRequired: { type: Number, required: true, min: 0 },
    levelTag: { type: String, default: '' },
    levelBadge: { type: String, default: '' },
    badgeColor: { type: String, default: '#F59E0B' },
    perks: { type: [String], default: [] },

    frameReward: { type: RewardItemConfigSchema, default: () => ({ enabled: false, days: 30, itemSource: 'upload' }) },
    entryReward: { type: RewardItemConfigSchema, default: () => ({ enabled: false, days: 30, itemSource: 'upload' }) },
    badgeReward: { type: RewardItemConfigSchema, default: () => ({ enabled: false, days: 30, itemSource: 'upload' }) },
    tagReward: { type: RewardItemConfigSchema, default: () => ({ enabled: false, days: 30, itemSource: 'upload' }) },
    uniqueIdReward: { type: RewardItemConfigSchema, default: () => ({ enabled: false, days: 30, itemSource: 'upload' }) },
    tasselReward: { type: RewardItemConfigSchema, default: () => ({ enabled: false, days: 30, itemSource: 'upload' }) },
    profileBorderReward: { type: RewardItemConfigSchema, default: () => ({ enabled: false, days: 30, itemSource: 'upload' }) },
    customThemeReward: { type: RewardItemConfigSchema, default: () => ({ enabled: false, days: 30, itemSource: 'upload' }) },
    coverBannerReward: { type: RewardItemConfigSchema, default: () => ({ enabled: false, days: 30, itemSource: 'upload' }) },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const WealthLevel: Model<IWealthLevel> = (mongoose.models.WealthLevel as Model<IWealthLevel>) || mongoose.model<IWealthLevel>('WealthLevel', WealthLevelSchema);
export default WealthLevel;
