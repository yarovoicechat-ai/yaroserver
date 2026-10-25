import { Request, Response } from 'express';
import { isValidObjectId } from 'mongoose';
import { KingTier, IKingRewardItem, IKingPrivilegeItem } from '../models/kingTier.model';
import { User } from '../models/user.model';
import { IdentityEntitlement } from '../models/identityEntitlement.model';
import { IdentityAuditLog } from '../models/identityAuditLog.model';
import { IdentityResolverService } from '../services/identityResolver.service';
import { AuthRequest } from '../middlewares/authorize.middleware';
import sendResponse from '../utils/reponse';
import { Logger } from '../utils/logger';

// 11 Standard Reward Assets from Screenshot
export const STANDARD_KING_REWARDS: IKingRewardItem[] = [
  {
    key: 'activation_bonus',
    title: 'Activation bonus',
    description: 'Bonus coins credited once on paid activation; privileges last for 30 days.',
    icon: 'cash',
    previewUrl: 'https://cdn.yaroapp.in/king/rewards/daily_coins.png',
    animationUrl: '',
    value: 'One-time bonus',
    isEnabled: true,
    sortOrder: 1,
  },
  {
    key: 'active_notification_broadcast',
    title: 'Active notification broadcast',
    description: 'High-visibility illuminated banner broadcast upon room entry.',
    icon: 'megaphone',
    previewUrl: 'https://cdn.yaroapp.in/king/rewards/broadcast.png',
    animationUrl: '',
    value: 'Royal Banner',
    isEnabled: true,
    sortOrder: 2,
  },
  {
    key: 'exclusive_logo',
    title: 'Exclusive logo',
    description: 'Golden nobility crest logo badge displayed next to nickname.',
    icon: 'shield',
    previewUrl: 'https://cdn.yaroapp.in/king/rewards/exclusive_logo.png',
    animationUrl: '',
    value: 'Nobility Logo',
    isEnabled: true,
    sortOrder: 3,
  },
  {
    key: 'kings_badge',
    title: 'Kings badge',
    description: 'Prestigious golden stag winged crest badge on profile and card.',
    icon: 'ribbon',
    previewUrl: 'https://cdn.yaroapp.in/king/rewards/kings_badge.png',
    animationUrl: '',
    value: 'Winged Crest',
    isEnabled: true,
    sortOrder: 4,
  },
  {
    key: 'avatar_frame',
    title: 'Avatar frame',
    description: 'Dynamic golden stag horn avatar decorative frame.',
    icon: 'disc',
    previewUrl: 'https://cdn.yaroapp.in/king/rewards/avatar_frame.png',
    animationUrl: '',
    value: 'Ornate Frame',
    isEnabled: true,
    sortOrder: 5,
  },
  {
    key: 'entry_effects',
    title: 'Entry effects',
    description: 'Animated golden sword scepter arrival fanfare in voice rooms.',
    icon: 'flash',
    previewUrl: 'https://cdn.yaroapp.in/king/rewards/entry_effect.png',
    animationUrl: '',
    value: 'Sovereign Sword',
    isEnabled: true,
    sortOrder: 6,
  },
  {
    key: 'exclusive_barrage',
    title: 'Exclusive barrage',
    description: 'Luxury floating chat barrage message styling.',
    icon: 'chatbubbles',
    previewUrl: 'https://cdn.yaroapp.in/king/rewards/barrage.png',
    animationUrl: '',
    value: 'Gold Barrage',
    isEnabled: true,
    sortOrder: 7,
  },
  {
    key: 'room_theme',
    title: 'Noble Room Theme',
    description: 'Imperial velvet gold wallpaper theme for owned rooms.',
    icon: 'color-palette',
    previewUrl: 'https://cdn.yaroapp.in/king/rewards/room_theme.png',
    animationUrl: '',
    value: 'Imperial Theme',
    isEnabled: false,
    sortOrder: 8,
  },
  {
    key: 'mic_wave',
    title: 'Mic Wave Aura',
    description: 'Starlight pulsing microphone wave effect.',
    icon: 'radio',
    previewUrl: 'https://cdn.yaroapp.in/king/rewards/mic_wave.png',
    animationUrl: '',
    value: 'Gold Wave',
    isEnabled: false,
    sortOrder: 9,
  },
  {
    key: 'name_glow',
    title: 'Colorful Name Glow',
    description: 'Glowing animated gradient nickname typography.',
    icon: 'sparkles',
    previewUrl: 'https://cdn.yaroapp.in/king/rewards/name_glow.png',
    animationUrl: '',
    value: 'Sunburst Glow',
    isEnabled: false,
    sortOrder: 10,
  },
  {
    key: 'special_sound',
    title: 'Special Arrival Fanfare',
    description: 'Orchestral royal trumpet sound effect on room entry.',
    icon: 'musical-notes',
    previewUrl: 'https://cdn.yaroapp.in/king/rewards/sound.png',
    animationUrl: '',
    value: 'Trumpet Sound',
    isEnabled: false,
    sortOrder: 11,
  },
];

