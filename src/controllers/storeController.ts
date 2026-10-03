import { Request, Response } from 'express';
import { StoreItem, IStoreItem, StoreCategory } from '../models/storeItem.model';
import { User } from '../models/user.model';
import sendResponse from '../utils/reponse';
import HostLevel from '../models/hostLevel.model';
import Level from '../models/level.model';
import { EntryEffect } from '../models/entryEffect.model';
import { recalculateAndUpdateHostLevel } from '../services/user.service';

const STORE_DURATIONS = [3, 7, 15, 30] as const;

const buildDefaultPriceOptions = (price: number) => {
  const base = Math.max(0, Number(price) || 0);
  const ratios: Record<number, number> = { 3: 0.15, 7: 0.3, 15: 0.55, 30: 1 };
  return STORE_DURATIONS.map((days) => ({
    days,
    diamonds: Math.max(0, Math.round(base * ratios[days])),
  }));
};

const normalizePriceOptions = (value: any, fallbackPrice: number) => {
  const supplied = Array.isArray(value) ? value : [];
  const defaults = buildDefaultPriceOptions(fallbackPrice);
  return STORE_DURATIONS.map((days) => {
    const match = supplied.find((option: any) => Number(option?.days) === days);
    const diamonds = match ? Number(match.diamonds) : defaults.find((option) => option.days === days)?.diamonds;
    return { days, diamonds: Math.max(0, Number(diamonds) || 0) };
  });
};

const serializeStoreItem = (item: any) => {
  const plain = typeof item?.toObject === 'function' ? item.toObject() : item;
  const metadata = plain?.metadata || {};
  return {
    ...plain,
    id: String(plain?._id || plain?.id || ''),
    priceOptions: normalizePriceOptions(plain?.priceOptions, plain?.price),
    number: metadata.number,
    digits: metadata.digits,
    tag: metadata.tag || plain?.badgeText,
    banner: metadata.banner,
    benefits: Array.isArray(metadata.benefits) ? metadata.benefits : [],
  };
};

