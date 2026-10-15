import mongoose, { Schema, Document } from 'mongoose';

export type IdentityEffectCategory =
  | 'animated_name'
  | 'name_color'
  | 'official_badge'
  | 'unique_badge'
  | 'profile_frame'
  | 'chat_bubble';

export interface IIdentityEffect extends Document {
  name: string;
  slug: string;
  category: IdentityEffectCategory;
  description: string;
  config: {
    // Color & Animation
    colors: string[];
    gradientDirection?: 'horizontal' | 'vertical' | 'diagonal';
    animationType: 'none' | 'gradient_scroll' | 'rainbow' | 'glow_pulse' | 'shimmer' | 'neon' | 'gold_rotate' | 'particles';
    animationSpeed?: number;
    glowColor?: string;
    shadowColor?: string;
    outlineColor?: string;
    prefixBadge?: string;
    badgeIconUrl?: string;
    badgeText?: string;
    particleType?: string;
    [key: string]: any;
  };
  previewBg: 'dark' | 'velvet' | 'neon' | 'gold' | 'royal';
  eligibleTiers: string[]; // e.g. ['all', 'vip', 'svip', 'knight', 'king']
  priceDiamonds: number;
  isPurchasable: boolean;
  status: 'active' | 'inactive' | 'draft' | 'archived';
  validityDays: number; // default duration, 0 = permanent
  sortOrder: number;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const IdentityEffectSchema = new Schema<IIdentityEffect>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    category: {
      type: String,
      enum: ['animated_name', 'name_color', 'official_badge', 'unique_badge', 'profile_frame', 'chat_bubble'],
      required: true,
      index: true,
    },
    description: { type: String, default: '' },
    config: { type: Schema.Types.Mixed, default: {} },
    previewBg: {
      type: String,
      enum: ['dark', 'velvet', 'neon', 'gold', 'royal'],
      default: 'dark',
    },
    eligibleTiers: { type: [String], default: ['all'] },
    priceDiamonds: { type: Number, default: 0, min: 0 },
    isPurchasable: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['active', 'inactive', 'draft', 'archived'],
      default: 'active',
      index: true,
    },
    validityDays: { type: Number, default: 30 },
    sortOrder: { type: Number, default: 0, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const IdentityEffect = mongoose.model<IIdentityEffect>('IdentityEffect', IdentityEffectSchema);
