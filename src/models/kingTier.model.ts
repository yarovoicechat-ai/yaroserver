import mongoose, { Schema, Document } from 'mongoose';

export interface IKingRewardItem {
  key: string;
  title: string;
  description: string;
  icon: string;
  previewUrl?: string;
  animationUrl?: string;
  value?: string | number; // e.g. "+3,600/days"
  isEnabled: boolean;
  sortOrder: number;
}

export interface IKingPrivilegeItem {
  key: string;
  title: string;
  description: string;
  icon: string;
  previewUrl?: string;
  animationUrl?: string;
  powerDescription?: string;
  value?: string | number;
  isEnabled: boolean;
  unlockLevel: number;
  sortOrder: number;
}

export interface IKingTier extends Document {
  name: string; // "Knight", "Count", "Duke", "Prince", "King"
  slug: string; // "knight", "count", "duke", "prince", "king"
  tierLevel: number; // 1 to 5+
  title: string;
  description: string;
  badge: string;
  crown: string;

  // Hero visuals
  heroBadgeUrl?: string;
  heroAnimationUrl?: string;
  heroBadgePreviewUrl?: string;

  // Pricing & Value
  priceCoins: number; // in Coins (e.g. 99,000)
  originalPriceCoins?: number; // 150,000
  discountPercent?: number; // 30
  totalReturnCoins?: number; // 108,000
  dailyCoins: number; // 3,600
  durationDays: number; // 30
  currency: 'COINS' | 'DIAMONDS';

  // Section 1: Reward Assets (Reward (X/11))
  rewards: IKingRewardItem[];

  // Section 2: Exclusive Privileges (Exclusive privileges (X/13))
  privileges: IKingPrivilegeItem[];

  status: 'active' | 'inactive' | 'draft';
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const KingRewardSchema = new Schema<IKingRewardItem>(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    icon: { type: String, default: 'gift' },
    previewUrl: { type: String, default: '' },
    animationUrl: { type: String, default: '' },
    value: { type: Schema.Types.Mixed, default: '' },
    isEnabled: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const KingPrivilegeSchema = new Schema<IKingPrivilegeItem>(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    icon: { type: String, default: 'star' },
    previewUrl: { type: String, default: '' },
    animationUrl: { type: String, default: '' },
    powerDescription: { type: String, default: '' },
    value: { type: Schema.Types.Mixed, default: '' },
    isEnabled: { type: Boolean, default: true },
    unlockLevel: { type: Number, default: 1 },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const KingTierSchema = new Schema<IKingTier>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    tierLevel: { type: Number, required: true, unique: true },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    badge: { type: String, default: '👑 KING OF KINGS' },
    crown: { type: String, default: '👑' },

    heroBadgeUrl: { type: String, default: '' },
    heroAnimationUrl: { type: String, default: '' },
    heroBadgePreviewUrl: { type: String, default: '' },

    priceCoins: { type: Number, required: true, min: 0 },
    originalPriceCoins: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 30 },
    totalReturnCoins: { type: Number, default: 0 },
    dailyCoins: { type: Number, default: 0 },
    durationDays: { type: Number, default: 30 },
    currency: { type: String, enum: ['COINS', 'DIAMONDS'], default: 'COINS' },

    rewards: { type: [KingRewardSchema], default: [] },
    privileges: { type: [KingPrivilegeSchema], default: [] },

    status: { type: String, enum: ['active', 'inactive', 'draft'], default: 'active', index: true },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

export const KingTier = mongoose.model<IKingTier>('KingTier', KingTierSchema);
