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

// 30 Standard Screenshot Reference Privileges with exact unlock levels
export const STANDARD_SCREENSHOT_PRIVILEGES: ISvipPrivilegeConfig[] = [
  {
    key: 'rank_the_top',
    title: 'Rank the Top',
    description: 'Pin your profile to the top of room visitor and contributor lists.',
    icon: 'trophy',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/rank_the_top.png',
    animationUrl: '',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Top #1 Priority',
    unlockLevel: 0,
    sortOrder: 1,
  },
  {
    key: 'colorful_nickname',
    title: 'Colorful Nickname',
    description: 'Dynamic gradient and animated colors for your display name.',
    icon: 'palette',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/colorful_nickname.png',
    animationUrl: '',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Multi-Color Gradient',
    unlockLevel: 0,
    sortOrder: 2,
  },
  {
    key: 'view_more_visitors',
    title: 'View More visitors',
    description: 'Unlock full visitor history without time or count limits.',
    icon: 'eye',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/view_more_visitors.png',
    animationUrl: '',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Unlimited History',
    unlockLevel: 0,
    sortOrder: 3,
  },
  {
    key: 'special_room_entry',
    title: 'Special Room Entry',
    description: 'Luxury animated 3D sports car and phoenix arrival notice.',
    icon: 'car-sport',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/special_room_entry.png',
    animationUrl: '',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: '3D Luxury Vehicle',
    unlockLevel: 0,
    sortOrder: 4,
  },
  {
    key: 'unlimited_message',
    title: 'Unlimited message',
    description: 'Bypass message frequency limits in voice party rooms and chats.',
    icon: 'chatbubbles',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/unlimited_message.png',
    animationUrl: '',
    isEnabled: true,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Zero Cooldown',
    unlockLevel: 0,
    sortOrder: 5,
  },
  {
    key: 'unlock_more_room_mic',
    title: 'Unlock More Room Mic',
    description: 'Expand your owned voice rooms to 25 simultaneous microphone seats.',
    icon: 'mic',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/unlock_more_room_mic.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: '25 Mic Seats',
    unlockLevel: 1,
    sortOrder: 6,
  },
  {
    key: 'send_pictures_private_chat',
    title: 'Send pictures in private chat',
    description: 'Send high-resolution photo messages directly in 1-on-1 private chat.',
    icon: 'images',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/send_pictures_private_chat.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'HD Photos',
    unlockLevel: 1,
    sortOrder: 7,
  },
  {
    key: 'modify_profile_gender',
    title: 'Modify Profile Gender',
    description: 'Change gender settings without standard cooldown constraints.',
    icon: 'transgender',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/modify_profile_gender.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Flexible Edit',
    unlockLevel: 1,
    sortOrder: 8,
  },
  {
    key: 'hide_last_online',
    title: 'Hide Last Online',
    description: 'Keep your exact last-active timestamp private from other users.',
    icon: 'time',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/hide_last_online.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Stealth Mode',
    unlockLevel: 2,
    sortOrder: 9,
  },
  {
    key: 'profile_vehicle',
    title: 'Profile Vehicle',
    description: 'Equip an animated luxury hover vehicle on your profile card.',
    icon: 'airplane',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/profile_vehicle.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Luxury Ride',
    unlockLevel: 2,
    sortOrder: 10,
  },
  {
    key: 'anti_tracking',
    title: 'Anti-Tracking',
    description: 'Prevent other users from tracking which room you are currently visiting.',
    icon: 'shield-checkmark',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/anti_tracking.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Ghost Mode',
    unlockLevel: 2,
    sortOrder: 11,
  },
  {
    key: 'send_pictures_chat_room',
    title: 'Send Pictures in Chat Room',
    description: 'Post media photos directly into public room live feeds.',
    icon: 'camera',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/send_pictures_chat_room.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Room Feeds',
    unlockLevel: 3,
    sortOrder: 12,
  },
  {
    key: 'customized_profile_background',
    title: 'Customized Profile Background',
    description: 'Set custom animated wallpaper on your personal profile detail sheet.',
    icon: 'image',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/customized_profile_background.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Custom Wallpaper',
    unlockLevel: 3,
    sortOrder: 13,
  },
  {
    key: 'gif_avatar',
    title: 'Gif Avatar',
    description: 'Upload dynamic moving GIF images as your user avatar.',
    icon: 'film',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/gif_avatar.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Animated GIF',
    unlockLevel: 3,
    sortOrder: 14,
  },
  {
    key: 'level_experience_speed',
    title: 'Level experience speed up',
    description: 'Accelerated multiplier for earning Charm and Wealth EXP points.',
    icon: 'flash',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/level_experience_speed.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: '+50% EXP Boost',
    unlockLevel: 4,
    sortOrder: 15,
  },
  {
    key: 'svip_customized_gift',
    title: 'SVIP Customized Gift',
    description: 'Exclusive 3D luxury gifts only sendable by noble members.',
    icon: 'gift',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/svip_customized_gift.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Exclusive Gifts',
    unlockLevel: 4,
    sortOrder: 16,
  },
  {
    key: 'special_id_freeze',
    title: '15-day Special ID freeze',
    description: 'Lock your vanity ID number so it can never be recycled or reclaimed.',
    icon: 'snow',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/special_id_freeze.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: '15-Day Lock',
    unlockLevel: 4,
    sortOrder: 17,
  },
  {
    key: 'hide_online_status',
    title: 'Hide Online Status',
    description: 'Appear completely offline to friends and followers while in app.',
    icon: 'eye-off',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/hide_online_status.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Invisibility',
    unlockLevel: 5,
    sortOrder: 18,
  },
  {
    key: 'anti_kick',
    title: 'Anti-Kick',
    description: 'Absolute immunity against room kicks and microphone evictions.',
    icon: 'shield',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/anti_kick.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Full Immunity',
    unlockLevel: 5,
    sortOrder: 19,
  },
  {
    key: 'upgrade_app_wide_notification',
    title: 'Upgrade App-wide Notification',
    description: 'Broadcast high-priority announcement across all active rooms upon upgrade.',
    icon: 'megaphone',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/upgrade_app_wide_notification.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Global Banner',
    unlockLevel: 5,
    sortOrder: 20,
  },
  {
    key: 'unique_3_digit_sid',
    title: 'Unique 3-digit SID',
    description: 'Unlock and equip a prestigious ultra-rare 3-digit vanity Special ID.',
    icon: 'key',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/unique_3_digit_sid.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: '3-Digit SID',
    unlockLevel: 6,
    sortOrder: 21,
  },
  {
    key: 'unban_account',
    title: 'Unban Account',
    description: 'Administrative pardon for minor room-level restrictions.',
    icon: 'lock-open',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/unban_account.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'partially_supported',
    value: 'Staff Review',
    unlockLevel: 6,
    sortOrder: 22,
  },
  {
    key: 'anti_ban_from_chatting',
    title: 'Anti-ban from Chatting',
    description: 'Immunity to automated chat muting in public voice party rooms.',
    icon: 'volume-high',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/anti_ban_from_chatting.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Chat Immunity',
    unlockLevel: 7,
    sortOrder: 23,
  },
  {
    key: 'badge_svip_achievement',
    title: 'Badge of SVIP Achievement',
    description: 'Golden winged achievement insignia displayed on user medal wall.',
    icon: 'medal',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/badge_svip_achievement.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Prestige Medal',
    unlockLevel: 7,
    sortOrder: 24,
  },
  {
    key: 'anonymous_ranking',
    title: 'Anonymous Ranking',
    description: 'Mask your real username on public hourly, daily, and weekly leaderboards.',
    icon: 'glasses',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/anonymous_ranking.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Incognito',
    unlockLevel: 8,
    sortOrder: 25,
  },
  {
    key: 'customized_start_up_page',
    title: 'Customized Start-up Page',
    description: 'Personalized noble greeting splash banner upon opening YaroApp.',
    icon: 'sparkles',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/customized_start_up_page.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Noble Welcome',
    unlockLevel: 8,
    sortOrder: 26,
  },
  {
    key: 'ban_account',
    title: 'Ban Account',
    description: 'Restricted administrative sanction power (governed by server RBAC).',
    icon: 'ban',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/ban_account.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: false,
    implementationStatus: 'coming_soon',
    value: 'Admin Authority',
    unlockLevel: 9,
    sortOrder: 27,
  },
  {
    key: 'unique_2_digit_sid',
    title: 'Unique 2-digit SID',
    description: 'Crown of crowns: reserved ultra-exclusive 2-digit vanity Special ID.',
    icon: 'diamond',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/unique_2_digit_sid.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: '2-Digit SID',
    unlockLevel: 9,
    sortOrder: 28,
  },
  {
    key: 'room_secret_lord',
    title: 'Room Secret Lord',
    description: 'Master control over secret private rooms and invite-only voice halls.',
    icon: 'keypad',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/room_secret_lord.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: 'Lord Authority',
    unlockLevel: 10,
    sortOrder: 29,
  },
  {
    key: 'unique_1_digit_sid',
    title: 'Unique 1-digit SID',
    description: 'Sovereign single-digit SID and 24/7 dedicated executive concierge.',
    icon: 'crown',
    previewUrl: 'https://cdn.yaroapp.in/svip/privileges/unique_1_digit_sid.png',
    animationUrl: '',
    isEnabled: false,
    isVisible: true,
    implementationStatus: 'supported',
    value: '1-Digit Sovereign SID',
    unlockLevel: 11,
    sortOrder: 30,
  },
];

