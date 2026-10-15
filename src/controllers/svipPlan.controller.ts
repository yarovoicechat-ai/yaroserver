import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { SvipTier, ISvipPrivilegeConfig } from '../models/svipTier.model';
import { User } from '../models/user.model';
import { IdentityEntitlement } from '../models/identityEntitlement.model';
import { IdentityAuditLog } from '../models/identityAuditLog.model';
import { IdentityResolverService } from '../services/identityResolver.service';
import { LevelService } from '../services/level.service';
import { AuthRequest } from '../middlewares/authorize.middleware';
import sendResponse from '../utils/reponse';
import { Logger } from '../utils/logger';

// 30 Standard Screenshot Reference Privileges
export const STANDARD_SCREENSHOT_PRIVILEGES: ISvipPrivilegeConfig[] = [
  {
    key: 'rank_the_top',
    title: 'Rank the Top',
    description: 'Pin your profile to the top of room visitor and contributor lists.',
    icon: 'trophy',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Top #1 Priority',
    sortOrder: 1,
  },
  {
    key: 'colorful_nickname',
    title: 'Colorful Nickname',
    description: 'Dynamic gradient and animated colors for your display name.',
    icon: 'palette',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Multi-Color Gradient',
    sortOrder: 2,
  },
  {
    key: 'view_more_visitors',
    title: 'View More Visitors',
    description: 'Unlock full visitor history without time or count limits.',
    icon: 'eye',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Unlimited History',
    sortOrder: 3,
  },
  {
    key: 'special_room_entry',
    title: 'Special Room Entry',
    description: 'Luxury animated 3D sports car and phoenix arrival notice.',
    icon: 'car-sport',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: '3D Luxury Vehicle',
    sortOrder: 4,
  },
  {
    key: 'unlimited_message',
    title: 'Unlimited Message',
    description: 'Bypass message frequency limits in voice party rooms and chats.',
    icon: 'chatbubbles',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Zero Cooldown',
    sortOrder: 5,
  },
  {
    key: 'unlock_more_room_mic',
    title: 'Unlock More Room Mic',
    description: 'Expand your owned voice rooms to 25 simultaneous microphone seats.',
    icon: 'mic',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: '25 Mic Seats',
    sortOrder: 6,
  },
  {
    key: 'send_pictures_private_chat',
    title: 'Send Pictures in Private Chat',
    description: 'Send high-resolution photo messages directly in 1-on-1 private chat.',
    icon: 'images',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'HD Photos',
    sortOrder: 7,
  },
  {
    key: 'modify_profile_gender',
    title: 'Modify Profile Gender',
    description: 'Change gender settings without standard cooldown constraints.',
    icon: 'transgender',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Flexible Edit',
    sortOrder: 8,
  },
  {
    key: 'hide_last_online',
    title: 'Hide Last Online',
    description: 'Keep your exact last-active timestamp private from other users.',
    icon: 'time',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Stealth Mode',
    sortOrder: 9,
  },
  {
    key: 'profile_vehicle',
    title: 'Profile Vehicle',
    description: 'Equip an animated luxury hover vehicle on your profile card.',
    icon: 'airplane',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Luxury Ride',
    sortOrder: 10,
  },
  {
    key: 'anti_tracking',
    title: 'Anti-Tracking',
    description: 'Prevent other users from tracking which room you are currently visiting.',
    icon: 'shield-checkmark',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Ghost Mode',
    sortOrder: 11,
  },
  {
    key: 'send_pictures_chat_room',
    title: 'Send Pictures in Chat Room',
    description: 'Post media photos directly into public room live feeds.',
    icon: 'camera',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Room Feeds',
    sortOrder: 12,
  },
  {
    key: 'customized_profile_background',
    title: 'Customized Profile Background',
    description: 'Set custom animated wallpaper on your personal profile detail sheet.',
    icon: 'image',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Custom Wallpaper',
    sortOrder: 13,
  },
  {
    key: 'gif_avatar',
    title: 'GIF Avatar',
    description: 'Upload dynamic moving GIF images as your user avatar.',
    icon: 'film',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Animated GIF',
    sortOrder: 14,
  },
  {
    key: 'level_experience_speed',
    title: 'Level Experience Speed',
    description: 'Accelerated multiplier for earning Charm and Wealth EXP points.',
    icon: 'flash',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: '+50% EXP Boost',
    sortOrder: 15,
  },
  {
    key: 'svip_customized_gift',
    title: 'SVIP Customized Gift',
    description: 'Exclusive 3D luxury gifts only sendable by noble members.',
    icon: 'gift',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Exclusive Gifts',
    sortOrder: 16,
  },
  {
    key: 'special_id_freeze',
    title: 'Special ID Freeze',
    description: 'Lock your vanity ID number so it can never be recycled or reclaimed.',
    icon: 'snow',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Permanent Lock',
    sortOrder: 17,
  },
  {
    key: 'hide_online_status',
    title: 'Hide Online Status',
    description: 'Appear completely offline to friends and followers while in app.',
    icon: 'eye-off',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Invisibility',
    sortOrder: 18,
  },
  {
    key: 'anti_kick',
    title: 'Anti-Kick',
    description: 'Absolute immunity against room kicks and microphone evictions.',
    icon: 'shield',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Full Immunity',
    sortOrder: 19,
  },
  {
    key: 'upgrade_app_wide_notification',
    title: 'Upgrade App-wide Notification',
    description: 'Broadcast high-priority announcement across all active rooms upon upgrade.',
    icon: 'megaphone',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Global Banner',
    sortOrder: 20,
  },
  {
    key: 'unique_3_digit_sid',
    title: 'Unique 3-digit SID',
    description: 'Unlock and equip a prestigious ultra-rare 3-digit vanity Special ID.',
    icon: 'key',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: '3-Digit SID',
    sortOrder: 21,
  },
  {
    key: 'unban_account',
    title: 'Unban Account',
    description: 'Administrative pardon for minor room-level restrictions.',
    icon: 'lock-open',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'partially_supported',
    value: 'Staff Review',
    sortOrder: 22,
  },
  {
    key: 'anti_ban_from_chatting',
    title: 'Anti-ban from Chatting',
    description: 'Immunity to automated chat muting in public voice party rooms.',
    icon: 'volume-high',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Chat Immunity',
    sortOrder: 23,
  },
  {
    key: 'badge_svip_achievement',
    title: 'Badge of SVIP Achievement',
    description: 'Golden winged achievement insignia displayed on user medal wall.',
    icon: 'medal',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Prestige Medal',
    sortOrder: 24,
  },
  {
    key: 'anonymous_ranking',
    title: 'Anonymous Ranking',
    description: 'Mask your real username on public hourly, daily, and weekly leaderboards.',
    icon: 'glasses',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Incognito',
    sortOrder: 25,
  },
  {
    key: 'customized_start_up_page',
    title: 'Customized Start-up Page',
    description: 'Personalized noble greeting splash banner upon opening YaroApp.',
    icon: 'sparkles',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Noble Welcome',
    sortOrder: 26,
  },
  {
    key: 'ban_account',
    title: 'Ban Account',
    description: 'Restricted administrative sanction power (governed by server RBAC).',
    icon: 'ban',
    isEnabled: false,
    isVisible: false,
    implementationStatus: 'coming_soon',
    value: 'Admin Only',
    sortOrder: 27,
  },
  {
    key: 'unique_2_digit_sid',
    title: 'Unique 2-digit SID',
    description: 'Crown of crowns: reserved ultra-exclusive 2-digit vanity Special ID.',
    icon: 'diamond',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: '2-Digit SID',
    sortOrder: 28,
  },
  {
    key: 'room_secret_lord',
    title: 'Room Secret Lord',
    description: 'Master control over secret private rooms and invite-only voice halls.',
    icon: 'keypad',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Lord Authority',
    sortOrder: 29,
  },
  {
    key: 'exclusive_customer_service',
    title: 'Exclusive Customer Service',
    description: '24/7 dedicated 1-on-1 VIP relationship manager line.',
    icon: 'headset',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: '24/7 Priority',
    sortOrder: 30,
  },
];

