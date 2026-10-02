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

export interface ISvipTier extends Document {
  name: string; // e.g. "Knight", "Count", "Duke", "SVIP King", "SVIP King of Kings"
  slug: string;
  level: number;
  description: string;
  badge: string;
  icon: string;
  crown: string;
  price: number; // in Diamonds
  currency: 'DIAMONDS';
  durationDays: number;
  
  // Granular feature enable/disable toggles
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
  
  isActive: boolean;
  sortOrder: number;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const SvipTierSchema = new Schema<ISvipTier>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    level: { type: Number, required: true, unique: true },
    description: { type: String, default: '' },
    badge: { type: String, default: '👑 SVIP' },
    icon: { type: String, default: 'diamond' },
    crown: { type: String, default: '👑' },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'DIAMONDS', enum: ['DIAMONDS'] },
    durationDays: { type: Number, default: 30 },

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

    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const SvipTier = mongoose.model<ISvipTier>('SvipTier', SvipTierSchema);
