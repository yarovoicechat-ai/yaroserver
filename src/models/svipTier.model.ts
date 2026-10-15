import mongoose, { Schema, Document } from 'mongoose';

export interface ISvipFeatures {
  enableEntryEffect: boolean;
  enableEntryTag: boolean;
  enableEntryFrame: boolean;
  enableAvatarFrame: boolean;
  enableMicWave: boolean;
  enableChatBubble: boolean;
  enableRoomTheme: boolean;
  enableNameEffect: boolean;
  enableSpecialBadge: boolean;
  enableSpecialSound: boolean;
  enableParticles: boolean;
  enableAntiKick?: boolean;
  enableInvisibleVisit?: boolean;
}

export interface ISvipPrivilegeConfig {
  key: string;
  title: string;
  description: string;
  icon: string;
  animationUrl?: string;
  isEnabled: boolean;
  isVisible: boolean;
  implementationStatus: 'supported' | 'partially_supported' | 'coming_soon';
  value?: string | number;
  sortOrder: number;
}

export interface ISvipTier extends Document {
  name: string; // e.g. "SVIP 1 Knight", "SVIP 2 Count", "SVIP 9 King of Kings"
  planCode: string; // unique internal code, e.g. "SVIP_1", "SVIP_2"
  slug: string;
  level: number;
  description: string;
  badge: string;
  icon: string;
  crown: string;

  // Hero visuals & branding
  heroBadgeUrl?: string;
  heroAnimationUrl?: string;
  bgGradient?: string[];
  bgImageUrl?: string;

  // Pricing & Validity
  price: number; // in Diamonds
  originalPrice?: number;
  discountPercent?: number;
  currency: 'DIAMONDS';
  durationDays: number;
  validityType: 'days' | 'months' | 'custom';
  rechargeThreshold?: number; // Wealth/refill threshold to unlock or progress

  // SVIP Tag & Bubble
  svipTagConfig?: {
    text: string;
    bgGradient: string[];
    iconUrl?: string;
    enabled: boolean;
  };
  svipBubbleConfig?: {
    bubbleName: string;
    previewUrl?: string;
    bgGradient: string[];
    textColor: string;
    borderColor: string;
    enabled: boolean;
  };
  profileBadgeConfig?: {
    badgeName: string;
    iconUrl?: string;
    animationType?: string;
    enabled: boolean;
  };

  // Dynamic Privilege List (from screenshots)
  privileges: ISvipPrivilegeConfig[];

  // Granular feature enable/disable toggles (backward-compatible)
  features: ISvipFeatures;

  // Custom bundle overrides
  entryAnimationUrl?: string;
  entryTagText?: string;
  entryFrameUrl?: string;
  avatarFrameUrl?: string;
  micWaveConfig?: {
    waveColors: string[];
    intensity: number;
  };
  chatBubbleConfig?: {
    bubbleName: string;
    bgGradient: string[];
    textColor: string;
    borderColor: string;
  };
  roomThemeConfig?: {
    themeName: string;
    bgUrl: string;
    overlayGradient: string[];
  };
  nameEffectConfig?: {
    gradient: string[];
    glowColor: string;
  };
  entrySound?: string;
  particles?: string;

