import mongoose from 'mongoose';
import { VipId, IVipId } from '../models/vipId.model';
import { SvipTier, ISvipTier } from '../models/svipTier.model';
import { User } from '../models/user.model';
import { EntryEffect } from '../models/entryEffect.model';
import { LevelService } from './level.service';

export interface EffectiveVipExperience {
  isVip: boolean;
  isSvip: boolean;
  isKing: boolean;
  isKingOfKings: boolean;
  vipLevel: number;
  svipLevel: number;
  badge: string;
  crown: string;
  icon: string;
  
  entryTag: string;
  entryFrame: string;
  avatarFrame: string;
  floatingAnimation: string;
  
  micWave: {
    enabled: boolean;
    waveColors: string[];
    intensity: number;
    speed: number;
    style: string;
  };
  
  chatBubble: {
    enabled: boolean;
    bubbleName: string;
    bgGradient: string[];
    bgColor?: string;
    textColor: string;
    borderColor: string;
    borderRadius: number;
    shadowColor: string;
  };
  
  roomTheme: {
    enabled: boolean;
    themeName: string;
    bgUrl: string;
    overlayGradient: string[];
    overlayOpacity: number;
    particleType: string;
  };
  
  nameEffect: {
    enabled: boolean;
    gradient: string[];
    glowColor: string;
    isAnimated: boolean;
    prefixBadge?: string;
  };
  
  sound: string;
  particles: string;
}

