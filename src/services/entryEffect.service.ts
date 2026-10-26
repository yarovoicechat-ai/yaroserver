import { IdentityResolverService } from './identityResolver.service';
import { entryIsActive, roomEntryAsset } from '../utils/roomEntryRules';
import mongoose, { Types } from 'mongoose';
import { EntryEffect, IEntryEffect } from '../models/entryEffect.model';
import { User } from '../models/user.model';
import { getIOOptional } from '../sockets';
import { VipService } from './vip.service';
import { StoreItem } from '../models/storeItem.model';

const ENTRY_DURATIONS = [3, 7, 15, 30] as const;
const normalizeEntryPriceOptions = (value: any, basePrice: number) => {
  const ratios: Record<number, number> = { 3: 0.15, 7: 0.3, 15: 0.55, 30: 1 };
  const supplied = Array.isArray(value) ? value : [];
  return ENTRY_DURATIONS.map((days) => {
    const match = supplied.find((option: any) => Number(option?.days) === days);
    return {
      days,
      diamonds: Math.max(0, match ? Number(match.diamonds) || 0 : Math.round(basePrice * ratios[days])),
    };
  });
};

export const INITIAL_ENTRY_EFFECTS: Partial<IEntryEffect>[] = [
  {
    name: 'King Arrival',
    slug: 'king-arrival',
    tagText: '🔥 KING IS HERE',
    animationType: 'BANNER',
    icon: '👑',
    image: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=200',
    bannerColors: ['#F59E0B', '#B45309'],
    price: 10000,
    rarity: 'epic',
    isVip: true,
    isLimited: false,
    isActive: true,
    duration: 3000,
    sortOrder: 1,
  },
  {
    name: 'VIP Phantom',
    slug: 'vip-phantom',
    tagText: '👑 VIP HAS ENTERED',
    animationType: 'VIP_ENTRANCE',
    icon: '⚡',
    image: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200',
    bannerColors: ['#8B5CF6', '#4C1D95'],
    price: 25000,
    rarity: 'legendary',
    isVip: true,
    isLimited: false,
    isActive: true,
    duration: 3200,
    sortOrder: 2,
  },
  {
    name: 'Diamond Lord',
    slug: 'diamond-lord',
    tagText: '💎 DIAMOND LORD',
    animationType: 'CENTER_AVATAR',
    icon: '💎',
    image: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=200',
    bannerColors: ['#06B6D4', '#0E7490'],
    price: 50000,
    rarity: 'legendary',
    isVip: true,
    isLimited: true,
    isActive: true,
    duration: 3500,
    sortOrder: 3,
  },
  {
    name: 'Legend Beast',
    slug: 'legend-beast',
    tagText: '⚡ LEGEND ARRIVED',
    animationType: 'SPECIAL_EVENT',
    icon: '🦁',
    image: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=200',
    bannerColors: ['#EF4444', '#7F1D1D'],
    price: 99999,
    rarity: 'mythic',
    isVip: true,
    isLimited: true,
    isActive: true,
    duration: 3800,
    sortOrder: 4,
  },
  {
    name: 'Star Guest',
    slug: 'star-guest',
    tagText: '✨ SPECIAL GUEST',
    animationType: 'PARTICLES',
    icon: '✨',
    image: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=200',
    bannerColors: ['#EC4899', '#9D174D'],
    price: 5000,
    rarity: 'rare',
    isVip: false,
    isLimited: false,
    isActive: true,
    duration: 2600,
    sortOrder: 5,
  },
];

export class EntryEffectService {
  /**
   * Dummy effects are completely disabled to ensure only real admin-created entries are used.
   */
  static async seedDefaults() {
    // Disabled: Only real entrance effects uploaded via Admin Panel are preserved.
    return;
  }