  status: 'active' | 'inactive' | 'draft' | 'archived';
  isActive: boolean;
  sortOrder: number;
  availableFrom?: Date;
  availableTo?: Date;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const PrivilegeSchema = new Schema<ISvipPrivilegeConfig>(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    icon: { type: String, default: 'crown' },
    animationUrl: { type: String, default: '' },
    isEnabled: { type: Boolean, default: true },
    isVisible: { type: Boolean, default: true },
    implementationStatus: {
      type: String,
      enum: ['supported', 'partially_supported', 'coming_soon'],
      default: 'supported',
    },
    value: { type: Schema.Types.Mixed, default: '' },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

const SvipTierSchema = new Schema<ISvipTier>(
  {
    name: { type: String, required: true, trim: true },
    planCode: { type: String, trim: true, default: '' },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    level: { type: Number, required: true, unique: true },
    description: { type: String, default: '' },
    badge: { type: String, default: '👑 SVIP' },
    icon: { type: String, default: 'diamond' },
    crown: { type: String, default: '👑' },

    heroBadgeUrl: { type: String, default: '' },
    heroAnimationUrl: { type: String, default: '' },
    bgGradient: { type: [String], default: ['#1E140D', '#2A1C13', '#160E09'] },
    bgImageUrl: { type: String, default: '' },

    price: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 },
    currency: { type: String, default: 'DIAMONDS', enum: ['DIAMONDS'] },
    durationDays: { type: Number, default: 30 },
    validityType: { type: String, enum: ['days', 'months', 'custom'], default: 'days' },
    rechargeThreshold: { type: Number, default: 0 },

    svipTagConfig: {
      text: { type: String, default: 'SVIP' },
      bgGradient: { type: [String], default: ['#F59E0B', '#D97706'] },
      iconUrl: { type: String, default: '' },
      enabled: { type: Boolean, default: true },
    },
    svipBubbleConfig: {
      bubbleName: { type: String, default: 'SVIP Royal Bubble' },
      previewUrl: { type: String, default: '' },
      bgGradient: { type: [String], default: ['#3B0764', '#581C87'] },
      textColor: { type: String, default: '#FFFFFF' },
      borderColor: { type: String, default: '#C084FC' },
      enabled: { type: Boolean, default: true },
    },
    profileBadgeConfig: {
      badgeName: { type: String, default: 'SVIP Crest' },
      iconUrl: { type: String, default: '' },
      animationType: { type: String, default: 'pulse' },
      enabled: { type: Boolean, default: true },
    },

    privileges: { type: [PrivilegeSchema], default: [] },

    features: {
      enableEntryEffect: { type: Boolean, default: true },
      enableEntryTag: { type: Boolean, default: true },
      enableEntryFrame: { type: Boolean, default: true },
      enableAvatarFrame: { type: Boolean, default: true },
      enableMicWave: { type: Boolean, default: true },
      enableChatBubble: { type: Boolean, default: true },
      enableRoomTheme: { type: Boolean, default: true },
      enableNameEffect: { type: Boolean, default: true },
      enableSpecialBadge: { type: Boolean, default: true },
      enableSpecialSound: { type: Boolean, default: true },
      enableParticles: { type: Boolean, default: true },
      enableAntiKick: { type: Boolean, default: false },
      enableInvisibleVisit: { type: Boolean, default: false },
    },

    entryAnimationUrl: { type: String, default: '' },
    entryTagText: { type: String, default: '' },
    entryFrameUrl: { type: String, default: '' },
    avatarFrameUrl: { type: String, default: '' },
    micWaveConfig: {
      waveColors: { type: [String], default: ['#A855F7', '#7C3AED', '#C084FC'] },
      intensity: { type: Number, default: 1.2 },
    },
    chatBubbleConfig: {
      bubbleName: { type: String, default: 'SVIP Royal Purple' },
      bgGradient: { type: [String], default: ['#3B0764', '#581C87'] },
      textColor: { type: String, default: '#FFFFFF' },
      borderColor: { type: String, default: '#C084FC' },
    },
    roomThemeConfig: {
      themeName: { type: String, default: 'Imperial Velvet' },
      bgUrl: { type: String, default: '' },
      overlayGradient: { type: [String], default: ['rgba(30, 7, 75, 0.85)', 'rgba(59, 7, 100, 0.9)'] },
    },
    nameEffectConfig: {
      gradient: { type: [String], default: ['#E879F9', '#C084FC', '#A855F7'] },
      glowColor: { type: String, default: '#C084FC' },
    },
    entrySound: { type: String, default: '' },
    particles: { type: String, default: 'purple_sparkles' },

    status: {
      type: String,
      enum: ['active', 'inactive', 'draft', 'archived'],
      default: 'active',
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0, index: true },
    availableFrom: { type: Date },
    availableTo: { type: Date },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const SvipTier = mongoose.model<ISvipTier>('SvipTier', SvipTierSchema);
