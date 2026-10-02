import mongoose, { Schema, Document } from 'mongoose';

export type VipRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

export interface IMicWaveConfig {
  waveColor?: string;
  waveColors?: string[];
  waveIntensity?: number;
  waveSpeed?: number;
  waveStyle?: string; // 'pulse' | 'bars' | 'rings' | 'fire'
}

export interface IChatBubbleConfig {
  bubbleName?: string;
  bgGradient?: string[];
  bgColor?: string;
  textColor?: string;
  borderColor?: string;
  borderRadius?: number;
  shadowColor?: string;
  bubbleStyle?: string;
}

export interface IRoomThemeConfig {
  themeName?: string;
  bgUrl?: string;
  overlayGradient?: string[];
  overlayOpacity?: number;
  particleType?: string; // 'stars' | 'gold_sparkles' | 'fireflies' | 'hearts'
}

export interface INameEffectConfig {
  gradient?: string[];
  glowColor?: string;
  isAnimated?: boolean;
  prefixBadge?: string;
}

export interface IVipId extends Document {
  name: string;
  slug: string;
  displayName: string;
  vipLevel: number;
  rarity: VipRarity;
  price: number; // In Diamonds
  currency: 'DIAMONDS';
  badge: string;
  crown: string;
  icon: string;
  
  // Customization components
  entryEffectId?: mongoose.Types.ObjectId;
  entryTag: string; // e.g. "👑 KING IS HERE", "💎 DIAMOND KING"
  entryFrame: string; // Asset / URL for circular avatar frame
  avatarFrame: string; // Profile avatar frame
  floatingEntryAnimation?: string; // Type of floating animation
  
  micWave: IMicWaveConfig;
  chatBubble: IChatBubbleConfig;
  roomTheme: IRoomThemeConfig;
  nameEffect: INameEffectConfig;
  
  entrySound?: string;
  particleEffect?: string;
  
  isVip: boolean;
  isSvip: boolean;
  isKing: boolean;
  isKingOfKings: boolean;
  isLimited: boolean;
  isActive: boolean;
  sortOrder: number;
  
  startAt?: Date;
  endAt?: Date;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const VipIdSchema = new Schema<IVipId>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    displayName: { type: String, required: true },
    vipLevel: { type: Number, default: 1, min: 1 },
    rarity: {
      type: String,
      enum: ['common', 'rare', 'epic', 'legendary', 'mythic'],
      default: 'epic',
    },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'DIAMONDS', enum: ['DIAMONDS'] },
    badge: { type: String, default: '👑 VIP' },
    crown: { type: String, default: '👑' },
    icon: { type: String, default: 'sparkles' },

    entryEffectId: { type: Schema.Types.ObjectId, ref: 'EntryEffect', default: null },
    entryTag: { type: String, default: '👑 VIP HAS ENTERED' },
    entryFrame: { type: String, default: '' },
    avatarFrame: { type: String, default: '' },
    floatingEntryAnimation: { type: String, default: 'CENTER_AVATAR' },

    micWave: {
      waveColor: { type: String, default: '#F59E0B' },
      waveColors: { type: [String], default: ['#F59E0B', '#FBBF24', '#D97706'] },
      waveIntensity: { type: Number, default: 1.0 },
      waveSpeed: { type: Number, default: 1.0 },
      waveStyle: { type: String, default: 'rings' },
    },
    chatBubble: {
      bubbleName: { type: String, default: 'VIP Gold' },
      bgGradient: { type: [String], default: ['#1E1B4B', '#312E81'] },
      bgColor: { type: String, default: '#1E1B4B' },
      textColor: { type: String, default: '#FFFFFF' },
      borderColor: { type: String, default: '#F59E0B' },
      borderRadius: { type: Number, default: 16 },
      shadowColor: { type: String, default: '#F59E0B' },
      bubbleStyle: { type: String, default: 'glass_gold' },
    },
    roomTheme: {
      themeName: { type: String, default: 'Royal Palace' },
      bgUrl: { type: String, default: '' },
      overlayGradient: { type: [String], default: ['rgba(15, 23, 42, 0.85)', 'rgba(30, 27, 75, 0.9)'] },
      overlayOpacity: { type: Number, default: 0.85 },
      particleType: { type: String, default: 'gold_sparkles' },
    },
    nameEffect: {
      gradient: { type: [String], default: ['#FDE047', '#EAB308', '#CA8A04'] },
      glowColor: { type: String, default: '#F59E0B' },
      isAnimated: { type: Boolean, default: true },
      prefixBadge: { type: String, default: '👑' },
    },

    entrySound: { type: String, default: '' },
    particleEffect: { type: String, default: 'gold_particles' },

    isVip: { type: Boolean, default: true },
    isSvip: { type: Boolean, default: false },
    isKing: { type: Boolean, default: false },
    isKingOfKings: { type: Boolean, default: false },
    isLimited: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0, index: true },

    startAt: { type: Date },
    endAt: { type: Date },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const VipId = mongoose.model<IVipId>('VipId', VipIdSchema);