  /**
   * Fetch all active entry effects (strictly real entries, excluding dummy seeds).
   */
  static async getEntryEffects(userId?: string | Types.ObjectId) {
    const DUMMY_NAMES = [
      'king arrival',
      'vip phantom',
      'diamond lord',
      'legend beast',
      'star guest',
      'royal phantom rolls',
      'golden dragon descent',
      'cyber hypercar',
    ];
    const regexes = DUMMY_NAMES.map(n => new RegExp(`^${n}$`, 'i'));
    const effects = await EntryEffect.find({
      isActive: true,
      name: { $nin: regexes },
      image: { $not: /unsplash\.com/i },
    }).sort({ sortOrder: 1, price: 1 }).lean();

    let ownedIds: string[] = [];
    let equippedId: string | null = null;
    let equippedTag: string = '';

    if (userId) {
      const user = await User.findById(userId).select('ownedEntryEffects equippedEntryEffect equippedEntryTag').lean();
      if (user) {
        ownedIds = (user.ownedEntryEffects || []).map(String);
        equippedId = user.equippedEntryEffect ? String(user.equippedEntryEffect) : null;
        equippedTag = user.equippedEntryTag || '';
      }
    }

    return effects.map((e) => ({
      ...e,
      isOwned: ownedIds.includes(String(e._id)),
      isEquipped: equippedId === String(e._id),
      equippedTag,
    }));
  }

  /**
   * Purchase an entry effect using DIAMONDS.
   */
  static async purchaseEffect(userId: string | Types.ObjectId, effectId: string) {
    if (!effectId || !Types.ObjectId.isValid(effectId)) {
      throw new Error('Invalid entry effect ID');
    }

    const effect = await EntryEffect.findById(effectId);
    if (!effect || !effect.isActive) {
      throw new Error('Entry effect not found or currently unavailable');
    }

    const user = await User.findById(userId).select('_id diamonds ownedEntryEffects').lean();
    if (!user) {
      throw new Error('User not found');
    }

    const alreadyOwned = (user.ownedEntryEffects || []).some((id: any) => String(id) === String(effect._id));
    if (alreadyOwned) {
      throw new Error('You already own this Entry Effect');
    }

    const price = Number(effect.price || 0);
    const userDiamonds = Number(user.diamonds || 0);

    if (userDiamonds < price) {
      const err: any = new Error(`Insufficient Diamonds. Required: ${price} 💎, Available: ${userDiamonds} 💎`);
      err.code = 'INSUFFICIENT_DIAMONDS';
      err.requiredDiamonds = price;
      err.availableDiamonds = userDiamonds;
      throw err;
    }

    // Deduct diamonds atomically and add to owned effects
    const updated = await User.findOneAndUpdate(
      { _id: user._id, diamonds: { $gte: price } },
      {
        $inc: { diamonds: -price },
        $addToSet: { ownedEntryEffects: effect._id },
        $set: {
          equippedEntryEffect: effect._id,
          equippedEntryTag: effect.tagText,
        },
      },
      { new: true }
    ).select('_id diamonds ownedEntryEffects equippedEntryEffect equippedEntryTag');

    if (!updated) {
      throw new Error('Transaction failed. Balance may have changed.');
    }

    return {
      success: true,
      message: `Purchased and equipped ${effect.name}!`,
      newBalance: updated.diamonds,
      equippedEffect: effect,
      equippedTag: effect.tagText,
    };
  }

  /**
   * Equip or unequip an entry effect and tag.
   */
  static async equipEffect(userId: string | Types.ObjectId, effectId?: string | null) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (!effectId) {
      // Unequip
      user.equippedEntryEffect = null as any;
      user.equippedEntryTag = '';
      await user.save();
      return { success: true, message: 'Unequipped entry effect', equippedEffect: null, equippedTag: '' };
    }

    const effect = await EntryEffect.findById(effectId);
    if (!effect) {
      throw new Error('Entry effect not found');
    }

    const isOwned = (user.ownedEntryEffects || []).some((id: any) => String(id) === String(effect._id));
    if (!isOwned) {
      throw new Error('You must purchase this entry effect before equipping it');
    }

    user.equippedEntryEffect = effect._id as any;
    user.equippedEntryTag = effect.tagText;
    await user.save();

