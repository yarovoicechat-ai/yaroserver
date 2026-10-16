import mongoose, { Schema, Document, Types } from 'mongoose';

export type EntitlementType =
  | 'official_id'
  | 'unique_id_badge'
  | 'custom_display_id'
  | 'animated_name'
  | 'name_color'
  | 'vip_tier'
  | 'svip_tier'
  | 'profile_frame'
  | 'entry_effect'
  | 'chat_bubble';

export type EntitlementStatus = 'active' | 'inactive' | 'expired' | 'revoked' | 'draft';

export type GrantSource = 'admin_grant' | 'purchase' | 'promotional' | 'system';

export interface IIdentityEntitlement extends Document {
  userId: number; // Permanent numeric user ID (e.g. 1000000002) - NEVER overwritten!
  userObjectId: Types.ObjectId; // MongoDB reference to User document
  type: EntitlementType;
  config: {
    // Official ID & Custom ID specific
    displayId?: string; // e.g. "Official" or custom short vanity ID "ABCD"
    badgeUrl?: string; // URL for animated/static official badge
    badgeText?: string; // e.g. "OFFICIAL", "VIP 1", "ROYAL"
    badgeAnimationType?: 'shimmer' | 'pulse' | 'glow' | 'gold_rotate' | 'svga' | 'lottie' | 'static';
    badgeColors?: string[];
    showVerifiedCheck?: boolean;

    // Animated Name & Colors specific
    styleId?: string;
    colors?: string[];
    gradientDirection?: 'horizontal' | 'vertical' | 'diagonal';
    animationType?: 'none' | 'gradient_scroll' | 'rainbow' | 'glow_pulse' | 'shimmer' | 'neon' | 'particles';
    glowColor?: string;
    shadowColor?: string;
    outlineColor?: string;
    animationSpeed?: number;
    prefixBadge?: string;

    // VIP / SVIP Tier specific
    tierSlug?: string;
    tierLevel?: number;
    privileges?: string[];

    // Profile Frame & Effects specific
    frameUrl?: string;
    animationUrl?: string;
    bubbleName?: string;
    bgGradient?: string[];

    [key: string]: any;
  };
  status: EntitlementStatus;
  startsAt: Date;
  expiresAt: Date; // Server-authoritative expiration UTC timestamp
  grantedBy: {
    adminId?: Types.ObjectId;
    adminName?: string;
    role?: string;
  };
  grantSource: GrantSource;
  grantReason?: string;
  notes?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  isValidNow(): boolean;
}

const IdentityEntitlementSchema = new Schema<IIdentityEntitlement>(
  {
    userId: { type: Number, required: true, index: true },
    userObjectId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: [
        'official_id',
        'unique_id_badge',
        'custom_display_id',
        'animated_name',
        'name_color',
        'vip_tier',
        'svip_tier',
        'profile_frame',
        'entry_effect',
        'chat_bubble',
      ],
      required: true,
      index: true,
    },
    config: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['active', 'inactive', 'expired', 'revoked', 'draft'],
      default: 'active',
      index: true,
    },
    startsAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, required: true, index: true },
    grantedBy: {
      adminId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      adminName: { type: String, default: 'System' },
      role: { type: String, default: 'admin' },
    },
    grantSource: {
      type: String,
      enum: ['admin_grant', 'purchase', 'promotional', 'system'],
      default: 'admin_grant',
    },
    grantReason: { type: String, default: '' },
    notes: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// Compound indexes for high-throughput runtime queries
IdentityEntitlementSchema.index({ userId: 1, type: 1, status: 1, startsAt: 1, expiresAt: 1 });
IdentityEntitlementSchema.index({ 'config.displayId': 1, type: 1, status: 1 });
IdentityEntitlementSchema.index({ expiresAt: 1, status: 1 });

// Instance helper to verify validity on the fly
IdentityEntitlementSchema.methods.isValidNow = function (): boolean {
  if (this.status !== 'active') return false;
  const now = new Date();
  return this.startsAt <= now && this.expiresAt > now;
};

export const IdentityEntitlement = mongoose.model<IIdentityEntitlement>(
  'IdentityEntitlement',
  IdentityEntitlementSchema
);