// Initial default seed items matching Yaro mobile store catalog
const DEFAULT_SEED_ITEMS: Partial<IStoreItem>[] = [
  // 1. UNIQUE IDS
  {
    name: '88888 (Fortune Gold)',
    category: 'Unique ID',
    price: 50000,
    validity: 'Permanent',
    badgeText: 'HOT',
    previewColor: '#F59E0B',
    bgColors: ['#78350F', '#B45309', '#D97706'],
    icon: 'numeric-8-circle',
    desc: 'Exclusive 5-digit lucky fortune ID with golden profile shine and room entrance highlight.',
    metadata: { number: '88888', digits: '5-Digit', tag: 'Royal Gold' },
    sortOrder: 1,
    isActive: true,
  },
  {
    name: '99999 (Crown Emperor)',
    category: 'Unique ID',
    price: 60000,
    validity: 'Permanent',
    badgeText: 'VIP',
    previewColor: '#8B5CF6',
    bgColors: ['#3B0764', '#581C87', '#7C3AED'],
    icon: 'numeric-9-circle',
    desc: 'Supreme 5-digit Emperor ID with purple royal aura and permanent verified profile mark.',
    metadata: { number: '99999', digits: '5-Digit', tag: 'Imperial' },
    sortOrder: 2,
    isActive: true,
  },
  {
    name: '77777 (Jackpot Lucky)',
    category: 'Unique ID',
    price: 45000,
    validity: 'Permanent',
    badgeText: 'NEW',
    previewColor: '#10B981',
    bgColors: ['#064E3B', '#065F46', '#059669'],
    icon: 'numeric-7-circle',
    desc: 'Lucky 77777 sequence with clover highlight and lucky emerald room greeting.',
    metadata: { number: '77777', digits: '5-Digit', tag: 'Lucky 7' },
    sortOrder: 3,
    isActive: true,
  },
  {
    name: '1314520 (Forever Romance)',
    category: 'Unique ID',
    price: 35000,
    validity: 'Permanent',
    badgeText: 'HOT',
    previewColor: '#EC4899',
    bgColors: ['#831843', '#9D174D', '#DB2777'],
    icon: 'heart-circle',
    desc: 'Special romance sequence meaning "Love You For A Lifetime" with floating hearts badge.',
    metadata: { number: '1314520', digits: '7-Digit', tag: 'Romance' },
    sortOrder: 4,
    isActive: true,
  },
  {
    name: '666666 (Smooth Victory)',
    category: 'Unique ID',
    price: 30000,
    validity: 'Permanent',
    badgeText: 'SALE',
    previewColor: '#06B6D4',
    bgColors: ['#164E63', '#155E75', '#0891B2'],
    icon: 'numeric-6-circle',
    desc: 'Six-digit repeating victory ID with laser cyan banner and custom badge tag.',
    metadata: { number: '666666', digits: '6-Digit', tag: 'Grand Hex' },
    sortOrder: 5,
    isActive: true,
  },

  // 2. CHAT BUBBLES
  {
    name: 'Golden Royal Bubble',
    category: 'Chat Bubble',
    price: 1200,
    validity: '30 Days',
    badgeText: 'HOT',
    previewColor: '#F59E0B',
    bgColors: ['#78350F', '#B45309', '#D97706'],
    icon: 'chatbubble-ellipses',
    desc: 'Lavish gold leaf border with warm ambient glow on every chat message in public & room channels.',
    metadata: { textColor: '#FEF3C7', borderColor: '#F59E0B' },
    sortOrder: 10,
    isActive: true,
  },
  {
    name: 'Cyberpunk Glow Bubble',
    category: 'Chat Bubble',
    price: 1500,
    validity: '30 Days',
    badgeText: 'NEW',
    previewColor: '#06B6D4',
    bgColors: ['#164E63', '#0891B2', '#06B6D4'],
    icon: 'flash',
    desc: 'Futuristic neon cyan pulse border inspired by cyberpunk neon cityscapes.',
    metadata: { textColor: '#ECFEFF', borderColor: '#22D3EE' },
    sortOrder: 11,
    isActive: true,
  },
  {
    name: 'Sakura Romance Bubble',
    category: 'Chat Bubble',
    price: 1000,
    validity: '30 Days',
    badgeText: 'LIMITED',
    previewColor: '#EC4899',
    bgColors: ['#831843', '#BE185D', '#EC4899'],
    icon: 'heart',
    desc: 'Delicate pink cherry blossom gradient with subtle petal flare sparkles.',
    metadata: { textColor: '#FDF2F8', borderColor: '#F472B6' },
    sortOrder: 12,
    isActive: true,
  },
  {
    name: 'Galaxy Nebula Bubble',
    category: 'Chat Bubble',
    price: 1800,
    validity: '30 Days',
    badgeText: 'VIP',
    previewColor: '#8B5CF6',
    bgColors: ['#3B0764', '#6D28D9', '#8B5CF6'],
    icon: 'planet',
    desc: 'Deep cosmic violet with glowing stardust particles across your dialogs.',
    metadata: { textColor: '#F5F3FF', borderColor: '#A78BFA' },
    sortOrder: 13,
    isActive: true,
  },

  // 3. MIC WAVES
  {
    name: 'Golden Pulse Wave',
    category: 'Mic Wave',
    price: 2500,
    validity: '30 Days',
    badgeText: 'HOT',
    previewColor: '#F59E0B',
    bgColors: ['#78350F', '#F59E0B'],
    icon: 'radio',
    desc: 'Golden radiance audio pulse rings expanding dynamically around your mic seat in party rooms.',
    metadata: { waveColors: ['#F59E0B', '#FBBF24', '#D97706'], intensity: 'high' },
    sortOrder: 20,
    isActive: true,
  },
  {
    name: 'Cyber Neon Wave',
    category: 'Mic Wave',
    price: 2800,
    validity: '30 Days',
    badgeText: 'NEW',
    previewColor: '#06B6D4',
    bgColors: ['#083344', '#06B6D4'],
    icon: 'pulse',
    desc: 'High-frequency electric cyan waves with holographic rhythm synchronization.',
    metadata: { waveColors: ['#06B6D4', '#22D3EE', '#0891B2'], intensity: 'ultra' },
    sortOrder: 21,
    isActive: true,
  },
  {
    name: 'Heartbeat Crimson Wave',
    category: 'Mic Wave',
    price: 2200,
    validity: '30 Days',
    badgeText: 'HOT',
    previewColor: '#EF4444',
    bgColors: ['#450A0A', '#EF4444'],
    icon: 'heart',
    desc: 'Deep passionate ruby red pulse radiating rhythmic love resonance whenever you speak.',
    metadata: { waveColors: ['#EF4444', '#F87171', '#DC2626'], intensity: 'medium' },
    sortOrder: 22,
    isActive: true,
  },
  {
    name: 'Solar Flare Wave',
    category: 'Mic Wave',
    price: 3200,
    validity: 'Permanent',
    badgeText: 'VIP',
    previewColor: '#F97316',
    bgColors: ['#431407', '#F97316'],
    icon: 'sunny',
    desc: 'Intense coronal solar loops bursting around your voice chair with fiery corona effects.',
    metadata: { waveColors: ['#F97316', '#FB923C', '#EA580C'], intensity: 'ultra' },
    sortOrder: 23,
    isActive: true,
  },

  // 4. FRAMES
  {
    name: 'Rose Sovereign Frame',
    category: 'Frames',
    price: 3500,
    validity: '30 Days',
    badgeText: 'HOT',
    previewColor: '#F43F5E',
    bgColors: ['#4C0519', '#E11D48'],
    icon: 'shield',
    desc: 'A romantic floral frame with blooming pink roses and glowing sparkle petals around your avatar.',
    metadata: { frameLevel: 1, animated: true },
    sortOrder: 30,
    isActive: true,
  },
  {
    name: 'Crown Imperial Frame',
    category: 'Frames',
    price: 5000,
    validity: 'Permanent',
    badgeText: 'VIP',
    previewColor: '#F59E0B',
    bgColors: ['#451A03', '#F59E0B'],
    icon: 'crown',
    desc: 'Grand golden monarchy crown encrusted with diamonds that rests elegantly atop your profile picture.',
    metadata: { frameLevel: 5, animated: true },
    sortOrder: 31,
    isActive: true,
  },
  {
    name: 'Cyber Neon Ring Frame',
    category: 'Frames',
    price: 3800,
    validity: '30 Days',
    badgeText: 'NEW',
    previewColor: '#06B6D4',
    bgColors: ['#083344', '#06B6D4'],
    icon: 'aperture',
    desc: 'High-tech rotating cyan neon HUD ring that loops around user profile avatars.',
    metadata: { frameLevel: 2, animated: true },
    sortOrder: 32,
    isActive: true,
  },

  // 5. ENTRY EFFECTS
  {
    name: 'Royal Phantom Rolls',
    category: 'Entry',
    price: 15000,
    validity: '30 Days',
    badgeText: 'VIP',
    previewColor: '#F59E0B',
    bgColors: ['#1C1917', '#F59E0B'],
    icon: 'car-sport',
    desc: 'Luxury black & gold limousine rolls onto the party screen with headlights flashing and golden horn fanfare.',
    metadata: { vehicleType: 'Limousine', entryDurationSec: 5, banner: 'His Excellency Has Arrived' },
    sortOrder: 40,
    isActive: true,
  },
  {
    name: 'Golden Dragon Descent',
    category: 'Entry',
    price: 25000,
    validity: 'Permanent',
    badgeText: 'HOT',
    previewColor: '#EAB308',
    bgColors: ['#422006', '#EAB308'],
    icon: 'flame',
    desc: 'Mythical golden oriental dragon swoops down through lightning clouds to deliver you onto the main stage.',
    metadata: { vehicleType: 'Dragon', entryDurationSec: 6, banner: 'Supreme Sovereign Enters' },
    sortOrder: 41,
    isActive: true,
  },
  {
    name: 'Cyber Hypercar',
    category: 'Entry',
    price: 12000,
    validity: '30 Days',
    badgeText: 'NEW',
    previewColor: '#06B6D4',
    bgColors: ['#082F49', '#06B6D4'],
    icon: 'speedometer',
    desc: 'Futuristic hyper-sports car drifts across the chat room leaving glowing neon tire marks.',
    metadata: { vehicleType: 'Hypercar', entryDurationSec: 4, banner: 'Speed King Enters The Room' },
    sortOrder: 42,
    isActive: true,
  },

  // 6. ROOM THEMES
  {
    name: 'Imperial Palace Theme',
    category: 'Theme',
    price: 8000,
    validity: '30 Days',
    badgeText: 'HOT',
    previewColor: '#854D0E',
    bgColors: ['#1C1917', '#854D0E'],
    icon: 'business',
    desc: 'Transforms your voice party room into a majestic imperial throne room with golden pillars & chandeliers.',
    metadata: { themeWallpaper: 'palace_gold', ambiance: 'Luxury' },
    sortOrder: 50,
    isActive: true,
  },
  {
    name: 'Cyber Odyssey Theme',
    category: 'Theme',
    price: 7500,
    validity: '30 Days',
    badgeText: 'NEW',
    previewColor: '#06B6D4',
    bgColors: ['#030712', '#06B6D4'],
    icon: 'globe',
    desc: 'Immersive deep-space cyber cockpit with neon star charts and glowing equalizer consoles.',
    metadata: { themeWallpaper: 'cyber_odyssey', ambiance: 'Sci-Fi' },
    sortOrder: 51,
    isActive: true,
  },

  // 7. TASSELS
  {
    name: 'Golden Peacock Tassel',
    category: 'Tassel',
    price: 1800,
    validity: '30 Days',
    badgeText: 'HOT',
    previewColor: '#D97706',
    bgColors: ['#451A03', '#D97706'],
    icon: 'ribbon',
    desc: 'Golden silk tassel with peacock feather motif that dangles gracefully from your profile card.',
    metadata: { style: 'Gold Silk', charm: 'Peacock' },
    sortOrder: 60,
    isActive: true,
  },
  {
    name: 'Imperial Jade Tassel',
    category: 'Tassel',
    price: 2200,
    validity: 'Permanent',
    badgeText: 'VIP',
    previewColor: '#059669',
    bgColors: ['#064E3B', '#059669'],
    icon: 'sparkles',
    desc: 'Rare carved emerald jade stone medallion tied with emerald braided silk tassels.',
    metadata: { style: 'Jade Medallion', charm: 'Imperial Jade' },
    sortOrder: 61,
    isActive: true,
  },

  // 8. VIP PACKAGES
  {
    name: 'VIP Bronze (30 Days)',
    category: 'VIP',
    price: 5000,
    validity: '30 Days',
    badgeText: 'HOT',
    previewColor: '#CD7F32',
    bgColors: ['#3A1F04', '#B45309'],
    icon: 'medal',
    desc: 'Includes Bronze Crown badge, 100 Free Daily Diamonds, 5% Room Gift Rebate, and Anti-Kick protection.',
    metadata: { tier: 'Bronze', dailyDiamonds: 100, rebatePercent: 5 },
    sortOrder: 70,
    isActive: true,
  },
  {
    name: 'VIP Silver (30 Days)',
    category: 'VIP',
    price: 12000,
    validity: '30 Days',
    badgeText: 'POPULAR',
    previewColor: '#94A3B8',
    bgColors: ['#1E293B', '#64748B'],
    icon: 'shield-checkmark',
    desc: 'Includes Silver Crown badge, 300 Free Daily Diamonds, 10% Room Gift Rebate, Custom Bubble & Mic Wave.',
    metadata: { tier: 'Silver', dailyDiamonds: 300, rebatePercent: 10 },
    sortOrder: 71,
    isActive: true,
  },
  {
    name: 'SVIP Sovereign (90 Days)',
    category: 'VIP',
    price: 35000,
    validity: '90 Days',
    badgeText: 'SUPREME',
    previewColor: '#A855F7',
    bgColors: ['#3B0764', '#7E22CE', '#C084FC'],
    icon: 'diamond',
    desc: 'Supreme Emperor status: 1000 Daily Diamonds, Golden Dragon entrance, Invisible stealth mode & 24/7 Concierge.',
    metadata: { tier: 'SVIP', dailyDiamonds: 1000, rebatePercent: 20 },
    sortOrder: 72,
    isActive: true,
  },
];