export class VipService {
  /**
   * Resolves effective VIP/SVIP experience for a user.
   * Priority Rule: SVIP overrides VIP only for overlapping enabled feature slots.
   * If SVIP feature is disabled, fallback to VIP feature or system default.
   */
  static async resolveVipExperience(user: any): Promise<EffectiveVipExperience> {
    if (!user) {
      return this.getDefaultExperience();
    }

    // Load equipped VIP package if exists
    let vip: IVipId | null = null;
    const vipExpired = Boolean(
      user.equippedVipExpiresAt &&
      new Date(user.equippedVipExpiresAt).getTime() <= Date.now(),
    );
    if (user.equippedVipId && !vipExpired) {
      if (mongoose.connection.readyState === 1) {
        if (mongoose.Types.ObjectId.isValid(String(user.equippedVipId))) {
          vip = await VipId.findById(user.equippedVipId).lean();
        }
        if (!vip) {
          vip = await VipId.findOne({ slug: String(user.equippedVipId) }).lean();
        }
      }
      if (!vip) {
        vip = (INITIAL_VIP_PACKAGES.find((p) => p.slug === String(user.equippedVipId) || p.name === String(user.equippedVipId)) as any) || null;
      }
    }

    // Load equipped SVIP tier if exists
    let svip: ISvipTier | null = null;
    if (user.equippedSvipId) {
      if (mongoose.connection.readyState === 1) {
        if (mongoose.Types.ObjectId.isValid(String(user.equippedSvipId))) {
          svip = await SvipTier.findById(user.equippedSvipId).lean();
        }
        if (!svip) {
          svip = await SvipTier.findOne({ slug: String(user.equippedSvipId) }).lean();
        }
      }
      if (!svip) {
        svip = (INITIAL_SVIP_TIERS.find((t) => t.slug === String(user.equippedSvipId) || t.name === String(user.equippedSvipId)) as any) || null;
      }
    }

    // Load custom equipped entry tag or entry effect if present
    const equippedTag = user.equippedEntryTag || '';
    const equippedFrame = user.frameId || user.equippedAvatarFrame || '';

    const isSvip = Boolean(svip && svip.isActive);
    const isVip = Boolean(vip && vip.isActive) || isSvip;
    const isKing = Boolean(vip?.isKing || svip?.name?.toLowerCase().includes('king'));
    const isKingOfKings = Boolean(vip?.isKingOfKings || svip?.slug === 'king-of-kings');

    // 1. Mic Wave resolution
    const micWaveEnabled = isSvip ? (svip?.features?.enableMicWave ?? true) : Boolean(vip);
    const micColors = (isSvip && svip?.features?.enableMicWave && svip?.micWaveConfig?.waveColors?.length)
      ? svip.micWaveConfig.waveColors
      : (vip?.micWave?.waveColors?.length ? vip.micWave.waveColors : ['#F59E0B', '#FBBF24']);

    // 2. Chat Bubble resolution
    const chatBubbleEnabled = isSvip ? (svip?.features?.enableChatBubble ?? true) : Boolean(vip);
    const chatBubbleGradient = (isSvip && svip?.features?.enableChatBubble && svip?.chatBubbleConfig?.bgGradient?.length)
      ? svip.chatBubbleConfig.bgGradient
      : (vip?.chatBubble?.bgGradient?.length ? vip.chatBubble.bgGradient : ['#1E1B4B', '#312E81']);
    const chatTextColor = (isSvip && svip?.chatBubbleConfig?.textColor)
      ? svip.chatBubbleConfig.textColor
      : (vip?.chatBubble?.textColor || '#FFFFFF');
    const chatBorderColor = (isSvip && svip?.chatBubbleConfig?.borderColor)
      ? svip.chatBubbleConfig.borderColor
      : (vip?.chatBubble?.borderColor || '#F59E0B');

    // 3. Room Theme resolution
    const roomThemeEnabled = isSvip ? (svip?.features?.enableRoomTheme ?? true) : Boolean(vip);
    const themeName = (isSvip && svip?.roomThemeConfig?.themeName)
      ? svip.roomThemeConfig.themeName
      : (vip?.roomTheme?.themeName || 'Default Theme');
    const themeBg = (isSvip && svip?.roomThemeConfig?.bgUrl)
      ? svip.roomThemeConfig.bgUrl
      : (vip?.roomTheme?.bgUrl || '');
    const overlayGrad = (isSvip && svip?.roomThemeConfig?.overlayGradient?.length)
      ? svip.roomThemeConfig.overlayGradient
      : (vip?.roomTheme?.overlayGradient?.length ? vip.roomTheme.overlayGradient : ['rgba(15, 23, 42, 0.85)', 'rgba(30, 27, 75, 0.9)']);

    // 4. Entry Tag resolution
    const entryTag = (isSvip && svip?.features?.enableEntryTag && svip?.entryTagText)
      ? svip.entryTagText
      : (equippedTag || vip?.entryTag || (isSvip ? '👑 SVIP HAS ENTERED' : isVip ? '👑 VIP HAS ENTERED' : ''));

    // 5. Entry Frame resolution
    const entryFrame = (isSvip && svip?.features?.enableEntryFrame && svip?.entryFrameUrl)
      ? svip.entryFrameUrl
      : (vip?.entryFrame || '');

    // 6. Avatar Frame resolution
    const avatarFrame = (isSvip && svip?.features?.enableAvatarFrame && svip?.avatarFrameUrl)
      ? svip.avatarFrameUrl
      : (equippedFrame || vip?.avatarFrame || '');

    // 7. Name Effect resolution
    const nameEffectEnabled = isSvip ? (svip?.features?.enableNameEffect ?? true) : Boolean(vip);
    const nameGradient = (isSvip && svip?.nameEffectConfig?.gradient?.length)
      ? svip.nameEffectConfig.gradient
      : (vip?.nameEffect?.gradient?.length ? vip.nameEffect.gradient : ['#FDE047', '#EAB308']);
    const nameGlow = (isSvip && svip?.nameEffectConfig?.glowColor)
      ? svip.nameEffectConfig.glowColor
      : (vip?.nameEffect?.glowColor || '#F59E0B');

    return {
      isVip,
      isSvip,
      isKing,
      isKingOfKings,
      vipLevel: vip?.vipLevel || (isSvip ? 5 : 0),
      svipLevel: svip?.level || 0,
      badge: svip?.badge || vip?.badge || (isVip ? '👑 VIP' : ''),
      crown: svip?.crown || vip?.crown || (isVip ? '👑' : ''),
      icon: svip?.icon || vip?.icon || 'sparkles',
      entryTag,
      entryFrame,
      avatarFrame,
      floatingAnimation: vip?.floatingEntryAnimation || 'CENTER_AVATAR',
      micWave: {
        enabled: micWaveEnabled,
        waveColors: micColors,
        intensity: isSvip ? 1.4 : (vip?.micWave?.waveIntensity || 1.0),
        speed: vip?.micWave?.waveSpeed || 1.0,
        style: vip?.micWave?.waveStyle || 'rings',
      },
      chatBubble: {
        enabled: chatBubbleEnabled,
        bubbleName: svip?.chatBubbleConfig?.bubbleName || vip?.chatBubble?.bubbleName || 'Standard',
        bgGradient: chatBubbleGradient,
        textColor: chatTextColor,
        borderColor: chatBorderColor,
        borderRadius: vip?.chatBubble?.borderRadius || 16,
        shadowColor: isSvip ? '#C084FC' : (vip?.chatBubble?.shadowColor || '#F59E0B'),
      },
      roomTheme: {
        enabled: roomThemeEnabled,
        themeName,
        bgUrl: themeBg,
        overlayGradient: overlayGrad,
        overlayOpacity: vip?.roomTheme?.overlayOpacity || 0.85,
        particleType: isSvip ? (svip?.particles || 'purple_sparkles') : (vip?.roomTheme?.particleType || 'gold_sparkles'),
      },
      nameEffect: {
        enabled: nameEffectEnabled,
        gradient: nameGradient,
        glowColor: nameGlow,
        isAnimated: true,
        prefixBadge: svip?.crown || vip?.crown || '👑',
      },
      sound: (isSvip && svip?.features?.enableSpecialSound ? svip?.entrySound : vip?.entrySound) || '',
      particles: (isSvip && svip?.features?.enableParticles ? svip?.particles : vip?.particleEffect) || 'gold_particles',
    };
  }

