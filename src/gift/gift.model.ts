import mongoose, { Schema } from 'mongoose';
import { IGift, IGiftCategory, IGiftTransaction } from './gift.types';

// ========================
// 1. Gift Category Schema
// ========================
const giftCategorySchema = new Schema<IGiftCategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    icon: { type: String, default: '' },
    sortOrder: { type: Number, default: 0, index: true },
    isActive: { type: Boolean, default: true, index: true },
    isVipOnly: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const GiftCategory =
  (mongoose.models.GiftCategory as mongoose.Model<IGiftCategory>) ||
  mongoose.model<IGiftCategory>('GiftCategory', giftCategorySchema);

// ========================
// 2. Gift Schema
// ========================
const giftSchema = new Schema<IGift>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, trim: true },
    image: { type: String, default: '' },
    animation: { type: String, default: '' },
    categoryId: { type: Schema.Types.ObjectId, ref: 'GiftCategory', index: true },
    category: { type: String, default: 'Gifts', index: true },
    icon: { type: String, required: true },
    animationUrl: { type: String, default: '' },
    previewUrl: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 },
    cost: { type: Number, min: 0 },
    currency: { type: String, default: 'DIAMONDS' },
    rarity: {
      type: String,
      enum: ['common', 'rare', 'epic', 'legendary'],
      default: 'common',
      index: true,
    },
    sortOrder: { type: Number, default: 0, index: true },
    isActive: { type: Boolean, default: true, index: true },
    isNew: { type: Boolean, default: false },
    isNewItem: { type: Boolean, default: false },
    isHot: { type: Boolean, default: false },
    isVip: { type: Boolean, default: false },
    isVipOnly: { type: Boolean, default: false, index: true },
    isLimited: { type: Boolean, default: false },
    comboEnabled: { type: Boolean, default: true },
    animationType: {
      type: String,
      enum: [
        'NORMAL',
        'FLOATING',
        'FLY_TO_RECEIVER',
        'CENTER_STAGE',
        'FULL_SCREEN',
        'SPECIAL',
        'VIP',
        'LUXURY',
      ],
      default: 'NORMAL',
    },
    duration: { type: Number, default: 2500 },
    sound: { type: String, default: '' },
    entryEffect: { type: String, default: '' },
    mediaType: {
      type: String,
      enum: ['image', 'gif', 'webp', 'svg', 'svga'],
      default: 'image',
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
  },
  { timestamps: true, suppressReservedKeysWarning: true }
);

giftSchema.pre('validate', function (this: any, next: any) {
  if (this.price === undefined && this.cost !== undefined) {
    this.price = this.cost;
  }
  if (this.cost === undefined && this.price !== undefined) {
    this.cost = this.price;
  }
  if (this.isNew !== undefined && this.isNewItem === undefined) {
    this.isNewItem = this.isNew;
  }
  if (this.isNewItem !== undefined && this.isNew === undefined) {
    this.isNew = this.isNewItem;
  }
  if (!this.image && this.icon) {
    this.image = this.icon;
  }
  if (!this.slug && this.name) {
    this.slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
  this.currency = 'DIAMONDS';
  next();
});

export const Gift =
  (mongoose.models.Gift as mongoose.Model<IGift>) ||
  mongoose.model<IGift>('Gift', giftSchema);

// ========================
// 3. Gift Transaction Schema (Idempotent & Atomic)
// ========================
const giftTransactionSchema = new Schema<IGiftTransaction>(
  {
    requestId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    receiverId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    receiverIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    roomId: { type: String, index: true, default: '' },
    callId: { type: String, index: true, default: '' },
    giftId: { type: Schema.Types.ObjectId, ref: 'Gift', required: true, index: true },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    totalDiamonds: { type: Number, default: 0 },
    totalPrice: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'DIAMONDS' },
    type: { type: String, default: 'GIFT_SEND' },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'COMPLETED', 'FAILED', 'REFUNDED'],
      default: 'SUCCESS',
      index: true,
    },
    hostEarning: { type: Number, default: 0 },
    platformCommission: { type: Number, default: 0 },
    commissionPercent: { type: Number, default: 30 },
    comboCount: { type: Number, default: 1 },
    errorMessage: { type: String, default: '' },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

giftTransactionSchema.pre('validate', function (next) {
  if (this.totalPrice === undefined) {
    this.totalPrice = this.totalDiamonds || 0;
  }
  if (!this.totalDiamonds) {
    this.totalDiamonds = this.totalPrice;
  }
  this.currency = 'DIAMONDS';
  next();
});

export const GiftTransaction =
  (mongoose.models.GiftTransaction as mongoose.Model<IGiftTransaction>) ||
  mongoose.model<IGiftTransaction>('GiftTransaction', giftTransactionSchema);