// Seed 9 Standard SVIP Plans (Knight to Emperor/King of Kings)
export const DEFAULT_SVIP_TIER_PLANS = [
  {
    name: 'SVIP 1 Knight',
    planCode: 'SVIP_1',
    slug: 'svip-1-knight',
    level: 1,
    description: 'Entry-level nobility status with custom entry tag, bronze crest, and 30% discount.',
    badge: '👑 SVIP 1',
    icon: 'shield-outline',
    crown: '🥉',
    heroBadgeUrl: 'https://cdn.yaroapp.in/svip/badges/svip_1_knight.png',
    bgGradient: ['#2A1A0A', '#1E1206', '#0F0903'],
    price: 99000,
    originalPrice: 150000,
    discountPercent: 34,
    currency: 'DIAMONDS' as const,
    durationDays: 30,
    validityType: 'days' as const,
    rechargeThreshold: 100000,
    svipTagConfig: {
      text: 'SVIP 1',
      bgGradient: ['#F59E0B', '#D97706'],
      enabled: true,
    },
    svipBubbleConfig: {
      bubbleName: 'Knight Amber Glass',
      bgGradient: ['#3A1F04', '#78350F'],
      textColor: '#FFFFFF',
      borderColor: '#F59E0B',
      enabled: true,
    },
    profileBadgeConfig: {
      badgeName: 'Knight Crest',
      iconUrl: '',
      animationType: 'pulse',
      enabled: true,
    },
    privileges: STANDARD_SCREENSHOT_PRIVILEGES.slice(0, 8),
    features: {
      enableEntryEffect: true,
      enableEntryTag: true,
      enableEntryFrame: true,
      enableAvatarFrame: true,
      enableMicWave: true,
      enableChatBubble: true,
      enableRoomTheme: true,
      enableNameEffect: true,
      enableSpecialBadge: true,
      enableSpecialSound: false,
      enableParticles: false,
      enableAntiKick: false,
      enableInvisibleVisit: false,
    },
    status: 'active' as const,
    isActive: true,
    sortOrder: 1,
  },
  {
    name: 'SVIP 2 Count',
    planCode: 'SVIP_2',
    slug: 'svip-2-count',
    level: 2,
    description: 'Prestigious Count nobility with violet aura, invisible visit, and daily bonus diamonds.',
    badge: '👑 SVIP 2',
    icon: 'shield-half-outline',
    crown: '🥈',
    heroBadgeUrl: 'https://cdn.yaroapp.in/svip/badges/svip_2_count.png',
    bgGradient: ['#28103A', '#1A0826', '#0C0314'],
    price: 180000,
    originalPrice: 270000,
    discountPercent: 33,
    currency: 'DIAMONDS' as const,
    durationDays: 30,
    validityType: 'days' as const,
    rechargeThreshold: 250000,
    svipTagConfig: {
      text: 'SVIP 2',
      bgGradient: ['#A855F7', '#7C3AED'],
      enabled: true,
    },
    svipBubbleConfig: {
      bubbleName: 'Count Amethyst',
      bgGradient: ['#3B0764', '#581C87'],
      textColor: '#FFFFFF',
      borderColor: '#C084FC',
      enabled: true,
    },
    profileBadgeConfig: {
      badgeName: 'Count Winged Crest',
      iconUrl: '',
      animationType: 'pulse',
      enabled: true,
    },
    privileges: STANDARD_SCREENSHOT_PRIVILEGES.slice(0, 12),
    features: {
      enableEntryEffect: true,
      enableEntryTag: true,
      enableEntryFrame: true,
      enableAvatarFrame: true,
      enableMicWave: true,
      enableChatBubble: true,
      enableRoomTheme: true,
      enableNameEffect: true,
      enableSpecialBadge: true,
      enableSpecialSound: true,
      enableParticles: false,
      enableAntiKick: false,
      enableInvisibleVisit: true,
    },
    status: 'active' as const,
    isActive: true,
    sortOrder: 2,
  },
  {
    name: 'SVIP 3 Duke',
    planCode: 'SVIP_3',
    slug: 'svip-3-duke',
    level: 3,
    description: 'High nobility Duke with pink neon bubble, anti-tracking, and full visitor history.',
    badge: '👑 SVIP 3',
    icon: 'shield',
    crown: '🥇',
    heroBadgeUrl: 'https://cdn.yaroapp.in/svip/badges/svip_3_duke.png',
    bgGradient: ['#380A22', '#240414', '#12020A'],
    price: 360000,
    originalPrice: 540000,
    discountPercent: 33,
    currency: 'DIAMONDS' as const,
    durationDays: 30,
    validityType: 'days' as const,
    rechargeThreshold: 500000,
    svipTagConfig: {
      text: 'SVIP 3',
      bgGradient: ['#EC4899', '#DB2777'],
      enabled: true,
    },
    svipBubbleConfig: {
      bubbleName: 'Duke Velvet Rose',
      bgGradient: ['#500724', '#831843'],
      textColor: '#FFFFFF',
      borderColor: '#F472B6',
      enabled: true,
    },
    profileBadgeConfig: {
      badgeName: 'Duke Rose Emblem',
      iconUrl: '',
      animationType: 'rotate',
      enabled: true,
    },
    privileges: STANDARD_SCREENSHOT_PRIVILEGES.slice(0, 16),
    features: {
      enableEntryEffect: true,
      enableEntryTag: true,
      enableEntryFrame: true,
      enableAvatarFrame: true,
      enableMicWave: true,
      enableChatBubble: true,
      enableRoomTheme: true,
      enableNameEffect: true,
      enableSpecialBadge: true,
      enableSpecialSound: true,
      enableParticles: true,
      enableAntiKick: true,
      enableInvisibleVisit: true,
    },
    status: 'active' as const,
    isActive: true,
    sortOrder: 3,
  },
  {
    name: 'SVIP 4 Prince',
    planCode: 'SVIP_4',
    slug: 'svip-4-prince',
    level: 4,
    description: 'Royal Prince status with crimson aura, anti-kick immunity, and 25-seat party rooms.',
    badge: '👑 SVIP 4',
    icon: 'ribbon-outline',
    crown: '👑',
    heroBadgeUrl: 'https://cdn.yaroapp.in/svip/badges/svip_4_prince.png',
    bgGradient: ['#380B0B', '#220606', '#100202'],
    price: 750000,
    originalPrice: 1125000,
    discountPercent: 33,
    currency: 'DIAMONDS' as const,
    durationDays: 30,
    validityType: 'days' as const,
    rechargeThreshold: 1000000,
    svipTagConfig: {
      text: 'SVIP 4',
      bgGradient: ['#EF4444', '#DC2626'],
      enabled: true,
    },
    svipBubbleConfig: {
      bubbleName: 'Prince Ruby Blaze',
      bgGradient: ['#450A0A', '#7F1D1D'],
      textColor: '#FFFFFF',
      borderColor: '#F87171',
      enabled: true,
    },
    profileBadgeConfig: {
      badgeName: 'Prince Phoenix Crest',
      iconUrl: '',
      animationType: 'pulse',
      enabled: true,
    },
    privileges: STANDARD_SCREENSHOT_PRIVILEGES.slice(0, 20),
    features: {
      enableEntryEffect: true,
      enableEntryTag: true,
      enableEntryFrame: true,
      enableAvatarFrame: true,
      enableMicWave: true,
      enableChatBubble: true,
      enableRoomTheme: true,
      enableNameEffect: true,
      enableSpecialBadge: true,
      enableSpecialSound: true,
      enableParticles: true,
      enableAntiKick: true,
      enableInvisibleVisit: true,
    },
    status: 'active' as const,
    isActive: true,
    sortOrder: 4,
  },
  {
    name: 'SVIP 5 King',
    planCode: 'SVIP_5',
    slug: 'svip-5-king',
    level: 5,
    description: 'Revered King of the platform with 3-digit SID, gold entrance sports car, and app-wide notices.',
    badge: '👑 SVIP 5',
    icon: 'ribbon',
    crown: '👑',
    heroBadgeUrl: 'https://cdn.yaroapp.in/svip/badges/svip_5_king.png',
    bgGradient: ['#2F1F07', '#1D1303', '#0E0901'],
    price: 1500000,
    originalPrice: 2250000,
    discountPercent: 33,
    currency: 'DIAMONDS' as const,
    durationDays: 30,
    validityType: 'days' as const,
    rechargeThreshold: 2000000,
    svipTagConfig: {
      text: 'SVIP 5',
      bgGradient: ['#FBBF24', '#D97706'],
      enabled: true,
    },
    svipBubbleConfig: {
      bubbleName: 'Imperial King Gold',
      bgGradient: ['#422006', '#713F12'],
      textColor: '#FFFFFF',
      borderColor: '#FBBF24',
      enabled: true,
    },
    profileBadgeConfig: {
      badgeName: 'Golden Eagle Crest',
      iconUrl: '',
      animationType: 'rotate',
      enabled: true,
    },
    privileges: STANDARD_SCREENSHOT_PRIVILEGES.slice(0, 24),
    features: {
      enableEntryEffect: true,
      enableEntryTag: true,
      enableEntryFrame: true,
      enableAvatarFrame: true,
      enableMicWave: true,
      enableChatBubble: true,
      enableRoomTheme: true,
      enableNameEffect: true,
      enableSpecialBadge: true,
      enableSpecialSound: true,
      enableParticles: true,
      enableAntiKick: true,
      enableInvisibleVisit: true,
    },
    status: 'active' as const,
    isActive: true,
    sortOrder: 5,
  },
  {
    name: 'SVIP 9 King of Kings',
    planCode: 'SVIP_9',
    slug: 'svip-9-king-of-kings',
    level: 9,
    description: 'Supreme Emperor & King of Kings. 2-Digit SID, full immunity, Room Secret Lord, and VIP concierge.',
    badge: '👑 SVIP 9',
    icon: 'trophy',
    crown: '👑',
    heroBadgeUrl: 'https://cdn.yaroapp.in/svip/badges/svip_9_emperor.png',
    bgGradient: ['#3B0764', '#1E0436', '#0E011A'],
    price: 5000000,
    originalPrice: 8000000,
    discountPercent: 37,
    currency: 'DIAMONDS' as const,
    durationDays: 30,
    validityType: 'days' as const,
    rechargeThreshold: 10000000,
    svipTagConfig: {
      text: 'KING OF KINGS',
      bgGradient: ['#FF0080', '#7928CA', '#0070F3'],
      enabled: true,
    },
    svipBubbleConfig: {
      bubbleName: 'Rainbow Emperor Shimmer',
      bgGradient: ['#3B0764', '#581C87', '#1E1B4B'],
      textColor: '#FFFFFF',
      borderColor: '#EC4899',
      enabled: true,
    },
    profileBadgeConfig: {
      badgeName: 'Supreme Sovereign Insignia',
      iconUrl: '',
      animationType: 'rotate',
      enabled: true,
    },
    privileges: STANDARD_SCREENSHOT_PRIVILEGES,
    features: {
      enableEntryEffect: true,
      enableEntryTag: true,
      enableEntryFrame: true,
      enableAvatarFrame: true,
      enableMicWave: true,
      enableChatBubble: true,
      enableRoomTheme: true,
      enableNameEffect: true,
      enableSpecialBadge: true,
      enableSpecialSound: true,
      enableParticles: true,
      enableAntiKick: true,
      enableInvisibleVisit: true,
    },
    status: 'active' as const,
    isActive: true,
    sortOrder: 9,
  },
];