export const getStoreItems = async (req: Request, res: Response) => {
  try {
    const { category, search, activeOnly } = req.query;

    // Check count and auto-seed if collection is completely empty
    const count = await StoreItem.countDocuments();
    if (count === 0) {
      await StoreItem.insertMany(DEFAULT_SEED_ITEMS);
    }

    // Auto-sync any existing frames from Level collection (e.g., 'new frame' uploaded via Admin) into StoreItem
    try {
      const levels = await Level.find({ image: { $exists: true, $ne: "" } }).lean();
      for (const lvl of levels) {
        const frameName = lvl.name || lvl.text;
        if (!frameName) continue;
        const exists = await StoreItem.findOne({
          category: { $in: ['Frames', 'Frame'] },
          $or: [{ name: frameName }, { imageUrl: lvl.image }]
        });
        if (!exists) {
          const price = 3500;
          await StoreItem.create({
            name: frameName,
            category: 'Frames',
            price,
            priceOptions: [
              { days: 3, diamonds: 525 },
              { days: 7, diamonds: 1050 },
              { days: 15, diamonds: 1925 },
              { days: 30, diamonds: price },
            ],
            validity: '30 Days',
            badgeText: 'HOT',
            previewColor: '#F43F5E',
            imageUrl: lvl.image,
            desc: `Avatar profile frame: ${frameName}`,
            isActive: true,
            sortOrder: lvl.level || 1,
            metadata: { frameLevel: lvl.level || 1 },
          });
          console.log(`[StoreItem] Auto-synced frame "${frameName}" from Level to StoreItem catalog.`);
        }
      }
    } catch (syncErr: any) {
      console.warn('[StoreItem] Frame sync notice:', syncErr.message);
    }

    const filter: any = {};
    if (category && category !== 'All') {
      const cat = String(category).trim();
      if (cat === 'Frames' || cat === 'Frame') {
        filter.category = { $in: ['Frames', 'Frame'] };
      } else if (cat === 'Entry' || cat === 'Entry Effect' || cat === 'Entry Effects') {
        filter.category = { $in: ['Entry', 'Entry Effect'] };
      } else {
        filter.category = cat;
      }
    }
    if (activeOnly === 'true') {
      filter.isActive = true;
    }
    if (search && typeof search === 'string' && search.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { desc: { $regex: search.trim(), $options: 'i' } },
        { badgeText: { $regex: search.trim(), $options: 'i' } },
        { 'metadata.number': { $regex: search.trim(), $options: 'i' } },
      ];
    }

    const items = await StoreItem.find(filter).sort({ category: 1, sortOrder: 1, createdAt: -1 }).lean();
    const serializedItems = items.map(serializeStoreItem);
    const catalog = serializedItems.reduce((grouped: Record<string, any[]>, item: any) => {
      // Normalize category keys so mobile app's STORE_CATEGORIES find them easily
      const normCat = item.category === 'Frame' ? 'Frames'
        : (item.category === 'Entry Effect' || item.category === 'Entry Effects') ? 'Entry'
        : item.category;

      if (!grouped[normCat]) grouped[normCat] = [];
      grouped[normCat].push({ ...item, category: normCat });

      if (item.category !== normCat) {
        if (!grouped[item.category]) grouped[item.category] = [];
        grouped[item.category].push(item);
      }
      return grouped;
    }, {});

    // Category distribution counts for admin dashboard
    const categoryStats = await StoreItem.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 }, activeCount: { $sum: { $cond: ['$isActive', 1, 0] } } } },
    ]);

    return sendResponse(res, 200, true, 'Store items retrieved successfully', {
      items: serializedItems,
      catalog,
      total: serializedItems.length,
      categoryStats,
    });
  } catch (error: any) {
    console.error('getStoreItems error:', error);
    return sendResponse(res, 500, false, error.message || 'Failed to fetch store items');
  }
};