  static getDefaultExperience(): EffectiveVipExperience {
    return {
      isVip: false,
      isSvip: false,
      isKing: false,
      isKingOfKings: false,
      vipLevel: 0,
      svipLevel: 0,
      badge: '',
      crown: '',
      icon: '',
      entryTag: '',
      entryFrame: '',
      avatarFrame: '',
      floatingAnimation: 'BANNER',
      micWave: {
        enabled: false,
        waveColors: ['#94A3B8'],
        intensity: 0.5,
        speed: 1.0,
        style: 'rings',
      },
      chatBubble: {
        enabled: false,
        bubbleName: 'Default',
        bgGradient: ['#1E293B', '#0F172A'],
        textColor: '#FFFFFF',
        borderColor: 'rgba(255,255,255,0.1)',
        borderRadius: 14,
        shadowColor: 'transparent',
      },
      roomTheme: {
        enabled: false,
        themeName: 'Standard Room',
        bgUrl: '',
        overlayGradient: ['rgba(15, 23, 42, 0.95)', 'rgba(15, 23, 42, 0.95)'],
        overlayOpacity: 0.95,
        particleType: 'none',
      },
      nameEffect: {
        enabled: false,
        gradient: ['#FFFFFF', '#E2E8F0'],
        glowColor: 'transparent',
        isAnimated: false,
        prefixBadge: '',
      },
      sound: '',
      particles: '',
    };
  }

  /**
   * Seed default VIP and SVIP catalog if database is empty
   */
  static async seedInitialCatalog(): Promise<void> {
    const vipCount = await VipId.countDocuments();
    if (vipCount === 0) {
      await VipId.insertMany(INITIAL_VIP_PACKAGES);
      console.log(`👑 [VIP] Seeded ${INITIAL_VIP_PACKAGES.length} VIP ID packages.`);
    }

    const svipCount = await SvipTier.countDocuments();
    if (svipCount === 0) {
      await SvipTier.insertMany(INITIAL_SVIP_TIERS);
      console.log(`💎 [SVIP] Seeded ${INITIAL_SVIP_TIERS.length} SVIP tiers.`);
    }
  }

