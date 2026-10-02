import mongoose, { Types } from 'mongoose';
import { EntryEffect, IEntryEffect } from '../models/entryEffect.model';
import { User } from '../models/user.model';
import { getIOOptional } from '../sockets';
import { VipService } from './vip.service';
import { StoreItem } from '../models/storeItem.model';

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
   * Seed default entry effects if database is empty.
   */
  static async seedDefaults() {
    try {
      const count = await EntryEffect.countDocuments();
      if (count === 0) {
        console.log('[EntryEffectService] Seeding initial entry effects...');
        await EntryEffect.insertMany(INITIAL_ENTRY_EFFECTS);
      }
    } catch (err: any) {
      console.warn('[EntryEffectService] Seed warning:', err.message);
    }
  }

  /**
   * Fetch all active entry effects.
   */
  static async getEntryEffects(userId?: string | Types.ObjectId) {
    let effects = await EntryEffect.find({ isActive: true }).sort({ sortOrder: 1, price: 1 }).lean();
    if (!effects || effects.length === 0) {
      await this.seedDefaults();
      effects = await EntryEffect.find({ isActive: true }).sort({ sortOrder: 1, price: 1 }).lean();
    }

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
  static async broadcastEntry(roomId: string, user: any) {
    if (!roomId || !user) return null;

    try {
      let dbUser: any = null;
      const lookupId = user._id || user.userId || user.id;
      if (lookupId) {
        if (Types.ObjectId.isValid(String(lookupId))) {
          dbUser = await User.findById(lookupId).populate('equippedEntryEffect').lean();
        }
        if (!dbUser) {
          dbUser = await User.findOne({ userId: String(lookupId) }).populate('equippedEntryEffect').lean();
        }
      }

      const effect = dbUser?.equippedEntryEffect as any;
      const tagText = dbUser?.equippedEntryTag || effect?.tagText || '';

      const entryId = `entry_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

      const vipExperience = await VipService.resolveVipExperience(dbUser || user);

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
        },
        effect: effect
          ? {
              id: effect._id,
              name: effect.name,
              animationType: effect.animationType,
              tagText: tagText || effect.tagText,
              bannerColors: effect.bannerColors,
              duration: effect.duration,
              icon: effect.icon,
              image: effect.image,
              animationUrl: effect.animationUrl,
              sound: effect.sound,
            }
          : {
              id: 'default_party_entry',
              name: 'Room Welcome',
              animationType: 'BANNER',
              tagText: tagText || 'MEMBER',
              bannerColors: ['#6366F1', '#8B5CF6'],
              duration: 2500,
              icon: '✨',
            },
        vipExperience: vipExperience.isVip ? vipExperience : null,
        tagText: tagText || vipExperience.entryTag || 'MEMBER',
        timestamp: Date.now(),
      };

      const io = getIOOptional();
      if (io) {
        const channels = [
          `room:${roomId}`,
          `voice_room_channel:${roomId}`,
        ];

        channels.forEach((channel) => {
          io.to(channel).emit('entry:effect', payload);
          io.to(channel).emit('room:entry', payload);

          if (vipExperience.isVip) {
            io.to(channel).emit('room:vip-entry', payload);
            io.to(channel).emit('vip:entry', payload);
          }
        });
      }

      return payload;
    } catch (err: any) {
      console.warn('[EntryEffectService] Broadcast entry error:', err.message);
      return null;
    }
  }

  static async getAllAdminEffects() {
    await this.seedDefaults();
    return await EntryEffect.find().sort({ sortOrder: 1, createdAt: -1 });
  }

  static async createEffect(data: any) {
    const name = String(data.name || '').trim();
    if (!name) throw new Error('Effect name is required');
    const slug = data.slug || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    const price = Number(data.price) || 0;

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
      rarity: data.rarity || 'epic',
      isVip: Boolean(data.isVip),
      isLimited: Boolean(data.isLimited),
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
      duration: Number(data.duration) || 3000,
      sortOrder: Number(data.sortOrder) || 0,
      metadata: data.metadata || {},
    });

    // Auto-sync into StoreItem catalog under 'Entry' category so it immediately shows in the mobile app Store
    try {
      await StoreItem.create({
        name,
        category: 'Entry',
        price,
        priceOptions: [
          { days: 3, diamonds: Math.round(price * 0.15) },
          { days: 7, diamonds: Math.round(price * 0.3) },
          { days: 15, diamonds: Math.round(price * 0.55) },
          { days: 30, diamonds: price },
        ],
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
          effectId: String(effect._id),
          banner: data.tagText || '👑 VIP HAS ENTERED',
          animationType: effect.animationType,
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
    if (data.price !== undefined) effect.price = Number(data.price);
    if (data.bannerColors !== undefined) effect.bannerColors = data.bannerColors;
    if (data.rarity !== undefined) effect.rarity = data.rarity;
    if (data.isVip !== undefined) effect.isVip = Boolean(data.isVip);
    if (data.isLimited !== undefined) effect.isLimited = Boolean(data.isLimited);
    if (data.isActive !== undefined) effect.isActive = Boolean(data.isActive);
    if (data.duration !== undefined) effect.duration = Number(data.duration);
    if (data.sortOrder !== undefined) effect.sortOrder = Number(data.sortOrder);

    await effect.save();

    // Sync StoreItem
    try {
      await StoreItem.updateMany(
        { $or: [{ 'metadata.effectId': String(effect._id) }, { name: effect.name, category: 'Entry' }] },
        {
          $set: {
            name: effect.name,
            price: effect.price,
            imageUrl: effect.image,
            animationUrl: effect.animationUrl,
            isActive: effect.isActive,
            'metadata.banner': effect.tagText,
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