// Tier builder function
function buildSvipTier(
  name: string,
  planCode: string,
  slug: string,
  level: number,
  price: number,
  originalPrice: number,
  discount: number,
  rechargeThreshold: number,
  unlockedCount: number,
  tagText: string,
  tagColors: string[],
  bubbleName: string,
  bubbleColors: string[],
  bubbleBorder: string,
  badgeUrl: string
) {
  const privileges = STANDARD_SCREENSHOT_PRIVILEGES.map((p, idx) => ({
    ...p,
    isEnabled: idx < unlockedCount,
  }));

  return {
    name,
    planCode,
    slug,
    level,
    description: `Level ${level} Nobility Tier granting ${unlockedCount} exclusive privileges and luxury assets.`,
    badge: level === 0 ? '👑 VIP+' : `👑 SVIP ${level}`,
    icon: 'diamond',
    crown: '👑',
    heroBadgeUrl: badgeUrl,
    heroAnimationUrl: '',
    heroBadgePreviewUrl: '',
    bgGradient: ['#1E140D', '#2A1C13', '#160E09'],
    price,
    originalPrice,
    discountPercent: discount,
    currency: 'DIAMONDS' as const,
    durationDays: 30,
    validityType: 'days' as const,
    rechargeThreshold,
    svipTagConfig: {
      text: tagText,
      bgGradient: tagColors,
      iconUrl: '',
      previewUrl: '',
      enabled: true,
    },
    svipBubbleConfig: {
      bubbleName,
      previewUrl: '',
      animationUrl: '',
      bgGradient: bubbleColors,
      textColor: '#FFFFFF',
      borderColor: bubbleBorder,
      enabled: true,
    },
    profileBadgeConfig: {
      badgeName: `${name} Crest`,
      iconUrl: '',
      animationType: 'pulse',
      enabled: true,
    },
    privileges,
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
      enableSpecialSound: level >= 2,
      enableParticles: level >= 3,
      enableAntiKick: level >= 5,
      enableInvisibleVisit: level >= 2,
    },
    status: 'active' as const,
    isActive: true,
    sortOrder: level,
  };
}