// 13 Standard Exclusive Privileges from Screenshot
export const STANDARD_KING_PRIVILEGES: IKingPrivilegeItem[] = [
  {
    key: 'exclusive_gifts',
    title: 'Exclusive gifts',
    description: 'Send exclusive 3D luxury King of Kings gifts in voice party rooms.',
    icon: 'gift',
    previewUrl: '',
    animationUrl: '',
    powerDescription: 'Unlock prestigious luxury gifts sendable only by Kings members.',
    value: '3D Gifts',
    isEnabled: true,
    unlockLevel: 1,
    sortOrder: 1,
  },
  {
    key: 'room_message_translation',
    title: 'Room message translation',
    description: 'Instant multi-language AI translation for foreign room messages.',
    icon: 'globe',
    previewUrl: '',
    animationUrl: '',
    powerDescription: 'Read chat messages in any language translated to your dialect.',
    value: 'Instant AI',
    isEnabled: true,
    unlockLevel: 1,
    sortOrder: 2,
  },
  {
    key: 'exclusive_emoticons',
    title: 'Exclusive emoticons',
    description: 'High-definition animated noble emoji & reactions.',
    icon: 'happy',
    previewUrl: '',
    animationUrl: '',
    powerDescription: 'Express yourself with royal animated emoticons in chat rooms.',
    value: 'HD Pack',
    isEnabled: true,
    unlockLevel: 1,
    sortOrder: 3,
  },
  {
    key: 'customized_party_background',
    title: 'Customized party background',
    description: 'Set custom photos or wallpaper for your personal voice party room.',
    icon: 'image',
    previewUrl: '',
    animationUrl: '',
    powerDescription: 'Decorate your owned voice room with customized party backgrounds.',
    value: 'Custom Wallpaper',
    isEnabled: true,
    unlockLevel: 1,
    sortOrder: 4,
  },
  {
    key: 'invisible_access',
    title: 'Invisible access',
    description: 'Browse room visitor lists and member profiles without leaving footprints.',
    icon: 'document-text',
    previewUrl: '',
    animationUrl: '',
    powerDescription: 'Full visitor viewing without your profile showing on the history log.',
    value: 'Zero Footprint',
    isEnabled: false,
    unlockLevel: 2,
    sortOrder: 5,
  },
  {
    key: '25_people_voice_room',
    title: '25 people voice room',
    description: 'Expand your voice rooms to 25 simultaneous microphone seats.',
    icon: 'people',
    previewUrl: '',
    animationUrl: '',
    powerDescription: 'Mega party capacity allowing up to 25 active mic participants.',
    value: '25 Mic Seats',
    isEnabled: false,
    unlockLevel: 2,
    sortOrder: 6,
  },
  {
    key: 'online_invisibility',
    title: 'Online invisibility',
    description: 'Appear completely offline to followers and friends across the app.',
    icon: 'eye-off',
    previewUrl: '',
    animationUrl: '',
    powerDescription: 'Stealth status hiding your active state across friends lists.',
    value: 'Ghost Cloak',
    isEnabled: false,
    unlockLevel: 3,
    sortOrder: 7,
  },
  {
    key: 'invisible_entry',
    title: 'Invisible entry',
    description: 'Enter any voice room quietly without triggering entrance banners.',
    icon: 'footsteps',
    previewUrl: '',
    animationUrl: '',
    powerDescription: 'Silent room entry allowing unannounced room visits.',
    value: 'Silent Arrival',
    isEnabled: false,
    unlockLevel: 3,
    sortOrder: 8,
  },
  {
    key: 'exclusive_customer_service',
    title: 'Exclusive customer service',
    description: '24/7 dedicated 1-on-1 VIP relationship manager line.',
    icon: 'headset',
    previewUrl: '',
    animationUrl: '',
    powerDescription: 'Dedicated relationship manager for instant dispute resolution.',
    value: '24/7 Priority',
    isEnabled: false,
    unlockLevel: 4,
    sortOrder: 9,
  },
  {
    key: 'post_avatar',
    title: 'Post avatar',
    description: 'Upload dynamic moving GIF profile photos.',
    icon: 'film',
    previewUrl: '',
    animationUrl: '',
    powerDescription: 'Animated GIF profile photo support displayed across the app.',
    value: 'GIF Avatar',
    isEnabled: false,
    unlockLevel: 4,
    sortOrder: 10,
  },
  {
    key: 'anti_mute',
    title: 'Anti-mute',
    description: 'Complete immunity against microphone muting and chat gagging.',
    icon: 'volume-high',
    previewUrl: '',
    animationUrl: '',
    powerDescription: 'Protection against admin or room host text & voice muting.',
    value: 'Mute Immunity',
    isEnabled: false,
    unlockLevel: 5,
    sortOrder: 11,
  },
  {
    key: 'anti_kick',
    title: 'Anti-kick',
    description: 'Absolute immunity against room kicks and microphone evictions.',
    icon: 'shield-checkmark',
    previewUrl: '',
    animationUrl: '',
    powerDescription: 'Room hosts cannot kick, banish, or evict you from rooms.',
    value: 'Kick Immunity',
    isEnabled: false,
    unlockLevel: 5,
    sortOrder: 12,
  },
  {
    key: 'stay_tuned',
    title: 'Stay tuned',
    description: 'Upcoming exclusive high-tier privileges coming soon to your tier.',
    icon: 'hourglass',
    previewUrl: '',
    animationUrl: '',
    powerDescription: 'Exclusive upcoming supreme tier powers reserved for nobility.',
    value: 'Mystery Power',
    isEnabled: false,
    unlockLevel: 5,
    sortOrder: 13,
  },
];