  /**
   * Atomic Diamond Purchase for VIP ID
   */
  static async buyVipId(userId: string | mongoose.Types.ObjectId, vipIdOrSlug: string, requestId?: string) {
    let vip = await VipId.findById(vipIdOrSlug);
    if (!vip) {
      vip = await VipId.findOne({ slug: vipIdOrSlug });
    }
    if (!vip || !vip.isActive) {
      throw new Error('VIP package not found or currently inactive');
    }

    const price = Math.max(0, vip.price);
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    if ((user.diamonds || 0) < price) {
      throw new Error(`Insufficient diamonds. Required: ${price.toLocaleString()} 💎, Available: ${(user.diamonds || 0).toLocaleString()} 💎`);
    }

    // Atomic deduction
    const updatedUser = await User.findOneAndUpdate(
      { _id: user._id, diamonds: { $gte: price } },
      {
        $inc: { diamonds: -price },
        $addToSet: { ownedVipIds: vip.slug },
      },
      { new: true }
    );

    if (!updatedUser) {
      throw new Error('Diamond deduction failed due to concurrent update. Please retry.');
    }

    // Award Wealth EXP
    LevelService.addWealthExp(userId, price, 'vip_purchase', vip.slug).catch(err =>
      console.warn('Failed to award wealth EXP for VIP purchase:', err?.message)
    );

    return {
      success: true,
      vip,
      remainingDiamonds: updatedUser.diamonds,
      message: `Successfully purchased ${vip.displayName}! 🎉`,
    };
  }

  /**
   * Atomic Diamond Purchase for SVIP Tier
   */
  static async buySvipTier(userId: string | mongoose.Types.ObjectId, svipIdOrSlug: string, requestId?: string) {
    let svip = await SvipTier.findById(svipIdOrSlug);
    if (!svip) {
      svip = await SvipTier.findOne({ slug: svipIdOrSlug });
    }
    if (!svip || !svip.isActive) {
      throw new Error('SVIP tier not found or currently inactive');
    }

    const price = Math.max(0, svip.price);
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    if ((user.diamonds || 0) < price) {
      throw new Error(`Insufficient diamonds. Required: ${price.toLocaleString()} 💎, Available: ${(user.diamonds || 0).toLocaleString()} 💎`);
    }

    // Atomic deduction
    const updatedUser = await User.findOneAndUpdate(
      { _id: user._id, diamonds: { $gte: price } },
      {
        $inc: { diamonds: -price },
        $addToSet: { ownedSvipIds: svip.slug },
      },
      { new: true }
    );

    if (!updatedUser) {
      throw new Error('Diamond deduction failed due to concurrent update. Please retry.');
    }

    // Award Wealth EXP
    LevelService.addWealthExp(userId, price, 'svip_purchase', svip.slug).catch(err =>
      console.warn('Failed to award wealth EXP for SVIP purchase:', err?.message)
    );

    return {
      success: true,
      svip,
      remainingDiamonds: updatedUser.diamonds,
      message: `Successfully subscribed to ${svip.name}! 👑`,
    };
  }

  /**
   * Equip VIP package
   */
  static async equipVipId(userId: string | mongoose.Types.ObjectId, vipSlug: string) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const owns = (user.ownedVipIds || []).includes(vipSlug);
    if (!owns) {
      throw new Error('You do not own this VIP package');
    }

    user.equippedVipId = vipSlug;
    await user.save();
    return { success: true, equippedVipId: vipSlug };
  }

  static async unequipVipId(userId: string | mongoose.Types.ObjectId) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    user.equippedVipId = null;
    await user.save();
    return { success: true };
  }

  /**
   * Equip SVIP tier
   */
  static async equipSvipTier(userId: string | mongoose.Types.ObjectId, svipSlug: string) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const owns = (user.ownedSvipIds || []).includes(svipSlug);
    if (!owns) {
      throw new Error('You do not own this SVIP tier');
    }

    user.equippedSvipId = svipSlug;
    await user.save();
    return { success: true, equippedSvipId: svipSlug };
  }

  static async unequipSvipTier(userId: string | mongoose.Types.ObjectId) {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');
    user.equippedSvipId = null;
    await user.save();
    return { success: true };
  }
}