    return {
      success: true,
      message: `Equipped ${effect.name}`,
      equippedEffect: effect,
      equippedTag: effect.tagText,
    };
  }

  /**
   * Broadcast an entry effect to a voice room when a user enters.
   */
  static async broadcastEntry(roomId: string, user: any, rawRoomId?: string) {
    if (!roomId || !user) return null;

    try {
      const idCandidates = [user.userId, user.numericUserId, user._id, user.id].filter(Boolean);
      let dbUser: any = null;
      for (const cand of idCandidates) {
        const str = String(cand).trim();
        if (!str || str.startsWith('join:')) continue;
        if (Types.ObjectId.isValid(str) && str.length === 24) {
          dbUser = await User.findById(str).populate('equippedEntryEffect').lean();
          if (dbUser) break;
        }
        const num = Number(str);
        if (!isNaN(num) && num > 0) {
          dbUser = await User.findOne({ userId: num }).populate('equippedEntryEffect').lean();
          if (dbUser) break;
        }
      }

      const source = dbUser || user;
      const identity = await IdentityResolverService.resolveEffectiveIdentity(source).catch(() => null);
      // Resolve equipped Entry Effect
      let entryEffect: any = source.equippedEntryAsset || null;
      if (!entryEffect && dbUser?.equippedEntryEffect) {
        const eff = dbUser.equippedEntryEffect as any;
        entryEffect = {
          id: eff._id,
          name: eff.name,
          animationType: eff.animationType || 'BANNER',
          tagText: dbUser?.equippedEntryTag || eff.tagText || 'VIP ENTRY',
          bannerColors: eff.bannerColors || ['#7C3AED', '#4C1D95'],
          duration: eff.duration || 3000,
          icon: eff.icon || '👑',
          image: eff.image || eff.imageUrl || '',
          animationUrl: eff.animationUrl || '',
          sound: eff.sound || '',
          metadata: eff.metadata || {},
          isActive: eff.isActive,
        };
      }
      if (!entryEffect && (source.equippedEntry)) {
        const entryName = source.equippedEntry;
        let fromInv = dbUser?.storeInventory?.find((i: any) =>
          (i.category === 'Entry' || i.category === 'Entry Effect' || i.category === 'Entry Effects') &&
          i.name === entryName
        );
        let catalogEffect: any = null;
        if (!fromInv) {
          catalogEffect = await EntryEffect.findOne({
            $or: [{ name: entryName }, { slug: entryName }],
          }).lean();
          if (!catalogEffect) {
            catalogEffect = await StoreItem.findOne({
              category: { $in: ['Entry', 'Entry Effect', 'Entry Effects'] },
              name: entryName,
            }).lean();
          }
        }
        entryEffect = {
          id: catalogEffect?._id || fromInv?._id || ('store_entry_' + Date.now()),
          name: entryName || 'VIP Grand Entry',
          animationType: catalogEffect?.animationType || catalogEffect?.metadata?.animationType || 'FULL_SCREEN',
          tagText: catalogEffect?.tagText || fromInv?.tag || '👑 VIP HAS ENTERED',
          bannerColors: catalogEffect?.bannerColors || catalogEffect?.bgColors || fromInv?.bannerColors || ['#7C3AED', '#4C1D95'],
          duration: catalogEffect?.duration || catalogEffect?.metadata?.duration || 4200,
          icon: catalogEffect?.icon || '👑',
          image: catalogEffect?.image || catalogEffect?.imageUrl || fromInv?.imageUrl || fromInv?.image || '',
          animationUrl: catalogEffect?.animationUrl || fromInv?.animationUrl || '',
          metadata: catalogEffect?.metadata || fromInv?.metadata || {},
          expiresAt: fromInv?.expiresAt,
        };
      }

      const vipExperience = await VipService.resolveVipExperience(source).catch(() => ({ isVip: false } as any));
      let entranceEffect: any = source.equippedEntranceAsset || source.equippedVehicleAsset || null;
      if (!entranceEffect) {
        const entranceName = source.equippedEntrance || source.equippedVehicle;
        const fromInv = entranceName ? dbUser?.storeInventory?.find((i: any) =>
          ['Entrance', 'entrance', 'Ride', 'ride', 'Vehicle', 'vehicle', 'Profile Entry', 'profile entry'].includes(i.category) &&
          i.name === entranceName
        ) : null;
        if (fromInv) {
          entranceEffect = {
            id: fromInv.id || fromInv._id,
            name: fromInv.name,
            animationUrl: fromInv.animationUrl || (/\.(svga|gif|webp|mp4)/i.test(fromInv.imageUrl || fromInv.image || '') ? (fromInv.imageUrl || fromInv.image) : ''),
            imageUrl: fromInv.imageUrl || fromInv.image || '',
            image: fromInv.imageUrl || fromInv.image || '',
            metadata: fromInv.metadata || {},
            expiresAt: fromInv.expiresAt,
          };
        } else if (entranceName) {
          const catalogItem = await StoreItem.findOne({
            category: { $in: ['Entrance', 'entrance', 'Ride', 'ride', 'Vehicle', 'vehicle', 'Profile Entry', 'profile entry'] },
            name: entranceName,
          }).lean();
          if (catalogItem) {
            entranceEffect = {
              id: catalogItem._id,
              name: catalogItem.name,
              animationUrl: catalogItem.animationUrl || (/\.(svga|gif|webp|mp4)/i.test(catalogItem.imageUrl || '') ? catalogItem.imageUrl : ''),
              imageUrl: catalogItem.imageUrl || (catalogItem as any).image || '',
              image: catalogItem.imageUrl || (catalogItem as any).image || '',
              bannerColors: catalogItem.bgColors || ['#06B6D4', '#0E7490'],
              metadata: catalogItem.metadata || {},
            };
          }
        }
      }

      // Resolve current panel settings even for assets equipped before an edit.
      const refreshAsset = async (asset: any, categories: string[]) => {
        if (!asset) return null;
        const id = asset.itemId || asset.id || asset._id;
        const catalog = await StoreItem.findOne({
          category: { $in: categories },
          $or: [
            ...(id && Types.ObjectId.isValid(String(id)) ? [{ _id: id }] : []),
            { name: asset.name || '' },
          ],
        }).lean();
        if (!catalog) return asset;
        const anim = catalog.animationUrl || (/\.(svga|gif|webp|mp4)/i.test(catalog.imageUrl || '') ? catalog.imageUrl : asset.animationUrl);
        return {
          ...asset,
          animationUrl: anim || asset.animationUrl || '',
          imageUrl: catalog.imageUrl || asset.imageUrl || '',
          image: catalog.imageUrl || asset.image || '',
          isActive: catalog.isActive,
          duration: catalog.metadata?.duration || asset.duration,
          bannerColors: catalog.bgColors?.length ? catalog.bgColors : asset.bannerColors,
          metadata: { ...(asset.metadata || {}), ...(catalog.metadata || {}) }
        };
      };
      entryEffect = await refreshAsset(entryEffect, ['Entry', 'entry', 'Entry Effect', 'entry effect', 'Entry Effects', 'entry effects']);
      entranceEffect = await refreshAsset(entranceEffect, ['Entrance', 'entrance', 'Ride', 'ride', 'Vehicle', 'vehicle', 'Profile Entry', 'profile entry']);
      const roomEntryEffect = roomEntryAsset(entryEffect);
      let activeEntrance = entranceEffect && entranceEffect.isActive !== false &&
        (!entranceEffect.expiresAt || new Date(entranceEffect.expiresAt).getTime() > Date.now()) &&
        (entranceEffect.animationUrl || entranceEffect.imageUrl || entranceEffect.image)
        ? { ...entranceEffect, imageUrl: entranceEffect.imageUrl || entranceEffect.image || '' }
        : null;
      if (!activeEntrance) {
        activeEntrance = {
          id: 'default_entrance',
          name: 'Default Entrance',
          isDefault: true,
          imageUrl: '/uploads/default_entrance_banner.png',
          bannerColors: ['#854D0E', '#B45309', '#78350F'],
          metadata: {
            comingText: 'enter the room',
            isDefault: true,
          },
        };
      }
      const hasEquippedEntry = Boolean(roomEntryEffect || (activeEntrance && !activeEntrance.isDefault));
      const tagText = roomEntryEffect ? 'is coming' : 'entered the room';
      const entryId = `entry_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const payload = {
        entryId,
        roomId,
        userId: String(dbUser?.userId || user.userId || dbUser?._id || user.id),
        vipId: dbUser?.equippedVipId || null,
        svipId: dbUser?.equippedSvipId || null,
        user: {
          id: dbUser?._id || user.id || user.userId,
          userId: dbUser?.userId || user.userId,
          name: dbUser?.name || user.name,
          avatar: dbUser?.image || user.avatar || user.image,
          level: dbUser?.level || user.level || 1,
          wealthLevel: source.wealthLevel || dbUser?.wealthLevel || source.level || 1,
          customDisplayId: source.customDisplayId || dbUser?.customDisplayId || null,
          uniqueId: source.uniqueId || dbUser?.uniqueId || null,
          nameEffect: identity?.nameEffect || source.nameEffect || vipExperience.nameEffect || null,
          equippedFrame: dbUser?.equippedFrameAsset || dbUser?.equippedFrame || user.equippedFrameAsset || user.equippedFrame || null,
          equippedFrameAsset: dbUser?.equippedFrameAsset || user.equippedFrameAsset || null,
        },
        hasEntry: hasEquippedEntry,
        entry: roomEntryEffect,
        effect: roomEntryEffect,
        tassel: null,
        entrance: activeEntrance,
        vipExperience: vipExperience.isVip ? vipExperience : null,
        tagText,
        timestamp: Date.now(),
      };

      const io = getIOOptional();
      if (io) {
        const entryEventId = `entry_${Date.now()}_${user?.userId || user?._id || 'u'}_${Math.random().toString(36).substr(2, 4)}`;
        payload.entryId = entryEventId;
        (payload as any).id = entryEventId;

        // io.to(...).to(...) deduplicates sockets in multiple rooms so each client receives exactly once
        const clean = String(roomId || '').trim();
        const norm = /^10000\d{3}$/.test(clean) ? `100000000${clean.slice(5)}`.slice(-10) : clean;
        let target = io.to(`voice_room_channel:${clean}`).to(`room:${clean}`);
        if (norm && norm !== clean) {
          target = target.to(`voice_room_channel:${norm}`).to(`room:${norm}`);
        }
        if (rawRoomId) {
          const rawClean = String(rawRoomId).trim();
          if (rawClean && rawClean !== clean && rawClean !== norm) {
            target = target.to(`voice_room_channel:${rawClean}`).to(`room:${rawClean}`);
          }
        }
        target.emit('entry:effect', payload);
      }

      return payload;
    } catch (err: any) {
      console.warn('[EntryEffectService] Broadcast entry error:', err.message);
      return null;
    }
  }

  static async cleanupDummyEffects() {
    try {
      const DUMMY_NAMES = [
        'king arrival',
        'vip phantom',
        'diamond lord',
        'legend beast',
        'star guest',
        'royal phantom rolls',
        'golden dragon descent',
        'cyber hypercar',
      ];
      const regexes = DUMMY_NAMES.map(n => new RegExp(`^${n}$`, 'i'));
      await EntryEffect.deleteMany({
        $or: [
          { name: { $in: regexes } },
          { image: { $regex: 'unsplash.com', $options: 'i' } },
        ],
      });
      await StoreItem.deleteMany({
        category: { $in: ['Entry', 'Entry Effect', 'Entry Effects'] },
        $or: [
          { name: { $in: regexes } },
          { imageUrl: { $regex: 'unsplash.com', $options: 'i' } },
        ],
      });
    } catch (e: any) {
      console.warn('[EntryEffectService] Cleanup dummy warning:', e.message);
    }
  }

  static async getAllAdminEffects() {
    await this.cleanupDummyEffects();
    const DUMMY_NAMES = [
      'king arrival',
      'vip phantom',
      'diamond lord',
      'legend beast',
      'star guest',
      'royal phantom rolls',
      'golden dragon descent',
      'cyber hypercar',
    ];
    const regexes = DUMMY_NAMES.map(n => new RegExp(`^${n}$`, 'i'));
    return await EntryEffect.find({
      name: { $nin: regexes },
      image: { $not: /unsplash\.com/i },
    }).sort({ sortOrder: 1, createdAt: -1 });
  }

  static async createEffect(data: any) {
    const name = String(data.name || '').trim();
    if (!name) throw new Error('Effect name is required');
    const slug = data.slug || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    const requestedPrice = Math.max(0, Number(data.price) || 0);
    const priceOptions = normalizeEntryPriceOptions(data.priceOptions, requestedPrice);
    const price = priceOptions.find((option) => option.days === 30)?.diamonds ?? requestedPrice;

    const effect = await EntryEffect.create({
      name,
      slug,
      tagText: data.tagText || '👑 VIP HAS ENTERED',
      animationType: data.animationType || 'BANNER',
      image: data.image || data.imageUrl || '',
      icon: data.icon || '👑',
      animationUrl: data.animationUrl || '',
      sound: data.sound || '',
      bannerColors: Array.isArray(data.bannerColors) && data.bannerColors.length >= 2 ? data.bannerColors : ['#7C3AED', '#4C1D95'],
      price,
      priceOptions,
      rarity: data.rarity || 'epic',
      isVip: Boolean(data.isVip),
      isLimited: Boolean(data.isLimited),
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
      duration: Number(data.duration) || 3000,
      sortOrder: Number(data.sortOrder) || 0,
      metadata: { ...(data.metadata || {}), showAvatar: data.metadata?.showAvatar === true, comingText: String(data.metadata?.comingText || 'is coming').slice(0, 80) },
    });

    // Auto-sync into StoreItem catalog under 'Entry' category so it immediately shows in the mobile app Store
    try {
      await StoreItem.create({
        name,
        category: 'Entry',
        price,
        priceOptions,
        validity: data.validity || '30 Days',
        badgeText: data.badgeText || (data.isVip ? 'VIP' : 'HOT'),
        previewColor: (data.bannerColors && data.bannerColors[0]) || '#8B5CF6',
        bgColors: data.bannerColors || ['#7C3AED', '#4C1D95'],
        icon: data.icon || 'car-sport',
        imageUrl: data.image || data.imageUrl || '',
        animationUrl: data.animationUrl || '',
        desc: data.desc || `Exclusive room entrance effect: ${name}`,
        isActive: effect.isActive,
        sortOrder: effect.sortOrder,
        metadata: {
          ...(effect.metadata || {}),
          effectId: String(effect._id),
          banner: data.tagText || '👑 VIP HAS ENTERED',
          animationType: effect.animationType,
          duration: effect.duration,
        },
      });
    } catch (err: any) {
      console.warn('[EntryEffectService] Auto-sync to StoreItem notice:', err.message);
    }

    return effect;
  }

  static async updateEffect(id: string, data: any) {
    const effect = await EntryEffect.findById(id);
    if (!effect) throw new Error('Entry effect not found');

    if (data.name !== undefined) effect.name = data.name;
    if (data.tagText !== undefined) effect.tagText = data.tagText;
    if (data.animationType !== undefined) effect.animationType = data.animationType;
    if (data.image !== undefined) effect.image = data.image;
    if (data.imageUrl !== undefined) effect.image = data.imageUrl;
    if (data.animationUrl !== undefined) effect.animationUrl = data.animationUrl;
    if (data.sound !== undefined) effect.sound = data.sound;
    if (data.icon !== undefined) effect.icon = data.icon;
    if (data.price !== undefined || data.priceOptions !== undefined) {
      const requestedPrice = data.price !== undefined
        ? Math.max(0, Number(data.price) || 0)
        : Math.max(0, Number(effect.price) || 0);
      const priceOptions = normalizeEntryPriceOptions(data.priceOptions ?? effect.priceOptions, requestedPrice);
      effect.priceOptions = priceOptions as any;
      effect.price = priceOptions.find((option) => option.days === 30)?.diamonds ?? requestedPrice;
    }
    if (data.bannerColors !== undefined) effect.bannerColors = data.bannerColors;
    if (data.rarity !== undefined) effect.rarity = data.rarity;
    if (data.isVip !== undefined) effect.isVip = Boolean(data.isVip);
    if (data.isLimited !== undefined) effect.isLimited = Boolean(data.isLimited);
    if (data.isActive !== undefined) effect.isActive = Boolean(data.isActive);
    if (data.duration !== undefined) effect.duration = Number(data.duration);
    if (data.sortOrder !== undefined) effect.sortOrder = Number(data.sortOrder);
    if (data.metadata !== undefined) effect.metadata = { ...(effect.metadata || {}), ...data.metadata };

    await effect.save();

    // Sync StoreItem
    try {
      await StoreItem.updateMany(
        { $or: [{ 'metadata.effectId': String(effect._id) }, { name: effect.name, category: 'Entry' }] },
        {
          $set: {
            name: effect.name,
            price: effect.price,
            priceOptions: effect.priceOptions,
            imageUrl: effect.image,
            animationUrl: effect.animationUrl,
            isActive: effect.isActive,
            metadata: { ...(effect.metadata || {}), effectId: String(effect._id), banner: effect.tagText, animationType: effect.animationType, duration: effect.duration },
          },
        }
      );
    } catch (_) {}

    return effect;
  }

  static async deleteEffect(id: string) {
    const effect = await EntryEffect.findByIdAndDelete(id);
    if (effect) {
      try {
        await StoreItem.deleteMany({
          $or: [{ 'metadata.effectId': String(effect._id) }, { name: effect.name, category: 'Entry' }],
        });
      } catch (_) {}
    }
    return effect;
  }

  static async toggleEffect(id: string) {
    const effect = await EntryEffect.findById(id);
    if (!effect) throw new Error('Entry effect not found');
    effect.isActive = !effect.isActive;
    await effect.save();

    try {
      await StoreItem.updateMany(
        { $or: [{ 'metadata.effectId': String(effect._id) }, { name: effect.name, category: 'Entry' }] },
        { $set: { isActive: effect.isActive } }
      );
    } catch (_) {}

    return effect;
  }
}
