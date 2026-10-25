import mongoose from 'mongoose';
import { User } from '../models/user.model';
import { IdentityEntitlement, IIdentityEntitlement } from '../models/identityEntitlement.model';
import { SvipTier } from '../models/svipTier.model';
import { VipId } from '../models/vipId.model';
import { VipService } from './vip.service';

export interface EffectiveUserIdentity {
  userId: number; // Permanent numeric ID (e.g. 1000000002) - NEVER OVERWRITTEN!
  userObjectId: string;
  name: string;
  username: string;
  avatar: string;

  // Resolved Display ID & Official Badge
  displayId: string; // The effective display ID: e.g. "Official" when active, or permanent "1000000002" when expired
  isOfficial: boolean; // True ONLY while official_id entitlement is active
  officialBadge: {
    badgeUrl?: string;
    badgeText?: string;
    animationType?: string;
    badgeColors?: string[];
  } | null;

  // Custom Vanity ID & Unique Badges
  customDisplayId: string | null;
  uniqueIdBadge: {
    badgeName?: string;
    badgeIconUrl?: string;
    glowColor?: string;
    borderGradient?: string[];
    animationType?: string;
    vipLevel?: number;
  } | null;

  // VIP / SVIP Identity
  isVip: boolean;
  isSvip: boolean;
  vipLevel: number;
  svipLevel: number;
  vipBadge: string;
  vipBadgeUrl: string;
  vipBadgeAnimationUrl: string;
  vipCrown: string;
  avatarFrame: string;
  entryTag: string;
  entryAnimationUrl: string;

  // Animated Name & Colors
  nameEffect: {
    enabled: boolean;
    colors: string[];
    gradientDirection: string;
    animationType: string;
    glowColor?: string;
    shadowColor?: string;
    speed: number;
    prefixBadge?: string;
  };

  // Dynamic Privileges List
  privileges: string[];

  // Chat Bubble & Room Overrides
  chatBubble: {
    enabled: boolean;
    bubbleName: string;
    bgGradient: string[];
    textColor: string;
    borderColor: string;
  };

  micWave: {
    enabled: boolean;
    waveColors: string[];
    intensity: number;
  };

  roomTheme: {
    enabled: boolean;
    themeName: string;
    bgUrl: string;
    overlayGradient: string[];
  };

  // Expiration & Metadata
  activeEntitlementsCount: number;
  entitlementsSummary: {
    officialIdExpiresAt?: Date | null;
    vipExpiresAt?: Date | null;
    customIdExpiresAt?: Date | null;
    nameEffectExpiresAt?: Date | null;
  };
}