export const getStoreItemById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const item = await StoreItem.findById(id);
    if (!item) {
      return sendResponse(res, 404, false, 'Store item not found');
    }
    return sendResponse(res, 200, true, 'Store item retrieved', item);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Error fetching store item');
  }
};

export const getStoreInventory = async (req: any, res: Response) => {
  try {
    const account = await User.findById(req.user?.id).select('role').lean();
    if (!account) return sendResponse(res, 404, false, 'User not found');
    if (account.role === 'host') {
      await recalculateAndUpdateHostLevel(req.user.id);
    }
    const user = await User.findById(req.user?.id).select('storeInventory');
    if (!user) return sendResponse(res, 404, false, 'User not found');
    const now = Date.now();
    const items = (user.storeInventory || [])
      .filter((item) => !item.expiresAt || new Date(item.expiresAt).getTime() > now)
      .sort((a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime());
    return sendResponse(res, 200, true, 'Active items fetched', { items });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch inventory');
  }
};

export const getStoreLevels = async (req: Request, res: Response) => {
  try {
    const { type } = req.query; // 'wealth' | 'charm' | undefined
    const now = new Date();
    const levels = await HostLevel.find({
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
    }).select('level name coinPerMinute minCalls minMinutes rewards image text').sort({ level: 1 }).lean();

    const charmLevels = levels.map((l: any) => ({
      ...l,
      type: 'charm',
      category: 'Charm Level',
      expRequired: (Number(l.minMinutes) || 0) * 60 + (Number(l.minCalls) || 0) * 10,
    }));

    const wealthLevels = levels.map((l: any) => {
      const lvl = Number(l.level) || 1;
      return {
        _id: `wealth_${l._id || lvl}`,
        level: lvl,
        name: `Wealth Monarch Lv.${lvl}`,
        type: 'wealth',
        category: 'Wealth Level',
        coinsRequired: Math.round(Math.pow(lvl, 1.8) * 1000),
        rewards: l.rewards || [{ name: `Wealth Level ${lvl} Frame`, type: 'frame' }],
        badge: lvl >= 50 ? '👑' : lvl >= 25 ? '💎' : '🥇',
      };
    });

    const activeList = type === 'wealth' ? wealthLevels : charmLevels;

    return sendResponse(res, 200, true, 'Levels fetched', {
      levels: activeList,
      wealthLevels,
      charmLevels,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch levels');
  }
};

export const createStoreItem = async (req: Request, res: Response) => {
  try {
    let {
      name,
      category,
      price,
      priceOptions,
      validity,
      badgeText,
      previewColor,
      bgColors,
      icon,
      imageUrl,
      animationUrl,
      desc,
      isActive,
      sortOrder,
      metadata,
    } = req.body;

    if (!name || !category || price === undefined) {
      return sendResponse(res, 400, false, 'Name, category, and price are required');
    }

    // Normalize category
    if (category === 'Frame') category = 'Frames';
    if (category === 'Entry Effect' || category === 'Entry Effects') category = 'Entry';

    const normalizedPrices = normalizePriceOptions(priceOptions, Number(price) || 0);
    const thirtyDayPrice = normalizedPrices.find((option) => option.days === 30)?.diamonds || Number(price) || 0;

    const newItem = await StoreItem.create({
      name: String(name).trim(),
      category,
      price: thirtyDayPrice,
      priceOptions: normalizedPrices,
      validity: validity || '30 Days',
      badgeText: badgeText || '',
      previewColor: previewColor || '#8B5CF6',
      bgColors: Array.isArray(bgColors) ? bgColors : ['#3B0764', '#7C3AED'],
      icon: icon || (category === 'Entry' ? 'car-sport' : category === 'Frames' ? 'shield' : 'sparkles'),
      imageUrl: imageUrl || '',
      animationUrl: animationUrl || '',
      desc: desc || '',
      isActive: isActive !== false,
      sortOrder: Number(sortOrder) || 0,
      metadata: metadata || {},
    });

    // Cross-sync: If Entry, ensure EntryEffect document exists
    if (category === 'Entry') {
      try {
        const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
        await EntryEffect.findOneAndUpdate(
          { name: name.trim() },
          {
            name: name.trim(),
            slug,
            tagText: metadata?.banner || metadata?.tagText || badgeText || '👑 VIP HAS ENTERED',
            animationType: metadata?.animationType || 'BANNER',
            image: imageUrl || '',
            animationUrl: animationUrl || '',
            sound: metadata?.sound || '',
            price: thirtyDayPrice,
            isActive: newItem.isActive,
            duration: metadata?.duration || 3000,
            metadata: { storeItemId: String(newItem._id), ...metadata },
          },
          { upsert: true, new: true }
        );
      } catch (entrySyncErr: any) {
        console.warn('[createStoreItem] EntryEffect sync notice:', entrySyncErr.message);
      }
    }

    // Cross-sync: If Frames and level is supplied, ensure Level exists
    if (category === 'Frames' && (metadata?.frameLevel || metadata?.level)) {
      try {
        const frameLvl = Number(metadata.frameLevel || metadata.level) || 1;
        await Level.findOneAndUpdate(
          { level: frameLvl },
          { name: name.trim(), text: name.trim(), level: frameLvl, image: imageUrl || '' },
          { upsert: true }
        );
      } catch (lvlSyncErr: any) {
        console.warn('[createStoreItem] Level sync notice:', lvlSyncErr.message);
      }
    }

    return sendResponse(res, 201, true, 'Store item created successfully', newItem);
  } catch (error: any) {
    console.error('createStoreItem error:', error);
    return sendResponse(res, 500, false, error.message || 'Failed to create store item');
  }
};

export const updateStoreItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    if (updateData.price !== undefined) {
      updateData.price = Number(updateData.price);
    }
    if (updateData.priceOptions !== undefined || updateData.price !== undefined) {
      updateData.priceOptions = normalizePriceOptions(updateData.priceOptions, updateData.price || 0);
      const thirtyDayPrice = updateData.priceOptions.find((option: any) => option.days === 30)?.diamonds;
      if (thirtyDayPrice !== undefined) updateData.price = thirtyDayPrice;
    }
    if (updateData.sortOrder !== undefined) {
      updateData.sortOrder = Number(updateData.sortOrder);
    }

    const updated = await StoreItem.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
    if (!updated) {
      return sendResponse(res, 404, false, 'Store item not found');
    }

    return sendResponse(res, 200, true, 'Store item updated successfully', updated);
  } catch (error: any) {
    console.error('updateStoreItem error:', error);
    return sendResponse(res, 500, false, error.message || 'Failed to update store item');
  }
};

export const deleteStoreItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const deleted = await StoreItem.findByIdAndDelete(id);
    if (!deleted) {
      return sendResponse(res, 404, false, 'Store item not found');
    }
    return sendResponse(res, 200, true, 'Store item deleted successfully', { id });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to delete store item');
  }
};

