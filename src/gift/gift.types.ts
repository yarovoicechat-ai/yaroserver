import { Document, Types } from 'mongoose';

export type GiftAnimationType =
  | 'NORMAL'
  | 'FLOATING'
  | 'FLY_TO_RECEIVER'
  | 'CENTER_STAGE'
  | 'FULL_SCREEN'
  | 'SPECIAL'
  | 'VIP'
  | 'LUXURY';

export type GiftRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type GiftTransactionStatus = 'PENDING' | 'SUCCESS' | 'COMPLETED' | 'FAILED' | 'REFUNDED';

export interface IGiftCategory extends Document {
  name: string;
  slug: string;
  icon?: string;
  sortOrder: number;
  isActive: boolean;
  isVipOnly?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IGift extends Omit<Document, 'isNew'> {
  name: string;
  slug: string;
  image?: string;
  animation?: string;
  categoryId?: Types.ObjectId | string;
  category?: string;
  icon: string;
  animationUrl?: string;
  previewUrl?: string;
  price: number; // Cost in Diamonds
  cost: number;  // Cost in Diamonds (backwards-compat alias)
  currency: 'DIAMONDS' | string;
  rarity: GiftRarity;
  sortOrder: number;
  isActive: boolean;
  isNew?: boolean;
  isNewItem?: boolean;
  isHot?: boolean;
  isVip?: boolean;
  isVipOnly: boolean;
  isLimited?: boolean;
  comboEnabled?: boolean;
  animationType: GiftAnimationType;
  duration: number; // animation length in ms
  sound?: string;
  entryEffect?: string;
  mediaType?: 'image' | 'gif' | 'webp' | 'svg' | 'svga';
  metadata?: Record<string, any>;
  startsAt?: Date; // Limited-time/event gift start
  endsAt?: Date;   // Limited-time/event gift end
  createdAt: Date;
  updatedAt: Date;
}

export interface IGiftTransaction extends Document {
  requestId: string;
  senderId: Types.ObjectId;
  receiverId?: Types.ObjectId;
  receiverIds?: Types.ObjectId[];
  roomId?: string;
  callId?: string;
  giftId: Types.ObjectId;
  quantity: number;
  unitPrice: number;
  totalDiamonds: number;
  totalPrice: number;
  currency: string;
  type: string;
  status: GiftTransactionStatus;
  hostEarning?: number;
  platformCommission?: number;
  commissionPercent?: number;
  comboCount?: number;
  errorMessage?: string;
  meta?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SendGiftDTO {
  requestId: string;
  giftId: string;
  roomId?: string;
  callId?: string;
  receiverId?: string;
  receiverIds?: string[];
  quantity?: number;
  comboCount?: number;
}

export interface CreateGiftDTO {
  name: string;
  slug?: string;
  categoryId?: string;
  category?: string;
  icon: string;
  animationUrl?: string;
  previewUrl?: string;
  price?: number;
  cost?: number;
  currency?: string;
  rarity?: GiftRarity;
  sortOrder?: number;
  isActive?: boolean;
  isVipOnly?: boolean;
  animationType?: GiftAnimationType;
  duration?: number;
  mediaType?: 'image' | 'gif' | 'webp' | 'svg' | 'svga';
  startsAt?: Date | string;
  endsAt?: Date | string;
}

export interface UpdateGiftDTO extends Partial<CreateGiftDTO> {}

export interface CreateCategoryDTO {
  name: string;
  slug?: string;
  icon?: string;
  sortOrder?: number;
  isActive?: boolean;
  isVipOnly?: boolean;
}

export interface UpdateCategoryDTO extends Partial<CreateCategoryDTO> {}

export interface GiftFilterQuery {
  category?: string;
  categoryId?: string;
  rarity?: string;
  isVipOnly?: boolean | string;
  roomId?: string;
  includeInactive?: boolean | string;
}