// 13 Standard SVIP Plans (VIP+ & SVIP 1 to 12)
export const DEFAULT_SVIP_TIER_PLANS = [
  buildSvipTier('VIP+', 'VIP_PLUS', 'vip-plus', 0, 49000, 75000, 35, 50000, 5, 'VIP+', ['#3B82F6', '#1D4ED8'], 'VIP+ Frost Blue', ['#1E3A8A', '#1E40AF'], '#60A5FA', 'https://cdn.yaroapp.in/svip/badges/lynx_vip_plus.png'),
  buildSvipTier('SVIP 1 Knight', 'SVIP_1', 'svip-1-knight', 1, 99000, 150000, 34, 100000, 8, 'SVIP 1', ['#F59E0B', '#D97706'], 'Knight Amber Glass', ['#3A1F04', '#78350F'], '#F59E0B', 'https://cdn.yaroapp.in/svip/badges/svip_1_knight.png'),
  buildSvipTier('SVIP 2 Count', 'SVIP_2', 'svip-2-count', 2, 180000, 270000, 33, 250000, 11, 'SVIP 2', ['#A855F7', '#7C3AED'], 'Count Amethyst', ['#3B0764', '#581C87'], '#C084FC', 'https://cdn.yaroapp.in/svip/badges/svip_2_count.png'),
  buildSvipTier('SVIP 3 Duke', 'SVIP_3', 'svip-3-duke', 3, 360000, 540000, 33, 500000, 14, 'SVIP 3', ['#EC4899', '#DB2777'], 'Duke Velvet Rose', ['#500724', '#831843'], '#F472B6', 'https://cdn.yaroapp.in/svip/badges/svip_3_duke.png'),
  buildSvipTier('SVIP 4 Prince', 'SVIP_4', 'svip-4-prince', 4, 750000, 1125000, 33, 1000000, 17, 'SVIP 4', ['#EF4444', '#DC2626'], 'Prince Ruby Blaze', ['#450A0A', '#7F1D1D'], '#F87171', 'https://cdn.yaroapp.in/svip/badges/svip_4_prince.png'),
  buildSvipTier('SVIP 5 King', 'SVIP_5', 'svip-5-king', 5, 1500000, 2250000, 33, 2000000, 20, 'SVIP 5', ['#FBBF24', '#D97706'], 'Imperial King Gold', ['#422006', '#713F12'], '#FBBF24', 'https://cdn.yaroapp.in/svip/badges/svip_5_king.png'),
  buildSvipTier('SVIP 6 Grand Duke', 'SVIP_6', 'svip-6-grand-duke', 6, 2500000, 3750000, 33, 3500000, 22, 'SVIP 6', ['#10B981', '#059669'], 'Grand Emerald Shine', ['#064E3B', '#065F46'], '#34D399', 'https://cdn.yaroapp.in/svip/badges/svip_6_emerald.png'),
  buildSvipTier('SVIP 7 Archduke', 'SVIP_7', 'svip-7-archduke', 7, 3800000, 5700000, 33, 5000000, 24, 'SVIP 7', ['#06B6D4', '#0891B2'], 'Archduke Cyan Flame', ['#164E63', '#155E75'], '#22D3EE', 'https://cdn.yaroapp.in/svip/badges/svip_7_cyan.png'),
  buildSvipTier('SVIP 8 Crown Prince', 'SVIP_8', 'svip-8-crown-prince', 8, 5500000, 8250000, 33, 7500000, 26, 'SVIP 8', ['#8B5CF6', '#6D28D9'], 'Sovereign Violet Prism', ['#2E1065', '#4C1D95'], '#A78BFA', 'https://cdn.yaroapp.in/svip/badges/svip_8_prince.png'),
  buildSvipTier('SVIP 9 King of Kings', 'SVIP_9', 'svip-9-king-of-kings', 9, 8000000, 12000000, 33, 10000000, 28, 'SVIP 9', ['#F43F5E', '#BE123C'], 'Crimson Emperor Star', ['#4C0519', '#881337'], '#FB7185', 'https://cdn.yaroapp.in/svip/badges/svip_9_emperor.png'),
  buildSvipTier('SVIP 10 Lord of Realms', 'SVIP_10', 'svip-10-lord', 10, 12000000, 18000000, 33, 15000000, 29, 'SVIP 10', ['#D946EF', '#A21CAF'], 'Realm Lord Aurora', ['#4A044E', '#701A75'], '#E879F9', 'https://cdn.yaroapp.in/svip/badges/svip_10_lord.png'),
  buildSvipTier('SVIP 11 Supreme Sovereign', 'SVIP_11', 'svip-11-sovereign', 11, 18000000, 27000000, 33, 22000000, 30, 'SVIP 11', ['#EAB308', '#CA8A04'], 'Supreme Golden Dragon', ['#422006', '#713F12'], '#FACC15', 'https://cdn.yaroapp.in/svip/badges/svip_11_dragon.png'),
  buildSvipTier('SVIP 12 Sovereign Emperor', 'SVIP_12', 'svip-12-emperor', 12, 25000000, 40000000, 37, 30000000, 30, 'SVIP 12', ['#FF0080', '#7928CA', '#0070F3'], 'Rainbow Emperor Supreme', ['#3B0764', '#581C87', '#1E1B4B'], '#EC4899', 'https://cdn.yaroapp.in/svip/badges/svip_12_emperor.png'),
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
          equippedSvipExpiresAt: new Date(Date.now() + (plan.durationDays || 30) * 24 * 60 * 60 * 1000),
          isSvip: true,
          svipLevel: plan.level,
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

export const adminReseedSvipPlans = async (req: AuthRequest, res: Response) => {
  try {
    const { confirm = false } = req.body || {};
    const existingCount = await SvipTier.countDocuments();

    if (existingCount > 0 && !confirm) {
      return sendResponse(
        res,
        400,
        false,
        'Explicit confirmation required: Reseeding will overwrite all custom SVIP plans. Pass { confirm: true } to proceed.'
      );
    }

    await SvipTier.deleteMany({});
    const inserted = await SvipTier.insertMany(DEFAULT_SVIP_TIER_PLANS);

    await IdentityAuditLog.create({
      action: 'create_effect',
      details: { actionType: 'reseed_svip_plans', count: inserted.length },
      performedBy: {
        adminId: (req.user as any)?._id || req.user?.id,
        adminName: req.user?.name || (req.user as any)?.userName || 'Admin',
        role: req.user?.role || 'admin',
      },
    });

    return sendResponse(res, 200, true, `Successfully reseeded all ${inserted.length} SVIP tiers (VIP+ & SVIP 1-12) with 30 privileges!`, {
      total: inserted.length,
      plans: inserted,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to reseed SVIP plans');
  }
};