export const INITIAL_VIP_PACKAGES = [
  {
    name: 'VIP Bronze',
    slug: 'vip-bronze',
    displayName: 'Bronze VIP Crown',
    vipLevel: 1,
    rarity: 'rare' as const,
    price: 5000,
    currency: 'DIAMONDS' as const,
    badge: '👑 VIP 1',
    crown: '🥉',
    icon: 'sparkles',
    entryTag: '⚡ BRONZE VIP ARRIVED',
    entryFrame: '',
    avatarFrame: 'Rose frame',
    floatingEntryAnimation: 'BANNER',
    micWave: {
      waveColor: '#CD7F32',
      waveColors: ['#CD7F32', '#B45309', '#D97706'],
      waveIntensity: 1.0,
      waveSpeed: 1.0,
      waveStyle: 'rings',
    },
    chatBubble: {
      bubbleName: 'Bronze Glass',
      bgGradient: ['#3A1F04', '#78350F'],
      textColor: '#FFFFFF',
      borderColor: '#CD7F32',
      borderRadius: 14,
      shadowColor: '#CD7F32',
    },
    roomTheme: {
      themeName: 'Warm Bronze Chamber',
      bgUrl: '',
      overlayGradient: ['rgba(58, 31, 4, 0.85)', 'rgba(15, 23, 42, 0.9)'],
      overlayOpacity: 0.85,
      particleType: 'stars',
    },
    nameEffect: {
      gradient: ['#F59E0B', '#CD7F32'],
      glowColor: '#CD7F32',
      isAnimated: true,
      prefixBadge: '🥉',
    },
    isVip: true,
    isSvip: false,
    isKing: false,
    isKingOfKings: false,
    isActive: true,
    sortOrder: 1,
  },
  {
    name: 'VIP Silver Knight',
    slug: 'vip-silver-knight',
    displayName: 'Silver Knight Package',
    vipLevel: 2,
    rarity: 'epic' as const,
    price: 15000,
    currency: 'DIAMONDS' as const,
    badge: '👑 VIP 2',
    crown: '🥈',
    icon: 'shield-checkmark',
    entryTag: '⚡ SILVER KNIGHT ARRIVED',
    entryFrame: '',
    avatarFrame: 'Silver glowing frame',
    floatingEntryAnimation: 'CENTER_AVATAR',
    micWave: {
      waveColor: '#94A3B8',
      waveColors: ['#94A3B8', '#E2E8F0', '#64748B'],
      waveIntensity: 1.1,
      waveSpeed: 1.1,
      waveStyle: 'rings',
    },
    chatBubble: {
      bubbleName: 'Silver Knight Bubble',
      bgGradient: ['#1E293B', '#334155'],
      textColor: '#FFFFFF',
      borderColor: '#94A3B8',
      borderRadius: 16,
      shadowColor: '#94A3B8',
    },
    roomTheme: {
      themeName: 'Knight Arena',
      bgUrl: '',
      overlayGradient: ['rgba(30, 41, 59, 0.85)', 'rgba(15, 23, 42, 0.9)'],
      overlayOpacity: 0.85,
      particleType: 'stars',
    },
    nameEffect: {
      gradient: ['#FFFFFF', '#CBD5E1', '#94A3B8'],
      glowColor: '#94A3B8',
      isAnimated: true,
      prefixBadge: '🥈',
    },
    isVip: true,
    isSvip: false,
    isKing: false,
    isKingOfKings: false,
    isActive: true,
    sortOrder: 2,
  },
  {
    name: 'VIP Gold Emperor',
    slug: 'vip-gold-emperor',
    displayName: 'Gold Emperor VIP',
    vipLevel: 3,
    rarity: 'legendary' as const,
    price: 50000,
    currency: 'DIAMONDS' as const,
    badge: '👑 VIP GOLD',
    crown: '👑',
    icon: 'crown',
    entryTag: '👑 GOLD EMPEROR IS HERE',
    entryFrame: '',
    avatarFrame: 'Gold Angel Wings',
    floatingEntryAnimation: 'VIP_ENTRANCE',
    micWave: {
      waveColor: '#F59E0B',
      waveColors: ['#F59E0B', '#FBBF24', '#D97706'],
      waveIntensity: 1.3,
      waveSpeed: 1.2,
      waveStyle: 'rings',
    },
    chatBubble: {
      bubbleName: 'Gold Emperor Bubble',
      bgGradient: ['#451A03', '#78350F'],
      textColor: '#FFFFFF',
      borderColor: '#F59E0B',
      borderRadius: 18,
      shadowColor: '#F59E0B',
    },
    roomTheme: {
      themeName: 'Imperial Gold Hall',
      bgUrl: '',
      overlayGradient: ['rgba(69, 26, 3, 0.85)', 'rgba(15, 23, 42, 0.9)'],
      overlayOpacity: 0.85,
      particleType: 'gold_sparkles',
    },
    nameEffect: {
      gradient: ['#FDE047', '#EAB308', '#CA8A04'],
      glowColor: '#F59E0B',
      isAnimated: true,
      prefixBadge: '👑',
    },
    isVip: true,
    isSvip: false,
    isKing: true,
    isKingOfKings: false,
    isActive: true,
    sortOrder: 3,
  },
  {
    name: 'King of Kings (88888)',
    slug: 'king-of-kings',
    displayName: '👑 KING OF KINGS SUPREME',
    vipLevel: 10,
    rarity: 'mythic' as const,
    price: 250000,
    currency: 'DIAMONDS' as const,
    badge: '👑 KING OF KINGS',
    crown: '👑👑',
    icon: 'crown-gold',
    entryTag: '👑 KING OF KINGS HAS ARRIVED',
    entryFrame: 'https://api.yaroapp.in/uploads/frames/king_frame.png',
    avatarFrame: 'Gold Angel Wings',
    floatingEntryAnimation: 'VIP_ENTRANCE',
    micWave: {
      waveColor: '#EAB308',
      waveColors: ['#FDE047', '#EAB308', '#CA8A04', '#A855F7'],
      waveIntensity: 1.6,
      waveSpeed: 1.3,
      waveStyle: 'fire',
    },
    chatBubble: {
      bubbleName: 'Supreme Luxury Gold Bubble',
      bgGradient: ['#3B0764', '#7C3AED', '#EAB308'],
      textColor: '#FFFFFF',
      borderColor: '#FDE047',
      borderRadius: 20,
      shadowColor: '#FDE047',
    },
    roomTheme: {
      themeName: "King's Golden Palace",
      bgUrl: '',
      overlayGradient: ['rgba(59, 7, 100, 0.85)', 'rgba(15, 23, 42, 0.9)'],
      overlayOpacity: 0.85,
      particleType: 'gold_sparkles',
    },
    nameEffect: {
      gradient: ['#FDE047', '#EC4899', '#A855F7'],
      glowColor: '#FDE047',
      isAnimated: true,
      prefixBadge: '👑',
    },
    entrySound: 'king_fanfare.mp3',
    particleEffect: 'gold_particles',
    isVip: true,
    isSvip: true,
    isKing: true,
    isKingOfKings: true,
    isActive: true,
    sortOrder: 4,
  },
];