// Helper to assemble rewards & privileges per level
function createKingTierData(
  name: string,
  slug: string,
  level: number,
  priceCoins: number,
  originalPrice: number,
  discount: number,
  dailyCoins: number,
  totalReturn: number,
  rewardsUnlockedCount: number,
  privilegesUnlockedCount: number
) {
  const rewards = STANDARD_KING_REWARDS.map((r, idx) => ({
    ...r,
    value: r.key === 'activation_bonus' ? `+${totalReturn.toLocaleString()} once` : r.value,
    isEnabled: idx < rewardsUnlockedCount,
  }));

  const privileges = STANDARD_KING_PRIVILEGES.map((p, idx) => ({
    ...p,
    isEnabled: idx < privilegesUnlockedCount,
  }));

  return {
    name,
    slug,
    tierLevel: level,
    title: `👑 ${name} Nobility`,
    description: `Prestigious ${name} tier granting a one-time activation bonus, exclusive assets, and immunity perks.`,
    badge: `👑 ${name.toUpperCase()}`,
    heroBadgeUrl: slug === 'viscount' || slug === 'count' ? '/king/viscount_badge.png' : 'https://cdn.yaroapp.in/king/badges/stag_crest.png',
    heroAnimationUrl: '',
    heroBadgePreviewUrl: slug === 'viscount' || slug === 'count' ? '/king/viscount_badge.png' : '',
    priceCoins,
    originalPriceCoins: originalPrice,
    discountPercent: discount,
    totalReturnCoins: totalReturn,
    dailyCoins,
    durationDays: 30,
    currency: 'COINS' as const,
    rewards,
    privileges,
    status: 'active' as const,
    isActive: true,
    sortOrder: level,
  };
}

// 5 Standard King of Kings Tiers (matching screenshot)
export const DEFAULT_KING_TIERS = [
  createKingTierData('Viscount', 'viscount', 1, 99000, 150000, 30, 3600, 108000, 7, 4),
  createKingTierData('Count', 'count', 2, 199000, 300000, 33, 7500, 225000, 8, 6),
  createKingTierData('Marquis', 'marquis', 3, 399000, 600000, 33, 15000, 450000, 9, 8),
  createKingTierData('Duke', 'duke', 4, 799000, 1200000, 33, 30000, 900000, 10, 10),
  createKingTierData('King', 'king', 5, 1599000, 2500000, 36, 60000, 1800000, 11, 13),
];