export class IdentityResolverService {
  /**
   * Resolve complete effective identity for any user
   * Server-authoritative: checks UTC timestamps on the fly so expired entitlements
   * seamlessly vanish without needing manual admin intervention.
   */
  static async resolveEffectiveIdentity(
    userOrId: any
  ): Promise<EffectiveUserIdentity | null> {
    let userDoc: any = null;

    if (userOrId && typeof userOrId === 'object' && userOrId.userId !== undefined) {
      userDoc = userOrId;
    } else if (typeof userOrId === 'number' || (!isNaN(Number(userOrId)) && String(userOrId).length < 15)) {
      userDoc = await User.findOne({ userId: Number(userOrId), isDeleted: false }).lean();
    } else if (mongoose.Types.ObjectId.isValid(String(userOrId))) {
      userDoc = await User.findOne({
        $or: [{ _id: userOrId }, { userId: Number(userOrId) || -1 }],
        isDeleted: false,
      }).lean();
    } else if (typeof userOrId === 'string') {
      userDoc = await User.findOne({
        $or: [{ userName: userOrId }, { name: userOrId }],
        isDeleted: false,
      }).lean();
    }

    if (!userDoc) return null;

    const permanentNumericId = Number(userDoc.userId);
    const now = new Date();

    // Query active non-expired entitlements in real-time
    const activeEntitlements: IIdentityEntitlement[] = await IdentityEntitlement.find({
      userId: permanentNumericId,
      status: 'active',
      startsAt: { $lte: now },
      expiresAt: { $gt: now },
    }).lean();

    // 1. Official ID Resolution (Priority over custom vanity ID)
    const officialEntitlement = activeEntitlements.find(e => e.type === 'official_id');
    const isOfficial = Boolean(officialEntitlement);
    let effectiveDisplayId = String(permanentNumericId);
    let officialBadge: any = null;

    if (isOfficial && officialEntitlement) {
      effectiveDisplayId = officialEntitlement.config?.displayId || 'Official';
      officialBadge = {
        badgeUrl: officialEntitlement.config?.badgeUrl || '',
        badgeText: officialEntitlement.config?.badgeText || 'OFFICIAL',
        animationType: officialEntitlement.config?.badgeAnimationType || 'gold_rotate',
        badgeColors: officialEntitlement.config?.badgeColors || ['#F59E0B', '#D97706'],
      };
    }

    // 2. Custom Display ID & Unique ID Badge Resolution
    const customIdEntitlement = activeEntitlements.find(e => e.type === 'custom_display_id');
    const uniqueBadgeEntitlement = activeEntitlements.find(e => e.type === 'unique_id_badge');

    let customDisplayId: string | null = null;
    if (!isOfficial) {
      if (customIdEntitlement && customIdEntitlement.config?.displayId) {
        customDisplayId = String(customIdEntitlement.config.displayId);
        effectiveDisplayId = customDisplayId;
      } else if (userDoc.equippedCustomId) {
        customDisplayId = String(userDoc.equippedCustomId);
        effectiveDisplayId = customDisplayId;
      }
    }

    let uniqueIdBadge = uniqueBadgeEntitlement
      ? {
          badgeName: uniqueBadgeEntitlement.config?.badgeName || 'VIP ID',
          badgeIconUrl: uniqueBadgeEntitlement.config?.badgeIconUrl || '',
          glowColor: uniqueBadgeEntitlement.config?.glowColor || '#F59E0B',
          borderGradient: uniqueBadgeEntitlement.config?.borderGradient || ['#F59E0B', '#D97706'],
          animationType: uniqueBadgeEntitlement.config?.animationType || 'pulse',
          vipLevel: Number(uniqueBadgeEntitlement.config?.vipLevel || 0),
        }
      : null;

    if (!uniqueIdBadge && (customDisplayId || userDoc.equippedCustomId)) {
      const inventoryList = Array.isArray(userDoc.storeInventory) ? userDoc.storeInventory : [];
      const targetId = String(customDisplayId || userDoc.equippedCustomId || '').trim();
      const uniqueInv = inventoryList.find((it: any) => {
        const cat = String(it.category || it.type || '').toLowerCase().trim();
        if (/frame|theme|bubble|tassel|wave|skin|entry|vehicle/i.test(cat)) return false;
        const isBadgeCategory = ['unique id', 'unique_id', 'custom id', 'custom_id', 'badge', 'id'].includes(cat);
        const itemDisplayId = String(it.metadata?.uniqueDisplayId || it.metadata?.displayId || it.uniqueId || '').trim();
        const matchesId = Boolean(targetId && itemDisplayId && targetId === itemDisplayId);
        return isBadgeCategory || matchesId;
      });
      const badgeIconUrl = String(uniqueInv?.metadata?.badgeIconUrl || uniqueInv?.metadata?.badgeUrl || (['unique id', 'unique_id', 'badge', 'custom id'].includes(String(uniqueInv?.category || '').toLowerCase()) ? (uniqueInv?.animationUrl || uniqueInv?.imageUrl) : '') || '').trim();
      if (badgeIconUrl && !/frame/i.test(badgeIconUrl)) {
        uniqueIdBadge = {
          badgeName: uniqueInv?.metadata?.badgeName || 'VIP ID',
          badgeIconUrl: badgeIconUrl,
          glowColor: '#F59E0B',
          borderGradient: ['#F59E0B', '#D97706'],
          animationType: 'svga',
          vipLevel: 1,
        };
      }
    }

    // 3. VIP / SVIP Resolution (incorporating existing VipService)
    const vipExperience = await VipService.resolveVipExperience(userDoc);
    const svipEntitlement = activeEntitlements.find(e => e.type === 'svip_tier');
    const vipEntitlement = activeEntitlements.find(e => e.type === 'vip_tier');

    let isSvip = Boolean(vipExperience.isSvip || svipEntitlement);
    let isVip = Boolean(vipExperience.isVip || vipEntitlement || isSvip);

    let avatarFrame = userDoc.equippedFrame || userDoc.frameId || vipExperience.avatarFrame || '';
    const frameEntitlement = activeEntitlements.find(e => e.type === 'profile_frame');
    if (frameEntitlement?.config?.frameUrl) {
      avatarFrame = frameEntitlement.config.frameUrl;
    }

    // Dynamic privileges aggregation
    const privilegesSet = new Set<string>();
    if (isVip) {
      privilegesSet.add('vip_badge');
      privilegesSet.add('room_entry_sound');
      privilegesSet.add('custom_chat_bubble');
    }
    if (isSvip) {
      privilegesSet.add('svip_badge');
      privilegesSet.add('animated_mic_wave');
      privilegesSet.add('velvet_room_theme');
      privilegesSet.add('anti_kick_protection');
      privilegesSet.add('invisible_room_visit');
      privilegesSet.add('fullscreen_entry_fx');
    }
    if (isOfficial) {
      privilegesSet.add('official_verified_badge');
      privilegesSet.add('priority_moderation_tag');
    }
    activeEntitlements.forEach(e => {
      if (Array.isArray(e.config?.privileges)) {
        e.config.privileges.forEach((p: string) => privilegesSet.add(p));
      }
    });

    // 4. Animated Name & Name Colors Resolution
    const animatedNameEntitlement = activeEntitlements.find(
      e => e.type === 'animated_name' || e.type === 'name_color'
    );

    let nameEffect = {
      enabled: false,
      colors: ['#FFFFFF'],
      gradientDirection: 'horizontal',
      animationType: 'none',
      glowColor: undefined as string | undefined,
      shadowColor: undefined as string | undefined,
      speed: 1.0,
      prefixBadge: isSvip ? (vipExperience.crown || '👑') : isVip ? '👑' : undefined,
    };

    if (animatedNameEntitlement && animatedNameEntitlement.config) {
      const cfg = animatedNameEntitlement.config;
      nameEffect = {
        enabled: true,
        colors: cfg.colors?.length ? cfg.colors : ['#FDE047', '#EAB308'],
        gradientDirection: cfg.gradientDirection || 'horizontal',
        animationType: cfg.animationType || 'gradient_scroll',
        glowColor: cfg.glowColor || '#F59E0B',
        shadowColor: cfg.shadowColor || 'rgba(245, 158, 11, 0.4)',
        speed: cfg.animationSpeed || 1.0,
        prefixBadge: cfg.prefixBadge || (isSvip ? '👑' : undefined),
      };
    } else if (vipExperience.nameEffect?.enabled) {
      nameEffect = {
        enabled: true,
        colors: vipExperience.nameEffect.gradient || ['#FDE047', '#EAB308'],
        gradientDirection: 'horizontal',
        animationType: 'gradient_scroll',
        glowColor: vipExperience.nameEffect.glowColor || '#F59E0B',
        shadowColor: 'rgba(245, 158, 11, 0.35)',
        speed: 1.0,
        prefixBadge: vipExperience.nameEffect.prefixBadge || '👑',
      };
    }

    // 5. Expiration metadata
    const entitlementsSummary = {
      officialIdExpiresAt: officialEntitlement?.expiresAt || null,
      vipExpiresAt: userDoc.equippedVipExpiresAt || vipEntitlement?.expiresAt || null,
      customIdExpiresAt: customIdEntitlement?.expiresAt || null,
      nameEffectExpiresAt: animatedNameEntitlement?.expiresAt || null,
    };

    return {
      userId: permanentNumericId,
      userObjectId: String(userDoc._id),
      name: userDoc.name || `User ${permanentNumericId}`,
      username: userDoc.userName || String(permanentNumericId),
      avatar: userDoc.image || '',

      displayId: effectiveDisplayId,
      isOfficial,
      officialBadge,

      customDisplayId,
      uniqueIdBadge,

      isVip,
      isSvip,
      vipLevel: vipExperience.vipLevel,
      svipLevel: vipExperience.svipLevel,
      vipBadge: vipExperience.badge,
      vipBadgeUrl: vipExperience.badgeUrl,
      vipBadgeAnimationUrl: vipExperience.badgeAnimationUrl,
      vipCrown: vipExperience.crown,
      avatarFrame,
      entryTag: vipExperience.entryTag || (isOfficial ? '👑 OFFICIAL YARO TEAM MEMBER' : ''),
      entryAnimationUrl: userDoc.equippedEntrance || '',

      nameEffect,
      privileges: Array.from(privilegesSet),

      chatBubble: vipExperience.chatBubble,
      micWave: vipExperience.micWave,
      roomTheme: vipExperience.roomTheme,

      activeEntitlementsCount: activeEntitlements.length,
      entitlementsSummary,
    };
  }