export const toggleStoreItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const item = await StoreItem.findById(id);
    if (!item) {
      return sendResponse(res, 404, false, 'Store item not found');
    }
    item.isActive = !item.isActive;
    await item.save();

    return sendResponse(res, 200, true, `Store item ${item.isActive ? 'activated' : 'deactivated'}`, item);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to toggle item state');
  }
};

export const resetStoreCatalog = async (req: Request, res: Response) => {
  try {
    await StoreItem.deleteMany({});
    const inserted = await StoreItem.insertMany(DEFAULT_SEED_ITEMS);
    return sendResponse(res, 200, true, 'Store catalog reset and re-seeded successfully', { count: inserted.length });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to reset store catalog');
  }
};

// Purchase endpoint for mobile app users (/api/user/buy-store-item)
export const buyStoreItem = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    const { itemId } = req.body;
    const durationDays = Number(req.body.durationDays || 30);

    if (!userId) {
      return sendResponse(res, 401, false, 'Unauthorized');
    }

    if (!itemId) {
      return sendResponse(res, 400, false, 'Store item is required');
    }

    if (!STORE_DURATIONS.includes(durationDays as any)) {
      return sendResponse(res, 400, false, 'Duration must be 3, 7, 15, or 30 days');
    }

    const user = await User.findById(userId).select('diamonds');
    if (!user) {
      return sendResponse(res, 404, false, 'User not found');
    }

    const item: any = await StoreItem.findOne({ _id: itemId, isActive: true });
    if (!item) {
      return sendResponse(res, 404, false, 'Store item is unavailable');
    }

    const selectedOption = normalizePriceOptions(item.priceOptions, item.price)
      .find((option) => option.days === durationDays);
    const costInDiamonds = selectedOption?.diamonds ?? item.price;
    const userDiamonds = user.diamonds || 0;

    if (userDiamonds < costInDiamonds) {
      return sendResponse(res, 400, false, `Insufficient diamonds. Required: ${costInDiamonds}, Available: ${userDiamonds}`);
    }

    const purchasedAt = new Date();
    const expiresAt = new Date(purchasedAt.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const update: any = {
      $inc: { diamonds: -costInDiamonds },
      $push: {
        storeInventory: {
          itemId: item._id,
          name: item.name,
          category: item.category,
          durationDays,
          purchasedAt,
          expiresAt,
          imageUrl: item.imageUrl || '',
          animationUrl: item.animationUrl || '',
          source: 'store',
        },
      },
    };

    if (item.category === 'Unique ID' && item.metadata?.number) {
      update.$set = { specialCode: item.metadata.number };
    }

    const updatedUser = await User.findOneAndUpdate(
      { _id: userId, diamonds: { $gte: costInDiamonds } },
      update,
      { new: true }
    ).select('diamonds storeInventory');

    if (!updatedUser) {
      return sendResponse(res, 409, false, 'Wallet changed. Please refresh and try again.');
    }

    item.salesCount = (item.salesCount || 0) + 1;
    await item.save();

    return sendResponse(res, 200, true, 'Purchase successful 🎉', {
      remainingDiamonds: updatedUser.diamonds,
      durationDays,
      expiresAt,
      item: serializeStoreItem(item),
    });
  } catch (error: any) {
    console.error('buyStoreItem error:', error);
    return sendResponse(res, 500, false, error.message || 'Failed to process store purchase');
  }
};