/* =========================================================================
   PUBLIC / MOBILE CLIENT APIS
========================================================================= */

export const getPublishedKingPlans = async (_req: Request, res: Response) => {
  try {
    const count = await KingTier.countDocuments();
    if (count === 0) {
      await KingTier.insertMany(DEFAULT_KING_TIERS);
    }

    const plans = await KingTier.find({ status: 'active', isActive: true })
      .sort({ sortOrder: 1, tierLevel: 1 })
      .lean();

    return sendResponse(res, 200, true, 'King of Kings tiers fetched successfully', {
      total: plans.length,
      plans: plans.map(plan => ({...plan, name: ['Viscount', 'Count', 'Marquis', 'Duke', 'King'][plan.tierLevel - 1] || plan.name, title: (['Viscount', 'Count', 'Marquis', 'Duke', 'King'][plan.tierLevel - 1] || plan.name) + ' Nobility'})),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch King of Kings plans');
  }
};

export const purchaseKingPlan = async (req: AuthRequest, res: Response) => {
  try {
    const planIdOrSlug = req.body.planIdOrSlug || req.body.tierKey;
    const userId = req.user?.id || (req.user as any)?._id;

    if (!planIdOrSlug) {
      return sendResponse(res, 400, false, 'planIdOrSlug is required');
    }

    const plan = await KingTier.findOne({
      $or: [
        ...(isValidObjectId(planIdOrSlug) ? [{ _id: planIdOrSlug }] : []),
        { slug: planIdOrSlug },
        { name: planIdOrSlug },
      ],
      status: 'active',
      isActive: true,
    });

    if (!plan) {
      return sendResponse(res, 404, false, 'King of Kings plan not found or inactive');
    }

    const currentUser = await User.findById(userId);
    if (!currentUser) {
      return sendResponse(res, 404, false, 'User not found');
    }

    const cost = plan.priceCoins;
    const userCoins = currentUser.coins || 0;

    if (userCoins < cost) {
      return sendResponse(
        res,
        400,
        false,
        `Insufficient Coins. You need ${cost.toLocaleString()} coins, but currently have ${userCoins.toLocaleString()}.`
      );
    }

    // Credit the configured membership bonus once in the same atomic paid activation.
    const bonusCoins = Math.max(0, plan.totalReturnCoins || 0);
    // Deduct coins and equip King of Kings tier
    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, coins: { $gte: cost } },
      {
        $inc: { coins: bonusCoins - cost },
        $set: {
          equippedKingTierId: plan.slug,
          equippedKingTierName: plan.name,
          kingExpiresAt: new Date(Date.now() + (plan.durationDays || 30) * 86400000),
        },
      },
      { new: true }
    );

    if (!updatedUser) {
      return sendResponse(res, 409, false, 'Coin balance changed concurrently. Please retry.');
    }

    const permanentNumericId = Number(updatedUser.userId);
    const startsAt = new Date();
    const expiresAt = new Date(startsAt.getTime() + (plan.durationDays || 30) * 86400000);

    // Expire previous active King entitlements
    await IdentityEntitlement.updateMany(
      { userId: permanentNumericId, type: 'king_tier', status: 'active' },
      { $set: { status: 'expired' } }
    );

    const entitlement = await IdentityEntitlement.create({
      userId: permanentNumericId,
      userObjectId: updatedUser._id,
      type: 'king_tier',
      config: {
        slug: plan.slug,
        tierLevel: plan.tierLevel,
        tierName: plan.name,
        badge: plan.badge,
        heroBadgeUrl: plan.heroBadgeUrl,
        rewards: plan.rewards,
        privileges: plan.privileges,
      },
      status: 'active',
      startsAt,
      expiresAt,
      grantedBy: { adminName: 'Self-Purchase', role: 'user' },
      grantSource: 'purchase',
      grantReason: `Purchased ${plan.name} for ${cost} Coins`,
    });

    await IdentityAuditLog.create({
      action: 'grant_entitlement',
      targetUserId: permanentNumericId,
      targetUserObjectId: updatedUser._id,
      targetUserName: updatedUser.name || updatedUser.userName,
      entitlementType: 'king_tier',
      details: {
        planSlug: plan.slug,
        tierLevel: plan.tierLevel,
        priceCoins: cost,
        bonusCoins,
        durationDays: plan.durationDays,
        expiresAt,
      },
      performedBy: {
        adminId: updatedUser._id,
        adminName: updatedUser.name || 'User',
        role: 'user',
      },
    });

    const effectiveIdentity = await IdentityResolverService.resolveEffectiveIdentity(permanentNumericId);

    return sendResponse(res, 200, true, `Congratulations! You have activated ${plan.name}! 👑`, {
      plan,
      entitlement,
      effectiveIdentity,
      remainingCoins: updatedUser.coins,
      bonusCoins,
    });
  } catch (error: any) {
    await Logger('purchaseKingPlan', error);
    return sendResponse(res, 500, false, error.message || 'Failed to complete King of Kings purchase');
  }
};