/* =========================================================================
   PUBLIC / MOBILE CLIENT APIS
========================================================================= */

export const getPublishedSvipPlans = async (_req: Request, res: Response) => {
  try {
    const count = await SvipTier.countDocuments();
    if (count === 0) {
      await SvipTier.insertMany(DEFAULT_SVIP_TIER_PLANS);
    }

    const plans = await SvipTier.find({
      status: 'active',
      isActive: true,
    })
      .sort({ sortOrder: 1, level: 1 })
      .lean();

    return sendResponse(res, 200, true, 'Published SVIP plans fetched', {
      total: plans.length,
      plans,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch SVIP plans');
  }
};

export const getSvipPlanDetails = async (req: Request, res: Response) => {
  try {
    const { idOrSlug } = req.params;
    let plan = null;

    if (mongoose.Types.ObjectId.isValid(idOrSlug)) {
      plan = await SvipTier.findById(idOrSlug).lean();
    }
    if (!plan) {
      plan = await SvipTier.findOne({ slug: idOrSlug }).lean();
    }
    if (!plan && !isNaN(Number(idOrSlug))) {
      plan = await SvipTier.findOne({ level: Number(idOrSlug) }).lean();
    }

    if (!plan) {
      return sendResponse(res, 404, false, 'SVIP plan not found');
    }

    return sendResponse(res, 200, true, 'SVIP plan details fetched', plan);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch plan details');
  }
};

/* =========================================================================
   PURCHASE & ENTITLEMENT TRANSACTION
========================================================================= */

export const purchaseSvipPlan = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { planIdOrSlug, requestId } = req.body;

    if (!userId) return sendResponse(res, 401, false, 'Unauthorized');
    if (!planIdOrSlug) return sendResponse(res, 400, false, 'Plan identifier is required');

    let plan = null;
    if (mongoose.Types.ObjectId.isValid(planIdOrSlug)) {
      plan = await SvipTier.findById(planIdOrSlug);
    }
    if (!plan) {
      plan = await SvipTier.findOne({ slug: planIdOrSlug });
    }
    if (!plan && !isNaN(Number(planIdOrSlug))) {
      plan = await SvipTier.findOne({ level: Number(planIdOrSlug) });
    }

    if (!plan || !plan.isActive || plan.status !== 'active') {
      return sendResponse(res, 400, false, 'This SVIP plan is currently unavailable for purchase');
    }

    const price = Math.max(0, plan.price);
    const targetUser = await User.findOne({
      $or: [
        { _id: typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : null },
        { userId: !isNaN(Number(userId)) ? Number(userId) : -1 },
      ],
      isDeleted: false,
    });

    if (!targetUser) return sendResponse(res, 404, false, 'User account not found');

    if ((targetUser.diamonds || 0) < price) {
      return sendResponse(
        res,
        400,
        false,
        `Insufficient diamonds. Required: ${price.toLocaleString()} 💎, Available: ${(targetUser.diamonds || 0).toLocaleString()} 💎`
      );
    }

    // Atomic diamond deduction with concurrency protection
    const updatedUser = await User.findOneAndUpdate(
      { _id: targetUser._id, diamonds: { $gte: price } },
      {
        $inc: { diamonds: -price },
        $addToSet: { ownedSvipIds: plan.slug },
        $set: {
          equippedSvipId: plan.slug,
          equippedVipExpiresAt: new Date(Date.now() + (plan.durationDays || 30) * 24 * 60 * 60 * 1000),
        },
      },
      { new: true }
    );

    if (!updatedUser) {
      return sendResponse(res, 409, false, 'Diamond balance changed concurrently. Please retry.');
    }

    // Server-Authoritative Entitlement Registration
    const permanentNumericId = Number(updatedUser.userId);
    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + (plan.durationDays || 30) * 24 * 60 * 60 * 1000);

    // Deactivate previous active SVIP entitlements for this user
    await IdentityEntitlement.updateMany(
      { userId: permanentNumericId, type: 'svip_tier', status: 'active' },
      { $set: { status: 'expired' } }
    );

    const entitlement = await IdentityEntitlement.create({
      userId: permanentNumericId,
      userObjectId: updatedUser._id,
      type: 'svip_tier',
      config: {
        planCode: plan.planCode || `SVIP_${plan.level}`,
        slug: plan.slug,
        level: plan.level,
        tierName: plan.name,
        badge: plan.badge,
        heroBadgeUrl: plan.heroBadgeUrl,
        svipTagConfig: plan.svipTagConfig,
        svipBubbleConfig: plan.svipBubbleConfig,
        profileBadgeConfig: plan.profileBadgeConfig,
        privileges: plan.privileges,
      },
      status: 'active',
      startsAt,
      expiresAt,
      grantedBy: {
        adminName: 'Self-Purchase',
        role: 'user',
      },
      grantSource: 'purchase',
      grantReason: `Purchased ${plan.name} for ${price} Diamonds`,
    });

    // Record audit log
    await IdentityAuditLog.create({
      action: 'grant_entitlement',
      targetUserId: permanentNumericId,
      targetUserObjectId: updatedUser._id,
      targetUserName: updatedUser.name || updatedUser.userName,
      entitlementType: 'svip_tier',
      details: {
        planSlug: plan.slug,
        level: plan.level,
        priceDiamonds: price,
        durationDays: plan.durationDays,
        expiresAt,
      },
      performedBy: {
        adminId: updatedUser._id,
        adminName: updatedUser.name || 'User',
        role: 'user',
      },
    });

    // Award wealth EXP
    LevelService.addWealthExp(updatedUser._id as any, price, 'svip_purchase', plan.slug).catch((err) =>
      console.warn('Wealth EXP award notice:', err?.message)
    );

    // Resolve real-time effective identity
    const effectiveIdentity = await IdentityResolverService.resolveEffectiveIdentity(permanentNumericId);

    return sendResponse(res, 200, true, `Congratulations! You have successfully unlocked ${plan.name}! 👑`, {
      plan,
      entitlement,
      effectiveIdentity,
      remainingDiamonds: updatedUser.diamonds,
    });
  } catch (error: any) {
    await Logger('purchaseSvipPlan', error);
    return sendResponse(res, 500, false, error.message || 'Failed to complete SVIP purchase');
  }
};