export const INITIAL_SVIP_TIERS = [
  {
    name: 'Knight',
    slug: 'knight',
    level: 1,
    description: 'Knight of the Realm: Blue Aura, custom mic wave, and profile crest.',
    badge: '🛡️ KNIGHT',
    icon: 'shield',
    crown: '🛡️',
    price: 99000,
    currency: 'DIAMONDS' as const,
    durationDays: 30,
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
      enableParticles: true,
      enableAntiKick: true,
    },
    entryTagText: '🛡️ KNIGHT HAS ENTERED',
    micWaveConfig: {
      waveColors: ['#2563EB', '#3B82F6', '#60A5FA'],
      intensity: 1.2,
    },
    chatBubbleConfig: {
      bubbleName: 'Knight Sapphire Bubble',
      bgGradient: ['#1E3A8A', '#1D4ED8'],
      textColor: '#FFFFFF',
      borderColor: '#60A5FA',
    },
    roomThemeConfig: {
      themeName: 'Sapphire Court',
      bgUrl: '',
      overlayGradient: ['rgba(30, 58, 138, 0.85)', 'rgba(15, 23, 42, 0.9)'],
    },
    nameEffectConfig: {
      gradient: ['#93C5FD', '#3B82F6', '#1D4ED8'],
      glowColor: '#3B82F6',
    },
    isActive: true,
    sortOrder: 1,
  },
  {
    name: 'Count',
    slug: 'count',
    level: 2,
    description: 'Count of Velvet: Purple royal radiance, custom chat bubble, and visitor stealth.',
    badge: '👑 COUNT',
    icon: 'diamond',
    crown: '👑',
    price: 180000,
    currency: 'DIAMONDS' as const,
    durationDays: 30,
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
    },
    entryTagText: '👑 COUNT ARRIVED WITH ROYAL HONOR',
    micWaveConfig: {
      waveColors: ['#A855F7', '#7C3AED', '#C084FC'],
      intensity: 1.3,
    },
    chatBubbleConfig: {
      bubbleName: 'Count Imperial Amethyst Bubble',
      bgGradient: ['#3B0764', '#581C87'],
      textColor: '#FFFFFF',
      borderColor: '#C084FC',
    },
    roomThemeConfig: {
      themeName: 'Imperial Velvet Hall',
      bgUrl: '',
      overlayGradient: ['rgba(59, 7, 100, 0.85)', 'rgba(15, 23, 42, 0.9)'],
    },
    nameEffectConfig: {
      gradient: ['#F0ABFC', '#C084FC', '#7C3AED'],
      glowColor: '#C084FC',
    },
    isActive: true,
    sortOrder: 2,
  },
  {
    name: 'Duke',
    slug: 'duke',
    level: 3,
    description: 'Duke of Gold: Crimson gold wings, luxury particle entrance, and anti-kick immunity.',
    badge: '👑 DUKE',
    icon: 'crown-gold',
    crown: '👑👑',
    price: 360000,
    currency: 'DIAMONDS' as const,
    durationDays: 30,
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
    entryTagText: '👑 DUKE OF YARO HAS ENTERED',
    micWaveConfig: {
      waveColors: ['#EF4444', '#F59E0B', '#DC2626'],
      intensity: 1.5,
    },
    chatBubbleConfig: {
      bubbleName: 'Duke Crimson Gold Bubble',
      bgGradient: ['#7F1D1D', '#991B1B'],
      textColor: '#FFFFFF',
      borderColor: '#F59E0B',
    },
    roomThemeConfig: {
      themeName: 'Duke Royal Grand Palace',
      bgUrl: '',
      overlayGradient: ['rgba(127, 29, 29, 0.85)', 'rgba(15, 23, 42, 0.9)'],
    },
    nameEffectConfig: {
      gradient: ['#FCA5A5', '#EF4444', '#F59E0B'],
      glowColor: '#EF4444',
    },
    isActive: true,
    sortOrder: 3,
  },
  {
    name: 'SVIP King of Kings',
    slug: 'svip-king-of-kings',
    level: 5,
    description: 'Supreme King of Kings: Ultimate luxury gold-purple aura, fire mic waves, and sovereign theme.',
    badge: '👑👑 KING OF KINGS',
    icon: 'crown-gold',
    crown: '👑👑👑',
    price: 1500000,
    currency: 'DIAMONDS' as const,
    durationDays: 90,
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
    entryTagText: '👑👑 KING OF KINGS ENTERED THE ROOM',
    micWaveConfig: {
      waveColors: ['#FDE047', '#EAB308', '#CA8A04', '#A855F7'],
      intensity: 1.8,
    },
    chatBubbleConfig: {
      bubbleName: 'Sovereign Celestial Gold Bubble',
      bgGradient: ['#4C1D95', '#7C3AED', '#EAB308'],
      textColor: '#FFFFFF',
      borderColor: '#FDE047',
    },
    roomThemeConfig: {
      themeName: 'Sovereign Celestial Palace',
      bgUrl: '',
      overlayGradient: ['rgba(76, 29, 149, 0.85)', 'rgba(15, 23, 42, 0.9)'],
    },
    nameEffectConfig: {
      gradient: ['#FDE047', '#F472B6', '#C084FC'],
      glowColor: '#FDE047',
    },
    entrySound: 'fanfare_king.mp3',
    particles: 'gold_particles',
    isActive: true,
    sortOrder: 5,
  },
];