// Compatibility response for older clients: repeat daily payouts are no longer supported.
export const claimDailyKingReward = async (_req: AuthRequest, res: Response) => {
  return sendResponse(res, 410, false, 'Daily rewards are no longer available. Bonus coins are credited once on paid activation.');
};

/* =========================================================================
   ADMIN CRUD & PLAN MANAGEMENT
========================================================================= */

export const adminListKingPlans = async (req: Request, res: Response) => {
  try {
    const { status, search } = req.query as any;
    const count = await KingTier.countDocuments();
    if (count === 0) {
      await KingTier.insertMany(DEFAULT_KING_TIERS);
    }

    const query: any = {};
    if (status && status !== 'all') {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
      ];
    }

    const plans = await KingTier.find(query).sort({ sortOrder: 1, tierLevel: 1 }).lean();
    return sendResponse(res, 200, true, 'Admin King of Kings plans fetched', {
      total: plans.length,
      plans,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to list King of Kings plans');
  }
};

export const adminCreateKingPlan = async (req: AuthRequest, res: Response) => {
  try {
    const data = req.body;
    if (!data.name || data.tierLevel === undefined || data.priceCoins === undefined) {
      return sendResponse(res, 400, false, 'Tier name, level, and price in coins are required');
    }

    const slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = await KingTier.findOne({ $or: [{ slug }, { tierLevel: data.tierLevel }] });
    if (existing) {
      return sendResponse(res, 409, false, `King tier with level ${data.tierLevel} or slug "${slug}" already exists`);
    }

    const newTier = await KingTier.create({
      ...data,
      slug,
      status: data.status || 'active',
      isActive: data.status !== 'inactive',
    });

    return sendResponse(res, 201, true, `King of Kings Tier "${newTier.name}" created successfully!`, newTier);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to create King tier');
  }
};

export const adminUpdateKingPlan = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

    if (data.status) {
      data.isActive = data.status === 'active';
    }

    const updated = await KingTier.findByIdAndUpdate(id, data, { new: true });
    if (!updated) {
      return sendResponse(res, 404, false, 'King tier not found');
    }

    return sendResponse(res, 200, true, `King tier "${updated.name}" updated successfully!`, updated);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to update King tier');
  }
};

export const adminToggleKingPlan = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tier = await KingTier.findById(id);
    if (!tier) return sendResponse(res, 404, false, 'King tier not found');

    tier.isActive = !tier.isActive;
    tier.status = tier.isActive ? 'active' : 'inactive';
    await tier.save();

    return sendResponse(res, 200, true, `King tier "${tier.name}" ${tier.isActive ? 'activated' : 'deactivated'}`, tier);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to toggle King tier');
  }
};

export const adminDeleteKingPlan = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await KingTier.findByIdAndDelete(id);
    if (!deleted) return sendResponse(res, 404, false, 'King tier not found');

    return sendResponse(res, 200, true, `King tier "${deleted.name}" removed successfully`);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to delete King tier');
  }
};

export const adminReseedKingPlans = async (req: AuthRequest, res: Response) => {
  try {
    const { confirm = false } = req.body || {};
    const existingCount = await KingTier.countDocuments();

    if (existingCount > 0 && !confirm) {
      return sendResponse(
        res,
        400,
        false,
        'Explicit confirmation required: Reseeding will overwrite all custom King of Kings tiers. Pass { confirm: true } to proceed.'
      );
    }

    await KingTier.deleteMany({});
    const inserted = await KingTier.insertMany(DEFAULT_KING_TIERS);
    return sendResponse(res, 200, true, `Successfully reseeded all ${inserted.length} King of Kings tiers & privileges!`, {
      total: inserted.length,
      plans: inserted,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to reseed King of Kings plans');
  }
};