/* =========================================================================
   ADMIN CRUD & PLAN MANAGEMENT
========================================================================= */

export const adminListSvipPlans = async (req: Request, res: Response) => {
  try {
    const { status, search } = req.query as any;
    const count = await SvipTier.countDocuments();
    if (count === 0) {
      await SvipTier.insertMany(DEFAULT_SVIP_TIER_PLANS);
    }

    const query: any = {};
    if (status && status !== 'all') {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
        { planCode: { $regex: search, $options: 'i' } },
      ];
    }

    const plans = await SvipTier.find(query).sort({ sortOrder: 1, level: 1 }).lean();
    return sendResponse(res, 200, true, 'Admin SVIP plans fetched', {
      total: plans.length,
      plans,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to list admin SVIP plans');
  }
};

export const adminCreateSvipPlan = async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    if (!data.name || data.level === undefined || data.price === undefined) {
      return sendResponse(res, 400, false, 'Plan name, level, and price are required');
    }

    const slug = data.slug || `svip-${data.level}-${data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const planCode = data.planCode || `SVIP_${data.level}`;

    // Collision check
    const existing = await SvipTier.findOne({ $or: [{ slug }, { level: data.level }] });
    if (existing) {
      return sendResponse(res, 409, false, `SVIP Plan with level ${data.level} or slug "${slug}" already exists`);
    }

    const newPlan = await SvipTier.create({
      ...data,
      slug,
      planCode,
      status: data.status || 'active',
      isActive: data.status !== 'inactive' && data.status !== 'archived',
    });

    await IdentityAuditLog.create({
      action: 'create_effect',
      details: { actionType: 'create_svip_plan', planCode: newPlan.planCode, name: newPlan.name, level: newPlan.level },
      performedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
    });

    return sendResponse(res, 201, true, `SVIP Plan "${newPlan.name}" created successfully!`, newPlan);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to create SVIP plan');
  }
};

export const adminUpdateSvipPlan = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

    if (data.status) {
      data.isActive = data.status === 'active';
    }

    const updated = await SvipTier.findByIdAndUpdate(id, data, { new: true });
    if (!updated) {
      return sendResponse(res, 404, false, 'SVIP Plan not found');
    }

    await IdentityAuditLog.create({
      action: 'create_effect',
      details: { actionType: 'update_svip_plan', id: updated._id, name: updated.name },
      performedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
    });

    return sendResponse(res, 200, true, `SVIP Plan "${updated.name}" updated successfully`, updated);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to update SVIP plan');
  }
};

export const adminDuplicateSvipPlan = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const sourcePlan = await SvipTier.findById(id).lean();
    if (!sourcePlan) return sendResponse(res, 404, false, 'Source SVIP plan not found');

    const maxLevel = (await SvipTier.findOne().sort({ level: -1 }).lean())?.level || sourcePlan.level;
    const nextLevel = maxLevel + 1;

    const duplicated = await SvipTier.create({
      ...sourcePlan,
      _id: undefined,
      name: `${sourcePlan.name} (Copy)`,
      planCode: `SVIP_${nextLevel}`,
      slug: `${sourcePlan.slug}-copy-${Date.now()}`,
      level: nextLevel,
      status: 'draft',
      isActive: false,
      sortOrder: nextLevel,
    });

    return sendResponse(res, 201, true, `Plan duplicated as "${duplicated.name}" (Draft)`, duplicated);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to duplicate plan');
  }
};

export const adminToggleSvipPlan = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const plan = await SvipTier.findById(id);
    if (!plan) return sendResponse(res, 404, false, 'SVIP plan not found');

    const newActiveState = !plan.isActive;
    plan.isActive = newActiveState;
    plan.status = newActiveState ? 'active' : 'inactive';
    await plan.save();

    return sendResponse(res, 200, true, `Plan "${plan.name}" is now ${newActiveState ? 'Active' : 'Inactive'}`, plan);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to toggle plan');
  }
};

export const adminDeleteSvipPlan = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await SvipTier.findByIdAndDelete(id);
    if (!deleted) return sendResponse(res, 404, false, 'SVIP plan not found');

    return sendResponse(res, 200, true, `SVIP Plan "${deleted.name}" deleted successfully`);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to delete SVIP plan');
  }
};
