import mongoose, { Schema, Document } from 'mongoose';

export type StoreCategory =
  | 'Unique ID'
  | 'Chat Bubble'
  | 'Theme'
  | 'Tassel'
  | 'Mic Wave'
  | 'Frames'
  | 'Entry'
  | 'VIP';

export interface IStoreItem extends Document {
  name: string;
  category: StoreCategory;
  price: number; // In Diamonds
  validity: string; // '7 Days' | '30 Days' | '90 Days' | 'Permanent'
  badgeText?: string; // 'HOT' | 'NEW' | 'LIMITED' | 'SALE' | 'VIP'
  previewColor?: string;
  bgColors?: string[];
  icon?: string;
  imageUrl?: string;
  animationUrl?: string; // SVGA / Lottie / MP4 / GIF
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
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      required: true,
      enum: [
        'Unique ID',
        'Chat Bubble',
        'Theme',
        'Tassel',
        'Mic Wave',
        'Frames',
        'Entry',
        'VIP',
      ],
      index: true,
    },
    price: { type: Number, required: true, default: 0, min: 0 },
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

export const StoreItem = mongoose.model<IStoreItem>('StoreItem', StoreItemSchema);