  /**
   * Search users by permanent numeric ID, username, or active vanity/official ID
   * Strict Rule: Expired custom display IDs or expired official IDs MUST NOT match!
   */
  static async searchUsers(
    queryStr: string,
    options: { limit?: number; isAdmin?: boolean } = {}
  ): Promise<EffectiveUserIdentity[]> {
    if (!queryStr || !queryStr.trim()) return [];

    const query = queryStr.trim();
    const limit = Math.min(50, Math.max(1, options.limit || 15));
    const now = new Date();

    const matchedUserIds = new Set<number>();

    // 1. If query is numeric, check permanent numeric userId
    if (!isNaN(Number(query))) {
      const num = Number(query);
      const user = await User.findOne({ userId: num, isDeleted: false }).lean();
      if (user) matchedUserIds.add(user.userId);
    }

    // 2. Check active non-expired custom_display_id or official_id entitlements
    const activeCustomIdEntitlements = await IdentityEntitlement.find({
      'config.displayId': new RegExp(`^${query}$`, 'i'),
      status: 'active',
      startsAt: { $lte: now },
      expiresAt: { $gt: now },
    })
      .select('userId')
      .lean();

    activeCustomIdEntitlements.forEach(e => matchedUserIds.add(e.userId));

    // 3. Check username or name regex
    const nameMatches = await User.find({
      $or: [
        { userName: { $regex: query, $options: 'i' } },
        { name: { $regex: query, $options: 'i' } },
        ...(options.isAdmin && mongoose.Types.ObjectId.isValid(query) ? [{ _id: query }] : []),
      ],
      isDeleted: false,
    })
      .select('userId')
      .limit(limit)
      .lean();

    nameMatches.forEach(u => matchedUserIds.add(u.userId));

    // Resolve effective identity for all matched IDs
    const results: EffectiveUserIdentity[] = [];
    for (const uid of Array.from(matchedUserIds).slice(0, limit)) {
      const resolved = await this.resolveEffectiveIdentity(uid);
      if (resolved) results.push(resolved);
    }

    return results;
  }

  /**
   * Background routine to mark expired entitlements in DB
   */
  static async cleanupExpiredEntitlements(): Promise<{ expiredCount: number }> {
    const now = new Date();
    const result = await IdentityEntitlement.updateMany(
      {
        status: 'active',
        expiresAt: { $lte: now },
      },
      {
        $set: { status: 'expired' },
      }
    );

    return { expiredCount: result.modifiedCount || 0 };
  }
}
