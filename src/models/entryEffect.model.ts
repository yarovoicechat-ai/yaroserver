import mongoose, { Schema, Document } from 'mongoose';

export type EntryAnimationType =
  | 'BANNER'
  | 'CENTER_AVATAR'
  | 'PARTICLES'
  | 'VIP_ENTRANCE'
  | 'SPECIAL_EVENT';

export interface IEntryEffect extends Document {
  name: string;
  slug: string;
  tagText: string; // e.g. "👑 VIP HAS ENTERED", "🔥 KING IS HERE"
  animationType: EntryAnimationType;
  image?: string;
  icon?: string;
  animationUrl?: string;
  sound?: string;
  bannerColors: string[];
  price: number; // in Diamonds
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
  isVip: boolean;
  isLimited: boolean;
  isActive: boolean;
  duration: number; // in ms
  sortOrder: number;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const EntryEffectSchema = new Schema<IEntryEffect>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    tagText: { type: String, required: true, default: '👑 VIP HAS ENTERED' },
    animationType: {
      type: String,
      enum: ['BANNER', 'CENTER_AVATAR', 'PARTICLES', 'VIP_ENTRANCE', 'SPECIAL_EVENT'],
      default: 'BANNER',
      index: true,
    },
    image: { type: String, default: '' },
    icon: { type: String, default: '👑' },
    animationUrl: { type: String, default: '' },
    sound: { type: String, default: '' },
    bannerColors: { type: [String], default: ['#7C3AED', '#4C1D95'] },
    price: { type: Number, required: true, default: 0, min: 0 },
    rarity: {
      type: String,
      enum: ['common', 'rare', 'epic', 'legendary', 'mythic'],
      default: 'rare',
      index: true,
    },
    isVip: { type: Boolean, default: false },
    isLimited: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    duration: { type: Number, default: 2600 },
    sortOrder: { type: Number, default: 0, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const EntryEffect = mongoose.model<IEntryEffect>('EntryEffect', EntryEffectSchema);
