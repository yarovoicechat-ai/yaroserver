import mongoose, { Schema, Document } from 'mongoose';

export type StoreCategory =
  | 'Unique ID'
  | 'Chat Bubble'
  | 'Chat Bubbles'
  | 'Theme'
  | 'Themes'
  | 'Seat Skin'
  | 'Seat Skins'
  | 'Tassel'
  | 'Tassels'
  | 'Mic Wave'
  | 'Mic Waves'
  | 'Frames'
  | 'Frame'
  | 'Entrance'
  | 'Entry'
  | 'Entry Effect'
  | 'Profile Card'
  | 'Profile Cards'
  | 'Room Card'
  | 'Room Cards'
  | 'Profile Entry'
  | 'Profile Entries'
  | 'VIP'
  | 'King of Kings'
  | 'Badge'
  | 'Tag';

export interface IStorePriceOption {
  days: 3 | 7 | 15 | 30;
  diamonds: number;
}

export interface IStoreItem extends Document {
  name: string;
  category: StoreCategory;
  price: number; // In Diamonds
  priceOptions: IStorePriceOption[];
  validity: string; // '7 Days' | '30 Days' | '90 Days' | 'Permanent'
  badgeText?: string; // 'HOT' | 'NEW' | 'LIMITED' | 'SALE' | 'VIP'
  previewColor?: string;
  bgColors?: string[];
  icon?: string;
  imageUrl?: string; // Store cover for Frames/Entry; animationUrl is the playable asset.
  animationUrl?: string; // SVGA / Lottie / MP4 / GIF
  uniqueId?: string; // Numeric or short unique ID like '555', '1001'
  audience?: 'general' | 'employee' | 'vip' | 'event';
  isStaffOnly?: boolean;
  desc?: string;
  isActive: boolean;
  sortOrder: number;
  metadata?: Record<string, any>; // e.g. special ID number, audio frequency, waveColors
  salesCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const StoreItemSchema = new Schema<IStoreItem>(
  {
    uniqueId: { type: String, unique: true, sparse: true, trim: true, index: true },
    audience: {
      type: String,
      enum: ['general', 'employee', 'vip', 'event'],
      default: 'general',
      index: true,
    },
    isStaffOnly: { type: Boolean, default: false, index: true },
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      required: true,
      enum: [
        'Unique ID',
        'Chat Bubble',
        'Chat Bubbles',
        'Theme',
        'Themes',
        'Seat Skin',
        'Seat Skins',
        'Tassel',
        'Tassels',
        'Mic Wave',
        'Mic Waves',
        'Frames',
        'Frame',
        'Entrance',
        'Entry',
        'Entry Effect',
        'Profile Card',
        'Profile Cards',
        'Room Card',
        'Room Cards',
        'Profile Entry',
        'Profile Entries',
        'VIP',
        'King of Kings',
        'Badge',
        'Tag',
      ],
      index: true,
    },
    price: { type: Number, required: true, default: 0, min: 0 },
    priceOptions: [{
      days: { type: Number, enum: [3, 7, 15, 30], required: true },
      diamonds: { type: Number, min: 0, required: true },
      _id: false,
    }],
    validity: { type: String, required: true, default: '30 Days' },
    badgeText: { type: String, default: '' },
    previewColor: { type: String, default: '#8B5CF6' },
    bgColors: [{ type: String }],
    icon: { type: String, default: 'sparkles' },
    imageUrl: { type: String, default: '' },
    animationUrl: { type: String, default: '' },
    desc: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    metadata: { type: Schema.Types.Mixed, default: {} },
    salesCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

StoreItemSchema.index({ category: 1, isActive: 1, sortOrder: 1 });

export const StoreItem =
  (mongoose.models.StoreItem as mongoose.Model<IStoreItem>) ||
  mongoose.model<IStoreItem>('StoreItem', StoreItemSchema);
