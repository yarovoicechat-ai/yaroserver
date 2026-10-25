import mongoose from 'mongoose';
import { Request, Response } from 'express';
import { StoreItem, IStoreItem, StoreCategory } from '../models/storeItem.model';
import { User } from '../models/user.model';
import sendResponse from '../utils/reponse';
import HostLevel from '../models/hostLevel.model';
import Level from '../models/level.model';
import { EntryEffect } from '../models/entryEffect.model';
import { VipId } from '../models/vipId.model';
import { IdentityEntitlement } from '../models/identityEntitlement.model';
import { IdentityEffect } from '../models/identityEffect.model';
import { AuditLog } from '../models/auditLog.model';
import { AuthRequest } from '../middlewares/authorize.middleware';
import { createNotification } from './notificationController';
import { recalculateAndUpdateHostLevel } from '../services/user.service';
import { LevelService } from '../services/level.service';
import {
  WEALTH_THRESHOLDS,
  CHARM_THRESHOLDS,
  WEALTH_REWARDS,
  CHARM_PACKAGES,
  CHARM_MILESTONES,
} from '../services/levelEngine';

const STORE_DURATIONS = [3, 7, 15, 30] as const;

const normalizeUniqueDisplayId = (value: unknown) => String(value || '').trim().toUpperCase();
const uniqueDisplayIdLength = (metadata: any, displayId: string) =>
  Number(metadata?.characterCount || metadata?.idLength || metadata?.digitCount || metadata?.digits || displayId.length);
const isValidUniqueDisplayId = (displayId: string, length: number) =>
  /^[A-Z0-9]{3,12}$/.test(displayId) && Number.isInteger(length) && length === displayId.length;

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

export const generateNextAssetUniqueId = async (): Promise<string> => {
  const items = await StoreItem.find({ uniqueId: { $exists: true, $ne: '' } })
    .select('uniqueId')
    .lean();
  let maxId = 500;
  for (const it of items) {
    const num = parseInt(String(it.uniqueId), 10);
    if (!isNaN(num) && num > maxId) {
      maxId = num;
    }
  }
  return String(maxId + 1);
};

export const backfillStoreItemUniqueIds = async (): Promise<void> => {
  try {
    const itemsWithoutId = await StoreItem.find({
      $or: [{ uniqueId: { $exists: false } }, { uniqueId: '' }, { uniqueId: null }]
    }).sort({ createdAt: 1 });

    if (itemsWithoutId.length === 0) return;

    let nextId = 1001;
    const existingWithId = await StoreItem.find({ uniqueId: { $exists: true, $ne: '' } }).select('uniqueId').lean();
    for (const it of existingWithId) {
      const num = parseInt(String(it.uniqueId), 10);
      if (!isNaN(num) && num >= nextId) nextId = num + 1;
    }

    for (const item of itemsWithoutId) {
      item.uniqueId = String(nextId++);
      await item.save();
    }
  } catch (err: any) {
    console.warn('backfillStoreItemUniqueIds warning:', err.message);
  }
};

const serializeStoreItem = (item: any) => {
  const plain = typeof item?.toObject === 'function' ? item.toObject() : item;
  const metadata = plain?.metadata || {};
  return {
    ...plain,
    id: String(plain?._id || plain?.id || ''),
    uniqueId: plain?.uniqueId || metadata.uniqueId || String(plain?._id || '').slice(-6).toUpperCase(),
    audience: plain?.audience || 'general',
    isStaffOnly: Boolean(plain?.isStaffOnly || plain?.audience === 'employee'),
    priceOptions: normalizePriceOptions(plain?.priceOptions, plain?.price),
    number: metadata.number,
    digits: metadata.digits,
    tag: metadata.tag || plain?.badgeText,
    banner: metadata.banner,
    benefits: Array.isArray(metadata.benefits) ? metadata.benefits : [],
  };
};

const normalizeStoreCategory = (value: string = '') => {
  const category = value.trim().toLowerCase();
  if (['frame', 'frames'].includes(category)) return 'Frames';
  if (['entry', 'entry effect', 'entry effects'].includes(category)) return 'Entry';
  if (['tassel', 'tassels'].includes(category)) return 'Tassel';
  if (['entrance', 'ride', 'profile entry', 'profile entries'].includes(category)) return 'Entrance';
  if (['chat bubble', 'chat bubbles'].includes(category)) return 'Chat Bubble';
  if (['mic wave', 'mic waves'].includes(category)) return 'Mic Wave';
  if (['theme', 'themes'].includes(category)) return 'Theme';
  if (['seat skin', 'seat skins'].includes(category)) return 'Seat Skin';
  if (['vip', 'king of kings'].includes(category)) return 'VIP';
  if (['badge', 'tag'].includes(category)) return 'Badge';
  return value.trim();
};

const toCatalogSlug = (value: string = '') =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `vip-${Date.now().toString(36)}`;

const syncStoreVipPackage = async (item: any) => {
  if (!item || !['VIP', 'King of Kings'].includes(String(item.category || ''))) return null;

  const metadata = item.metadata || {};
  const isKingOfKings = item.category === 'King of Kings' || metadata.isKingOfKings === true;
  const slug = String(metadata.vipSlug || toCatalogSlug(item.name));
  const bgColors = Array.isArray(item.bgColors) && item.bgColors.length
    ? item.bgColors
    : [item.previewColor || '#F59E0B', '#7C2D12'];
  const entryTag = metadata.entryTag || metadata.banner || item.badgeText ||
    (isKingOfKings ? 'KING OF KINGS HAS ENTERED' : 'VIP HAS ENTERED');

  const vip = await VipId.findOneAndUpdate(
    { slug },
    {
      $set: {
        name: item.name,
        slug,
        displayName: metadata.displayName || item.name,
        vipLevel: Math.max(1, Number(metadata.vipLevel || metadata.tierLevel || (isKingOfKings ? 10 : 1))),
        rarity: metadata.rarity || (isKingOfKings ? 'mythic' : 'epic'),
        price: Math.max(0, Number(item.price || 0)),
        badge: item.badgeText || metadata.badge || (isKingOfKings ? 'KING OF KINGS' : 'VIP'),
        crown: metadata.crown || (isKingOfKings ? 'KING' : 'VIP'),
        icon: item.icon || 'crown',
        entryTag,
        entryFrame: item.animationUrl || item.imageUrl || metadata.entryFrame || '',
        avatarFrame: metadata.avatarFrame || item.imageUrl || '',
        floatingEntryAnimation: metadata.floatingEntryAnimation || 'FULL_SCREEN',
        micWave: metadata.micWave || {
          waveColor: item.previewColor || '#F59E0B',
          waveColors: bgColors,
          waveIntensity: isKingOfKings ? 1.5 : 1.1,
          waveSpeed: 1,
          waveStyle: isKingOfKings ? 'fire' : 'rings',
        },
        chatBubble: metadata.chatBubble || {
          bubbleName: `${item.name} Bubble`,
          bgGradient: bgColors,
          bgColor: bgColors[0],
          textColor: '#FFFFFF',
          borderColor: item.previewColor || '#F59E0B',
          borderRadius: 16,
          shadowColor: item.previewColor || '#F59E0B',
          bubbleStyle: isKingOfKings ? 'sovereign' : 'vip',
        },
        roomTheme: metadata.roomTheme || {
          themeName: `${item.name} Room`,
          bgUrl: metadata.roomThemeUrl || item.imageUrl || '',
          overlayGradient: bgColors.map((color: string) => `${color}DD`),
          overlayOpacity: 0.85,
          particleType: isKingOfKings ? 'gold_sparkles' : 'stars',
        },
        nameEffect: metadata.nameEffect || {
          gradient: bgColors,
          glowColor: item.previewColor || '#F59E0B',
          isAnimated: true,
          prefixBadge: isKingOfKings ? 'KING' : 'VIP',
        },
        entrySound: metadata.entrySound || '',
        particleEffect: metadata.particleEffect || (isKingOfKings ? 'gold_particles' : 'vip_particles'),
        isVip: true,
        isSvip: Boolean(metadata.isSvip),
        isKing: Boolean(isKingOfKings || metadata.isKing),
        isKingOfKings,
        isLimited: Boolean(metadata.isLimited),
        isActive: item.isActive !== false,
        sortOrder: Number(item.sortOrder || 0),
        metadata: { ...metadata, storeItemId: String(item._id) },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (metadata.vipSlug !== slug) {
    await StoreItem.updateOne(
      { _id: item._id },
      { $set: { 'metadata.vipSlug': slug, 'metadata.isKingOfKings': isKingOfKings } },
    );
  }
  return vip;
};

const buildCanonicalAsset = (item: any, expiresAt?: Date | null) => {
  const plain = typeof item?.toObject === 'function' ? item.toObject() : item;
  const metadata = plain?.metadata || {};
  const img = plain?.imageUrl || plain?.image || '';
  const anim = plain?.animationUrl || (/\.(svga|gif|webp|mp4)/i.test(img) ? img : '');
  return {
    id: String(plain?._id || plain?.id || ''),
    itemId: String(plain?._id || plain?.id || ''),
    name: plain?.name || '',
    category: plain?.category || '',
    imageUrl: img,
    image: img,
    animationUrl: anim,
    previewColor: plain?.previewColor || metadata.previewColor || '',
    bgColors: plain?.bgColors || metadata.bgColors || [],
    icon: plain?.icon || metadata.icon || '',
    textColor: metadata.textColor || '',
    borderColor: metadata.borderColor || '',
    bgColor: metadata.bgColor || '',
    seatSkinType: metadata.seatSkinType || '',
    tag: metadata.tag || plain?.badgeText || '',
    tagText: metadata.tagText || metadata.tag || plain?.badgeText || '',
    bannerColors: metadata.bannerColors || plain?.bgColors || [],
    metadata,
    expiresAt: expiresAt || null,
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

  // 6.1 HD SEAT SKINS (5 HD skins + 1 Default skin)
  {
    name: 'Golden Orb VIP Seat',
    category: 'Seat Skin',
    price: 0,
    validity: 'Permanent',
    badgeText: 'DEFAULT',
    previewColor: '#F59E0B',
    bgColors: ['#78350F', '#B45309', '#F59E0B'],
    icon: 'chair-rolling',
    imageUrl: '/uploads/seats/default_seat.png',
    desc: 'Royal Golden Armchair inside glowing crystal orb with golden reflections.',
    metadata: {
      seatSkinType: 'default',
      isFree: true,
      themeLocation: 'BOTH',
      seatSkinLocation: 'BOTH',
      borderColor: 'rgba(245, 158, 11, 0.85)',
      bgColor: 'rgba(245, 158, 11, 0.20)',
      ringColors: ['#F59E0B', '#FBBF24'],
    },
    sortOrder: 54,
    isActive: true,
  },
  {
    name: 'Imperial Gold Throne',
    category: 'Seat Skin',
    price: 6000,
    validity: '30 Days',
    badgeText: 'HOT',
    previewColor: '#F59E0B',
    bgColors: ['#78350F', '#B45309', '#F59E0B'],
    icon: 'crown',
    imageUrl: '/uploads/seats/golden_throne.jpg',
    desc: 'Majestic 24k golden throne with carved royal lions, floating crown, and ruby velvet.',
    metadata: {
      seatSkinType: 'golden_throne',
      borderColor: 'rgba(245, 158, 11, 0.85)',
      bgColor: 'rgba(245, 158, 11, 0.22)',
      ringColors: ['#F59E0B', '#FBBF24'],
    },
    sortOrder: 55,
    isActive: true,
  },
  {
    name: 'Cyber Neon Pod',
    category: 'Seat Skin',
    price: 5500,
    validity: '30 Days',
    badgeText: 'NEW',
    previewColor: '#06B6D4',
    bgColors: ['#083344', '#06B6D4', '#22D3EE'],
    icon: 'lightning-bolt',
    imageUrl: '/uploads/seats/cyber_pod.jpg',
    desc: 'Futuristic floating neon gaming pod with interactive soundwave visualization rings.',
    metadata: {
      seatSkinType: 'cyber_pod',
      borderColor: 'rgba(6, 182, 212, 0.85)',
      bgColor: 'rgba(6, 182, 212, 0.22)',
      ringColors: ['#06B6D4', '#22D3EE'],
    },
    sortOrder: 56,
    isActive: true,
  },
  {
    name: 'Emerald Lotus Throne',
    category: 'Seat Skin',
    price: 5000,
    validity: '30 Days',
    badgeText: 'LIMITED',
    previewColor: '#10B981',
    bgColors: ['#064E3B', '#059669', '#10B981'],
    icon: 'flower',
    imageUrl: '/uploads/seats/lotus_throne.jpg',
    desc: 'Ethereal glowing jade crystal lotus blossom throne with celestial runes.',
    metadata: {
      seatSkinType: 'lotus_throne',
      borderColor: 'rgba(16, 185, 129, 0.85)',
      bgColor: 'rgba(16, 185, 129, 0.22)',
      ringColors: ['#10B981', '#34D399'],
    },
    sortOrder: 57,
    isActive: true,
  },
  {
    name: 'Phoenix Dragon Throne',
    category: 'Seat Skin',
    price: 7500,
    validity: '30 Days',
    badgeText: 'EXCLUSIVE',
    previewColor: '#EF4444',
    bgColors: ['#7F1D1D', '#DC2626', '#F59E0B'],
    icon: 'fire',
    imageUrl: '/uploads/seats/phoenix_fire.jpg',
    desc: 'Legendary sovereign throne sculpted with fiery dragon wings and blazing phoenix flames.',
    metadata: {
      seatSkinType: 'phoenix_fire',
      borderColor: 'rgba(239, 68, 68, 0.85)',
      bgColor: 'rgba(239, 68, 68, 0.22)',
      ringColors: ['#EF4444', '#F59E0B'],
    },
    sortOrder: 58,
    isActive: true,
  },
  {
    name: 'Mermaid Pearl Seashell',
    category: 'Seat Skin',
    price: 5800,
    validity: '30 Days',
    badgeText: 'RARE',
    previewColor: '#38BDF8',
    bgColors: ['#0C4A6E', '#0284C7', '#38BDF8'],
    icon: 'water',
    imageUrl: '/uploads/seats/mermaid_pearl.jpg',
    desc: 'Oceanic pearl oyster seashell throne with aquamarine water crystals and golden coral.',
    metadata: {
      seatSkinType: 'mermaid_pearl',
      borderColor: 'rgba(56, 189, 248, 0.85)',
      bgColor: 'rgba(56, 189, 248, 0.22)',
      ringColors: ['#38BDF8', '#818CF8'],
    },
    sortOrder: 59,
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

export const getStoreItems = async (req: Request & { user?: { role?: string } }, res: Response) => {
  try {
    const { category, search, activeOnly, includeStaff } = req.query;
    const canIncludeStaff = includeStaff === 'true' && ['owner', 'superAdmin', 'admin', 'operator'].includes(String(req.user?.role || ''));

    // Auto-seeding disabled: Only display items actively managed/uploaded via Admin Panel

    // StoreItem is the source of truth for app catalog pricing. Level records
    // describe progression and must not create fixed-price store listings.

    const filter: any = {};
    if (!canIncludeStaff) {
      filter.$and = [...(filter.$and || []), { $nor: [{ isStaffOnly: true }, { audience: 'employee' }] }];
    }
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

    if (String(category || '') === 'Unique ID') {
      filter.$and = [...(filter.$and || []), { $or: [{ 'metadata.location': 'store' }, { 'metadata.location': { $exists: false } }] }];
    } else if (!category || category === 'All') {
      filter.$and = [...(filter.$and || []), { $or: [{ category: { $ne: 'Unique ID' } }, { category: 'Unique ID', 'metadata.location': 'store' }, { category: 'Unique ID', 'metadata.location': { $exists: false } }] }];
    }

    
    // Exclude dummy seed assets - only real items uploaded/created from panel are served
    const DUMMY_NAMES = [
      '88888 (Fortune Gold)',
      '99999 (Crown Emperor)',
      '77777 (Jackpot Lucky)',
      '1314520 (Forever Romance)',
      '666666 (Smooth Victory)',
      'Golden Royal Bubble',
      'Cyberpunk Glow Bubble',
      'Sakura Romance Bubble',
      'Galaxy Nebula Bubble',
      'Golden Pulse Wave',
      'Cyber Neon Wave',
      'Heartbeat Crimson Wave',
      'Solar Flare Wave',
      'Royal Phantom Rolls',
      'Golden Dragon Descent',
      'Cyber Hypercar',
      'Golden Orb VIP Seat',
      'Imperial Gold Throne',
      'Cyber Neon Pod',
      'Emerald Lotus Throne',
      'Phoenix Dragon Throne',
      'Mermaid Pearl Seashell',
      'Golden Peacock Tassel',
      'Imperial Jade Tassel',
      'VIP Bronze (30 Days)',
      'VIP Silver (30 Days)',
      'SVIP Sovereign (90 Days)'
    ];
    filter.name = { $nin: DUMMY_NAMES };
    filter.imageUrl = { $not: /^\/uploads\/seats\// };

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

export const getUniqueIdItemsAdmin = async (_req: Request, res: Response) => {
  try {
    const records = await StoreItem.find({ category: 'Unique ID' }).sort({ createdAt: -1 }).lean();
    const items = records.map((item: any) => serializeStoreItem(item));
    return sendResponse(res, 200, true, 'Unique ID catalog retrieved successfully', { items, total: items.length });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch Unique ID catalog');
  }
};

export const getStoreItemById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const item = await StoreItem.findById(id);
    if (!item) {
      return sendResponse(res, 404, false, 'Store item not found');
    }
    if ((item.isStaffOnly || item.audience === 'employee') && !['owner', 'superAdmin', 'admin', 'operator'].includes(String((req as any).user?.role || ''))) {
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
    const user = await User.findById(req.user?.id).select('userId storeInventory');
    if (!user) return sendResponse(res, 404, false, 'User not found');
    const now = Date.now();
    const activeUniqueId = await IdentityEntitlement.findOne({
      userId: user.userId,
      type: 'custom_display_id',
      status: 'active',
      startsAt: { $lte: new Date(now) },
      expiresAt: { $gt: new Date(now) },
    }).lean();
    const activeInventory: any[] = (user.storeInventory || [])
      .filter((item) => !item.expiresAt || new Date(item.expiresAt).getTime() > now)
      .sort((a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime());
    const catalogIds = activeInventory.map((item) => item.itemId).filter(Boolean);
    const catalogItems: any[] = await StoreItem.find({
      _id: { $in: catalogIds },
      isActive: true,
    }).lean();
    const catalogById = new Map(
      catalogItems.map((item) => [String(item._id), serializeStoreItem(item)]),
    );
    const items = activeInventory.map((inventoryItem: any) => {
      const plain =
        typeof inventoryItem?.toObject === 'function'
          ? inventoryItem.toObject()
          : inventoryItem;
      const catalogItem = catalogById.get(String(plain.itemId)) || null;
      return {
        ...plain,
        itemId: String(plain.itemId || ''),
        catalogItem,
        ...(catalogItem
          ? {
              imageUrl: catalogItem.imageUrl || plain.imageUrl || '',
              animationUrl: catalogItem.animationUrl || plain.animationUrl || '',
              previewColor: catalogItem.previewColor,
              bgColors: catalogItem.bgColors,
              icon: catalogItem.icon,
              metadata: catalogItem.metadata || plain.metadata || {},
            }
          : { metadata: plain.metadata || {} }),
        isEquippedUniqueId: Boolean(
          activeUniqueId &&
          normalizeUniqueDisplayId(plain.metadata?.uniqueDisplayId || plain.metadata?.displayId || plain.metadata?.number) ===
            normalizeUniqueDisplayId(activeUniqueId.config?.displayId),
        ),
      };
    });
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


    const wealthLevels = WEALTH_THRESHOLDS.map((wt) => {
      const rewards = WEALTH_REWARDS.filter((r) => r.requiredLevel === wt.level).map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        category: r.categoryName,
        durationDays: r.durationDays,
        previewColor: r.previewColor,
      }));
      return {
        _id: `wealth_${wt.level}`,
        level: wt.level,
        name: wt.title,
        tier: wt.tier,
        type: 'wealth',
        category: 'Wealth Level',
        coinsRequired: wt.requiredExp,
        expRequired: wt.requiredExp,
        badge: wt.badgeIcon,
        rewards: rewards.length > 0 ? rewards : [{ name: `Wealth Lv.${wt.level} Badge`, type: 'badge' }],
      };
    });

    const charmLevels = CHARM_THRESHOLDS.map((ct) => {
      const pkg = CHARM_PACKAGES[ct.level] || [];
      const rewards = pkg.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        category: r.categoryName,
        durationDays: r.durationDays,
        previewColor: r.previewColor,
      }));
      return {
        _id: `charm_${ct.level}`,
        level: ct.level,
        name: ct.title,
        tier: ct.tier,
        type: 'charm',
        category: 'Charm Level',
        expRequired: ct.requiredExp,
        coinsRequired: ct.requiredExp,
        badge: ct.badgeIcon,
        rewards: rewards.length > 0 ? rewards : [{ name: `Charm Lv.${ct.level} Badge`, type: 'badge' }],
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
      uniqueId,
      audience = 'general',
      isStaffOnly = false,
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

    // Process unique ID: if provided, validate uniqueness; else auto-generate
    let finalUniqueId = String(uniqueId || '').trim();
    if (finalUniqueId) {
      const existing = await StoreItem.findOne({ uniqueId: finalUniqueId });
      if (existing) {
        return sendResponse(res, 400, false, `Unique Asset ID "${finalUniqueId}" is already assigned to "${existing.name}". Please choose another ID.`);
      }
    } else {
      finalUniqueId = await generateNextAssetUniqueId();
    }

    // Set employee/staff flag
    if (audience === 'employee' || isStaffOnly === true) {
      audience = 'employee';
      isStaffOnly = true;
    }

    // Normalize category
    if (category === 'Frame') category = 'Frames';
    if (category === 'Entry Effect' || category === 'Entry Effects') category = 'Entry';

    if (category === 'Unique ID') {
      const uniqueMetadata = metadata && typeof metadata === 'object' ? metadata : {};
      const displayId = normalizeUniqueDisplayId(uniqueMetadata.uniqueDisplayId || uniqueMetadata.displayId || uniqueMetadata.number);
      const idLength = uniqueDisplayIdLength(uniqueMetadata, displayId);
      const location = String(uniqueMetadata.location || 'store');
      if (!isValidUniqueDisplayId(displayId, idLength)) {
        return sendResponse(res, 400, false, 'Unique ID must contain exactly the configured number of letters or numbers (3-12)');
      }
      if (!['store', 'level', 'event'].includes(location)) return sendResponse(res, 400, false, 'Unique ID location must be Store, Level, or Event');
      if (location === 'event' && !uniqueMetadata.eventId) return sendResponse(res, 400, false, 'Choose an event for this Unique ID');
      if (location === 'level' && (!['wealth', 'charm'].includes(String(uniqueMetadata.progressionType)) || !Number.isInteger(Number(uniqueMetadata.requiredLevel)) || Number(uniqueMetadata.requiredLevel) < 1)) {
        return sendResponse(res, 400, false, 'Choose Wealth or Charm and a valid reward level');
      }
      const duplicatePattern = new RegExp(`^${displayId}$`, 'i');
      const duplicate = await StoreItem.findOne({ category: 'Unique ID', $or: [
        { 'metadata.number': duplicatePattern },
        { 'metadata.displayId': duplicatePattern },
        { 'metadata.uniqueDisplayId': duplicatePattern },
      ] }).lean();
      if (duplicate) return sendResponse(res, 409, false, `Unique ID ${displayId} has already been created`);
      if (/^\d+$/.test(displayId) && await User.exists({ userId: Number(displayId) })) {
        return sendResponse(res, 409, false, `Unique ID ${displayId} conflicts with a permanent user ID`);
      }
      const uniqueLevel = await IdentityEffect.findOne({ _id: uniqueMetadata.uniqueIdLevelId, category: 'unique_badge', status: 'active' }).lean();
      if (!uniqueLevel?.config?.badgeIconUrl) return sendResponse(res, 400, false, 'Choose an active Unique ID level with a badge');
      metadata = {
        ...uniqueMetadata,
        number: displayId,
        displayId,
        uniqueDisplayId: displayId,
        idLength,
        characterCount: idLength,
        digitCount: idLength,
        digits: idLength,
        uniqueIdLevelId: String(uniqueLevel._id),
        levelNumber: Number(uniqueLevel.config.levelNumber || uniqueLevel.config.vipLevel || 1),
        levelName: uniqueLevel.name,
        badgeName: uniqueLevel.config.badgeName || 'VIP ID',
        badgeIconUrl: uniqueLevel.config.badgeIconUrl,
        badgeAnimationType: uniqueLevel.config.animationType || 'svga',
      };
      imageUrl = uniqueLevel.config.badgeIconUrl;
      animationUrl = uniqueLevel.config.badgeIconUrl;
      if (location !== 'store') price = 0;
    }

    const normalizedPrices = normalizePriceOptions(priceOptions, Number(price) || 0);
    const thirtyDayPrice = normalizedPrices.find((option) => option.days === 30)?.diamonds ?? Number(price) ?? 0;

    const newItem = await StoreItem.create({
      uniqueId: finalUniqueId,
      audience,
      isStaffOnly,
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
          {
            name: name.trim(), text: name.trim(), level: frameLvl, image: imageUrl || '',
            audience: isStaffOnly ? 'employee' : audience,
            isStaffOnly: Boolean(isStaffOnly || audience === 'employee'),
          },
          { upsert: true }
        );
      } catch (lvlSyncErr: any) {
        console.warn('[createStoreItem] Level sync notice:', lvlSyncErr.message);
      }
    }

    if (category === 'VIP' || category === 'King of Kings') {
      await syncStoreVipPackage(newItem);
    }

    return sendResponse(res, 201, true, 'Store item created successfully', serializeStoreItem(newItem));
  } catch (error: any) {
    console.error('createStoreItem error:', error);
    return sendResponse(res, 500, false, error.message || 'Failed to create store item');
  }
};

export const updateStoreItem = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    const existingItem: any = await StoreItem.findById(id).lean();
    if (!existingItem) return sendResponse(res, 404, false, 'Store item not found');
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

    if (updateData.uniqueId) {
      updateData.uniqueId = String(updateData.uniqueId).trim();
      const existing = await StoreItem.findOne({ uniqueId: updateData.uniqueId, _id: { $ne: id } });
      if (existing) {
        return sendResponse(res, 400, false, `Unique ID "${updateData.uniqueId}" is already used by another item.`);
      }
    }

    if ((updateData.category || existingItem.category) === 'Unique ID') {
      const uniqueMetadata = { ...(existingItem.metadata || {}), ...(updateData.metadata || {}) };
      const displayId = normalizeUniqueDisplayId(uniqueMetadata.uniqueDisplayId || uniqueMetadata.displayId || uniqueMetadata.number);
      const idLength = uniqueDisplayIdLength(uniqueMetadata, displayId);
      const location = String(uniqueMetadata.location || 'store');
      if (!isValidUniqueDisplayId(displayId, idLength)) {
        return sendResponse(res, 400, false, 'Unique ID must contain exactly the configured number of letters or numbers (3-12)');
      }
      if (!['store', 'level', 'event'].includes(location)) return sendResponse(res, 400, false, 'Unique ID location must be Store, Level, or Event');
      if (location === 'event' && !uniqueMetadata.eventId) return sendResponse(res, 400, false, 'Choose an event for this Unique ID');
      if (location === 'level' && (!['wealth', 'charm'].includes(String(uniqueMetadata.progressionType)) || !Number.isInteger(Number(uniqueMetadata.requiredLevel)) || Number(uniqueMetadata.requiredLevel) < 1)) {
        return sendResponse(res, 400, false, 'Choose Wealth or Charm and a valid reward level');
      }
      const duplicatePattern = new RegExp(`^${displayId}$`, 'i');
      const duplicate = await StoreItem.findOne({ category: 'Unique ID', _id: { $ne: id }, $or: [
        { 'metadata.number': duplicatePattern },
        { 'metadata.displayId': duplicatePattern },
        { 'metadata.uniqueDisplayId': duplicatePattern },
      ] }).lean();
      if (duplicate) return sendResponse(res, 409, false, `Unique ID ${displayId} has already been created`);
      if (/^\d+$/.test(displayId) && await User.exists({ userId: Number(displayId) })) {
        return sendResponse(res, 409, false, `Unique ID ${displayId} conflicts with a permanent user ID`);
      }
      const uniqueLevel = await IdentityEffect.findOne({ _id: uniqueMetadata.uniqueIdLevelId, category: 'unique_badge', status: 'active' }).lean();
      if (!uniqueLevel?.config?.badgeIconUrl) return sendResponse(res, 400, false, 'Choose an active Unique ID level with a badge');
      updateData.category = 'Unique ID';
      updateData.metadata = {
        ...uniqueMetadata,
        number: displayId,
        displayId,
        uniqueDisplayId: displayId,
        idLength,
        characterCount: idLength,
        digitCount: idLength,
        digits: idLength,
        uniqueIdLevelId: String(uniqueLevel._id),
        levelNumber: Number(uniqueLevel.config.levelNumber || uniqueLevel.config.vipLevel || 1),
        levelName: uniqueLevel.name,
        badgeName: uniqueLevel.config.badgeName || 'VIP ID',
        badgeIconUrl: uniqueLevel.config.badgeIconUrl,
        badgeAnimationType: uniqueLevel.config.animationType || 'svga',
      };
      updateData.imageUrl = uniqueLevel.config.badgeIconUrl;
      updateData.animationUrl = uniqueLevel.config.badgeIconUrl;
      if (location !== 'store') updateData.price = 0;
    }

    if (updateData.audience === 'employee' || updateData.isStaffOnly === true) {
      updateData.audience = 'employee';
      updateData.isStaffOnly = true;
    }

    const updated = await StoreItem.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
    if (!updated) {
      return sendResponse(res, 404, false, 'Store item not found');
    }

    if ((updated.category === 'Frames' || updated.category === 'Frame') && (updated as any).metadata?.frameLevel) {
      const staffOnly = Boolean((updated as any).isStaffOnly || (updated as any).audience === 'employee');
      await Level.updateOne(
        { level: Number((updated as any).metadata.frameLevel) || 1 },
        { $set: { isStaffOnly: staffOnly, audience: staffOnly ? 'employee' : ((updated as any).audience || 'general') } },
      ).catch((error: any) => console.warn('[updateStoreItem] Frame audience sync notice:', error.message));
    }

    if (updated.category === 'VIP' || updated.category === 'King of Kings') {
      await syncStoreVipPackage(updated);
    }

    return sendResponse(res, 200, true, 'Store item updated successfully', serializeStoreItem(updated));
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
    if (deleted.category === 'VIP' || deleted.category === 'King of Kings') {
      const vipSlug = String((deleted as any).metadata?.vipSlug || toCatalogSlug(deleted.name));
      await VipId.updateOne({ slug: vipSlug }, { $set: { isActive: false } });
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

export const getKingMembers = async (_req: Request, res: Response) => {
  try {
    const kingPackages = await VipId.find({ isKingOfKings: true }).select('slug name').lean();
    const kingSlugs = kingPackages.map((item: any) => item.slug);
    const packageNames = new Map(kingPackages.map((item: any) => [item.slug, item.name]));
    const users: any[] = kingSlugs.length
      ? await User.find({ equippedVipId: { $in: kingSlugs } })
          .select('_id userId name image equippedVipId equippedVipExpiresAt')
          .sort({ equippedVipExpiresAt: -1, updatedAt: -1 })
          .lean()
      : [];
    const now = Date.now();
    const members = users.map((account: any) => {
      const expiresAt = account.equippedVipExpiresAt || null;
      return {
        _id: String(account._id),
        userId: String(account._id),
        userNumericId: String(account.userId || ''),
        userName: account.name || 'User',
        userAvatar: account.image || '',
        packageTier: packageNames.get(account.equippedVipId) || account.equippedVipId,
        packageSlug: account.equippedVipId,
        grantedAt: null,
        expiresAt,
        status: !expiresAt || new Date(expiresAt).getTime() > now ? 'active' : 'expired',
      };
    });
    return sendResponse(res, 200, true, 'King of Kings members fetched', { members });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch King of Kings members');
  }
};

export const grantKingMembership = async (req: Request, res: Response) => {
  try {
    const userNumericId = String(req.body?.userNumericId || '').trim();
    const packageId = String(req.body?.packageId || '').trim();
    const durationDays = Math.max(1, Number(req.body?.durationDays || 30));
    if (!userNumericId || !packageId) {
      return sendResponse(res, 400, false, 'User numeric ID and King package are required');
    }

    const item: any = await StoreItem.findOne({
      _id: packageId,
      category: 'King of Kings',
      isActive: true,
    });
    if (!item) return sendResponse(res, 404, false, 'King of Kings package not found');
    const vipPackage = await syncStoreVipPackage(item);
    if (!vipPackage) return sendResponse(res, 409, false, 'King package could not be activated');

    const numericId = Number(userNumericId);
    const account: any = await User.findOne({
      $or: [
        ...(!Number.isNaN(numericId) ? [{ userId: numericId }] : []),
        { meethiId: userNumericId },
        { specialCode: userNumericId },
      ],
    });
    if (!account) return sendResponse(res, 404, false, 'User account not found');

    const purchasedAt = new Date();
    const expiresAt = new Date(purchasedAt.getTime() + durationDays * 24 * 60 * 60 * 1000);
    account.equippedVipId = vipPackage.slug;
    account.equippedVipExpiresAt = expiresAt;
    account.ownedVipIds = Array.isArray(account.ownedVipIds) ? account.ownedVipIds : [];
    if (!account.ownedVipIds.includes(vipPackage.slug)) account.ownedVipIds.push(vipPackage.slug);
    account.storeInventory.push({
      itemId: item._id,
      name: item.name,
      category: item.category,
      durationDays,
      purchasedAt,
      expiresAt,
      imageUrl: item.imageUrl || '',
      animationUrl: item.animationUrl || '',
      source: 'store',
      grantKey: `admin-king:${Date.now()}`,
    });
    await account.save();

    return sendResponse(res, 200, true, 'King of Kings membership granted', {
      member: {
        _id: String(account._id),
        userId: String(account._id),
        userNumericId: String(account.userId),
        userName: account.name || 'User',
        userAvatar: account.image || '',
        packageTier: item.name,
        packageSlug: vipPackage.slug,
        grantedAt: purchasedAt,
        expiresAt,
        status: 'active',
      },
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to grant King of Kings membership');
  }
};

export const revokeKingMembership = async (req: Request, res: Response) => {
  try {
    const account = await User.findByIdAndUpdate(
      req.params.userId,
      {
        $set: { equippedVipId: null, equippedVipExpiresAt: null },
        $pull: { storeInventory: { category: 'King of Kings' } },
      },
      { new: true },
    );
    if (!account) return sendResponse(res, 404, false, 'King member not found');
    return sendResponse(res, 200, true, 'King of Kings membership revoked', { userId: req.params.userId });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to revoke King of Kings membership');
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

// ==================== ADMIN ASSET DISTRIBUTION & DIRECT GRANT ====================

export const getAssetCatalogAdmin = async (req: Request, res: Response) => {
  try {
    await backfillStoreItemUniqueIds();
    const { category, audience, search } = req.query;
    const filter: any = {};
    if (category && category !== 'All') {
      filter.category = category;
    }
    if (audience && audience !== 'All') {
      filter.audience = audience;
    }
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { uniqueId: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
      ];
    }

    const items = await StoreItem.find(filter).sort({ sortOrder: 1, createdAt: -1 }).lean();
    return sendResponse(res, 200, true, 'Asset catalog fetched', {
      assets: items.map(serializeStoreItem),
      total: items.length,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch asset catalog');
  }
};

export const getUserLookupAdmin = async (req: Request, res: Response) => {
  try {
    const { query } = req.query;
    const q = String(query || '').trim();
    if (!q) {
      return sendResponse(res, 200, true, 'User lookup', { users: [] });
    }

    const num = Number(q);
    const conditions: any[] = [
      { name: { $regex: q, $options: 'i' } },
      { phoneNumber: { $regex: q, $options: 'i' } },
      { meethiId: q },
      { specialCode: q },
    ];
    if (!isNaN(num)) {
      conditions.unshift({ userId: num });
    }
    if (mongoose.Types.ObjectId.isValid(q)) {
      conditions.push({ _id: q });
    }

    const users = await User.find({ $or: conditions })
      .select('_id userId name phoneNumber email image role diamonds coins isBlocked status')
      .limit(10)
      .lean();

    return sendResponse(res, 200, true, 'User lookup', { users });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to lookup user');
  }
};

export const grantAssetToUser = async (req: AuthRequest, res: Response) => {
  try {
    const adminUser = req.user;
    const {
      userQuery,
      assetQuery,
      durationDays = 30,
      message = '',
      autoEquip = true,
      audience = 'general',
    } = req.body;

    if (!userQuery) {
      return sendResponse(res, 400, false, 'User identifier (User ID / Phone / Email) is required');
    }
    if (!assetQuery) {
      return sendResponse(res, 400, false, 'Asset identifier (Unique ID / Asset Name) is required');
    }

    // 1. Find target user
    const numericUserId = Number(userQuery);
    const userSearchConditions: any[] = [];
    if (!isNaN(numericUserId)) {
      userSearchConditions.push({ userId: numericUserId });
    }
    userSearchConditions.push(
      { meethiId: String(userQuery).trim() },
      { specialCode: String(userQuery).trim() },
      { phoneNumber: String(userQuery).trim() },
      { email: String(userQuery).trim().toLowerCase() }
    );
    if (mongoose.Types.ObjectId.isValid(String(userQuery))) {
      userSearchConditions.push({ _id: userQuery });
    }

    const targetUser: any = await User.findOne({ $or: userSearchConditions });
    if (!targetUser) {
      return sendResponse(res, 404, false, `User "${userQuery}" not found`);
    }

    // 2. Find asset in StoreItem (by uniqueId, _id, or exact/fuzzy name)
    const assetSearchConditions: any[] = [
      { uniqueId: String(assetQuery).trim() },
      { name: new RegExp(`^${String(assetQuery).trim()}$`, 'i') },
    ];
    if (mongoose.Types.ObjectId.isValid(String(assetQuery))) {
      assetSearchConditions.push({ _id: assetQuery });
    }

    let asset: any = await StoreItem.findOne({ $or: assetSearchConditions });

    if (!asset) {
      // Check VipId or EntryEffect
      const vipAsset: any = await VipId.findOne({
        $or: [
          { slug: String(assetQuery).trim().toLowerCase() },
          { name: new RegExp(`^${String(assetQuery).trim()}$`, 'i') },
        ]
      });
      if (vipAsset) {
        asset = await StoreItem.findOne({ name: vipAsset.name });
      }
    }

    if (!asset) {
      return sendResponse(res, 404, false, `Asset "${assetQuery}" not found in Store or Assets catalog`);
    }

    const isUniqueIdGrant = asset.category === 'Unique ID';
    const days = isUniqueIdGrant
      ? Math.max(1, Math.min(730, Number(asset.metadata?.activationDurationDays) || Number(durationDays) || 30))
      : Math.max(0, Number(durationDays) || 0);
    const purchasedAt = new Date();
    // Unique ID validity starts when the user activates it from My Items.
    const expiresAt = !isUniqueIdGrant && days > 0
      ? new Date(purchasedAt.getTime() + days * 24 * 60 * 60 * 1000)
      : null;

    targetUser.storeInventory = Array.isArray(targetUser.storeInventory) ? targetUser.storeInventory : [];

    const inventoryEntry: any = {
      itemId: asset._id,
      name: asset.name,
      category: asset.category,
      durationDays: days,
      purchasedAt,
      expiresAt,
      imageUrl: asset.imageUrl || asset.image || '',
      animationUrl: asset.animationUrl || '',
      metadata: asset.metadata || {},
      source: 'admin_grant',
      grantKey: `admin-grant:${Date.now()}:${adminUser?.id || 'admin'}`,
      uniqueId: asset.uniqueId || '',
      message: message || '',
      grantedBy: adminUser?.id && mongoose.Types.ObjectId.isValid(adminUser.id) ? new mongoose.Types.ObjectId(adminUser.id) : undefined,
    };

    targetUser.storeInventory.push(inventoryEntry);

    // If VIP / SVIP / King of Kings
    if (asset.category === 'VIP' || asset.category === 'King of Kings') {
      const vipPackage = await syncStoreVipPackage(asset);
      if (vipPackage) {
        targetUser.equippedVipId = vipPackage.slug;
        targetUser.equippedVipExpiresAt = expiresAt;
        targetUser.ownedVipIds = Array.isArray(targetUser.ownedVipIds) ? targetUser.ownedVipIds : [];
        if (!targetUser.ownedVipIds.includes(vipPackage.slug)) {
          targetUser.ownedVipIds.push(vipPackage.slug);
        }
      }
    }

    // Auto-equip if requested
    if (autoEquip) {
      const cat = normalizeStoreCategory(asset.category);
      if (cat === 'Frames') {
        targetUser.equippedFrame = asset.name;
        targetUser.equippedFrameAsset = {
          name: asset.name,
          imageUrl: asset.imageUrl || asset.image || '',
          animationUrl: asset.animationUrl || '',
          previewColor: asset.previewColor || '#8B5CF6',
          expiresAt,
        };
      } else if (cat === 'Entrance') {
        targetUser.equippedEntrance = asset.name;
        targetUser.equippedEntranceAsset = buildCanonicalAsset(asset, expiresAt);
      } else if (cat === 'Entry') {
        targetUser.equippedEntry = asset.name;
        targetUser.equippedEntryAsset = {
          name: asset.name,
          imageUrl: asset.imageUrl || asset.image || '',
          animationUrl: asset.animationUrl || '',
          metadata: asset.metadata || {},
          expiresAt,
        };
      } else if (cat === 'Chat Bubble') {
        targetUser.equippedChatBubble = asset.name;
        targetUser.equippedChatBubbleAsset = {
          name: asset.name,
          textColor: asset.metadata?.textColor || '#FEF3C7',
          borderColor: asset.metadata?.borderColor || asset.previewColor || '#F59E0B',
          bgColors: asset.bgColors || ['#78350F', '#B45309', '#D97706'],
          previewColor: asset.previewColor || '#F59E0B',
          imageUrl: asset.imageUrl || asset.image || '',
          expiresAt,
        };
      } else if (cat === 'Badge' || cat === 'Tag') {
        targetUser.equippedBadge = asset.name;
        targetUser.equippedEntryTag = asset.badgeText || asset.name;
      } else if (cat === 'Mic Wave') {
        targetUser.equippedMicWave = asset.name;
      } else if (cat === 'Tassel') {
        targetUser.equippedTassel = asset.name;
        targetUser.equippedTasselAsset = {
          name: asset.name,
          imageUrl: asset.imageUrl || asset.image || '',
          animationUrl: asset.animationUrl || '',
          expiresAt,
        };
      } else if (cat === 'Theme') {
        targetUser.equippedRoomTheme = asset.name;
      }
    }

    await targetUser.save();

    // Send System Message / Notification
    const validityText = isUniqueIdGrant
      ? `${days} Days after activation`
      : days > 0 ? `${days} Days` : 'Permanent Lifetime';
    const notifMessage = message?.trim()
      ? message.trim()
      : `🎁 Congratulations! You have received ${asset.name} (${validityText}) from Admin. Tap View to equip in My Items.`;

    await createNotification(
      String(targetUser._id),
      `🎁 New ${asset.category} Received: ${asset.name}`,
      notifMessage,
      'system',
      {
        action: 'MyItems',
        screen: 'MyItems',
        category: asset.category,
        uniqueId: asset.uniqueId || '',
        assetName: asset.name,
        assetImage: asset.imageUrl || asset.image || '',
        durationDays: days,
        expiresAt,
      }
    );

    // Audit Log
    if (adminUser?.id && mongoose.Types.ObjectId.isValid(adminUser.id)) {
      await AuditLog.create({
        adminId: adminUser.id,
        action: 'GRANT_ASSET',
        target: String(targetUser._id),
        details: `Granted asset "${asset.name}" (Unique ID: ${asset.uniqueId || 'N/A'}, Category: ${asset.category}, Days: ${days}) to user "${targetUser.name}" (${targetUser.userId}). Message: ${message || 'N/A'}`,
        newValue: {
          assetId: asset._id,
          uniqueId: asset.uniqueId,
          assetName: asset.name,
          category: asset.category,
          userId: targetUser._id,
          userNumericId: targetUser.userId,
          userName: targetUser.name,
          durationDays: days,
          expiresAt,
          message: notifMessage,
        },
        ipAddress: req.ip || '127.0.0.1',
      }).catch((err) => console.warn('AuditLog creation notice:', err.message));
    }

    return sendResponse(res, 200, true, `Successfully granted "${asset.name}" to ${targetUser.name}!`, {
      user: {
        _id: targetUser._id,
        userId: targetUser.userId,
        name: targetUser.name,
        image: targetUser.image,
      },
      asset: serializeStoreItem(asset),
      durationDays: days,
      expiresAt,
      message: notifMessage,
    });
  } catch (error: any) {
    console.error('grantAssetToUser error:', error);
    return sendResponse(res, 500, false, error.message || 'Failed to grant asset');
  }
};

export const getAssetGrantHistoryAdmin = async (req: Request, res: Response) => {
  try {
    const logs = await AuditLog.find({ action: 'GRANT_ASSET' })
      .populate('adminId', 'name email userId')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return sendResponse(res, 200, true, 'Grant history fetched', { history: logs });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch grant history');
  }
};

export const revokeGrantedAssetAdmin = async (req: Request, res: Response) => {
  try {
    const { userId, inventoryItemId } = req.params;
    const user: any = await User.findById(userId);
    if (!user) {
      return sendResponse(res, 404, false, 'User not found');
    }

    user.storeInventory = (user.storeInventory || []).filter(
      (entry: any) => String(entry._id) !== inventoryItemId && String(entry.itemId) !== inventoryItemId
    );
    await user.save();

    return sendResponse(res, 200, true, 'Asset grant revoked successfully');
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to revoke granted asset');
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
    if (item.isStaffOnly || item.audience === 'employee') {
      return sendResponse(res, 403, false, 'This frame is reserved for staff and cannot be purchased from the store');
    }
    if (item.category === 'Unique ID' && String(item.metadata?.location || 'store') !== 'store') {
      return sendResponse(res, 403, false, 'This Unique ID is reserved for its Level or Event reward');
    }

    const selectedOption = normalizePriceOptions(item.priceOptions, item.price)
      .find((option) => option.days === durationDays);
    const costInDiamonds = selectedOption?.diamonds ?? item.price;
    const userDiamonds = user.diamonds || 0;

    if (userDiamonds < costInDiamonds) {
      return sendResponse(res, 400, false, `Insufficient diamonds. Required: ${costInDiamonds}, Available: ${userDiamonds}`);
    }

    const purchasedAt = new Date();
    const isUniqueIdItem = item.category === 'Unique ID';
    const isPermanent =
      isUniqueIdItem ||
      item.metadata?.isFree === true ||
      Number(costInDiamonds || 0) === 0 ||
      String(item.validity || '').toLowerCase() === 'permanent';
    const expiresAt = isPermanent
      ? null
      : new Date(purchasedAt.getTime() + durationDays * 24 * 60 * 60 * 1000);
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
          metadata: item.metadata || {},
          source: 'store',
        },
      },
    };

    if (item.category === 'Frames' || item.category === 'Frame') {
      update.$set = {
        ...(update.$set || {}),
        equippedFrame: item.name,
        equippedFrameAsset: {
          name: item.name,
          imageUrl: item.imageUrl || (item as any).image || '',
          animationUrl: item.animationUrl || '',
          expiresAt,
        },
      };
    }

    if (item.category === 'Entry' || item.category === 'Entry Effect' || item.category === 'Entry Effects') {
      update.$set = {
        ...(update.$set || {}),
        equippedEntry: item.name,
        equippedEntryAsset: buildCanonicalAsset(item, expiresAt),
      };
    }

    if (item.category === 'Tassel' || item.category === 'Tassels') {
      update.$set = {
        ...(update.$set || {}),
        equippedTassel: item.name,
        equippedTasselAsset: {
          name: item.name,
          imageUrl: item.imageUrl || (item as any).image || '',
          animationUrl: item.animationUrl || '',
          previewColor: (item as any).previewColor || '#F59E0B',
          tag: item.tag || (item as any).metadata?.tag || 'Mic Tassel Ornament',
          expiresAt,
        },
      };
    }

    if (item.category === 'Entrance' || item.category === 'Ride' || item.category === 'Profile Entry') {
      update.$set = {
        ...(update.$set || {}),
        equippedEntrance: item.name,
        equippedEntranceAsset: buildCanonicalAsset(item, expiresAt),
      };
    }

    if (item.category === 'Chat Bubble' || item.category === 'Chat Bubbles') {
      update.$set = {
        ...(update.$set || {}),
        equippedChatBubble: item.name,
        equippedChatBubbleAsset: {
          name: item.name,
          textColor: (item as any).metadata?.textColor || '#FEF3C7',
          borderColor: (item as any).metadata?.borderColor || item.previewColor || '#F59E0B',
          bgColors: item.bgColors || ['#78350F', '#B45309', '#D97706'],
          previewColor: item.previewColor || '#F59E0B',
          icon: item.icon || 'chatbubble-ellipses',
          imageUrl: item.imageUrl || '',
          expiresAt,
        },
      };
    }

    if (item.category === 'Mic Wave' || item.category === 'Mic Waves') {
      update.$set = {
        ...(update.$set || {}),
        equippedMicWave: item.name,
      };
    }

    if (item.category === 'VIP' || item.category === 'King of Kings') {
      const vipPackage = await syncStoreVipPackage(item);
      if (!vipPackage) {
        return sendResponse(res, 409, false, 'VIP package activation could not be prepared');
      }
      update.$set = {
        ...(update.$set || {}),
        equippedVipId: vipPackage.slug,
        equippedVipExpiresAt: expiresAt,
      };
      update.$addToSet = {
        ...(update.$addToSet || {}),
        ownedVipIds: vipPackage.slug,
      };
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

    // Award Wealth EXP based on diamonds spent
    await LevelService.addWealthExp(
      userId,
      costInDiamonds,
      'store_purchase',
      String(item._id)
    ).catch((err) => console.warn('Failed to add wealth exp for store purchase:', err.message));

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

export const equipStoreItem = async (req: any, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendResponse(res, 401, false, 'Unauthorized');
    }

    const { itemId, name, category, type, equipped = true } = req.body;
    const requestedCategory = normalizeStoreCategory(category || type || '');
    if (!requestedCategory) {
      return sendResponse(res, 400, false, 'Item category is required');
    }

    const update: any = {};
    let uniqueIdActivation: any = null;
    let shouldRevokeUniqueId = false;
    const clearRequested =
      equipped === false ||
      !name ||
      ['default', 'none'].includes(String(name).trim().toLowerCase());

    const clearCategory = () => {
      if (requestedCategory === 'Frames') {
        update.equippedFrame = null;
        update.equippedFrameAsset = null;
      } else if (requestedCategory === 'Entry') {
        update.equippedEntry = null;
        update.equippedEntryAsset = null;
      } else if (requestedCategory === 'Tassel') {
        update.equippedTassel = null;
        update.equippedTasselAsset = null;
      } else if (requestedCategory === 'Entrance') {
        update.equippedEntrance = null;
        update.equippedEntranceAsset = null;
      } else if (requestedCategory === 'Chat Bubble') {
        update.equippedChatBubble = null;
        update.equippedChatBubbleAsset = null;
      } else if (requestedCategory === 'Mic Wave') {
        update.equippedMicWave = null;
      } else if (requestedCategory === 'Theme') {
        update.equippedRoomTheme = null;
      } else if (requestedCategory === 'VIP') {
        update.equippedVipId = null;
      } else if (requestedCategory === 'Badge') {
        update.equippedBadge = null;
      } else if (requestedCategory === 'Vehicle') {
        update.equippedVehicle = null;
        update.equippedVehicleAsset = null;
      } else if (requestedCategory === 'Profile Border') {
        update.equippedProfileBorder = null;
        update.equippedProfileBorderAsset = null;
      } else if (requestedCategory === 'Custom ID' || requestedCategory === 'Unique ID') {
        update.equippedCustomId = null;
        shouldRevokeUniqueId = true;
      }
    };

    if (clearRequested) {
      clearCategory();
    } else {
      const account: any = await User.findById(userId)
        .select('userId storeInventory')
        .lean();
      if (!account) return sendResponse(res, 404, false, 'User not found');

      const now = Date.now();
      const ownedItem = (account.storeInventory || []).find((inventoryItem: any) => {
        const active =
          !inventoryItem.expiresAt ||
          new Date(inventoryItem.expiresAt).getTime() > now;
        const idMatches =
          itemId && String(inventoryItem.itemId) === String(itemId);
        const nameMatches =
          name &&
          String(inventoryItem.name || '').toLowerCase() ===
            String(name).toLowerCase();
        return active && (idMatches || nameMatches);
      });
      if (!ownedItem) {
        return sendResponse(res, 403, false, 'This item is not in your active inventory');
      }

      let catalogItem: any = null;
      if (ownedItem.itemId) {
        catalogItem = await StoreItem.findOne({
          _id: ownedItem.itemId,
          isActive: true,
        }).lean();
      }

      const itemCategory = catalogItem ? catalogItem.category : (ownedItem.category || requestedCategory);
      const actualCategory = normalizeStoreCategory(itemCategory);
      const itemName = catalogItem ? catalogItem.name : ownedItem.name;

      const asset = catalogItem
        ? buildCanonicalAsset(catalogItem, ownedItem.expiresAt)
        : {
            id: String(ownedItem._id || ownedItem.grantKey || itemName),
            name: itemName,
            imageUrl: ownedItem.imageUrl || '',
            animationUrl: ownedItem.animationUrl || '',
            metadata: ownedItem.metadata || {},
            source: ownedItem.source || 'level',
            expiresAt: ownedItem.expiresAt,
          };

      if (actualCategory === 'Unique ID') {
        const metadata = catalogItem?.metadata || ownedItem.metadata || {};
        const displayId = normalizeUniqueDisplayId(metadata.uniqueDisplayId || metadata.displayId || metadata.number);
        const idLength = uniqueDisplayIdLength(metadata, displayId);
        const badgeIconUrl = String(metadata.badgeIconUrl || ownedItem.animationUrl || ownedItem.imageUrl || '').trim();
        if (!isValidUniqueDisplayId(displayId, idLength) || !badgeIconUrl) {
          return sendResponse(res, 409, false, 'This inventory item is missing its configured ID or badge');
        }
        const officialEntitlement = await IdentityEntitlement.findOne({
          userId: account.userId,
          type: 'official_id',
          status: 'active',
          startsAt: { $lte: new Date() },
          expiresAt: { $gt: new Date() },
        }).lean();
        if (officialEntitlement) return sendResponse(res, 409, false, 'Deactivate your Official ID before activating a Unique ID');
        if (/^\d+$/.test(displayId) && await User.exists({ userId: Number(displayId) })) {
          return sendResponse(res, 409, false, `Unique ID ${displayId} conflicts with a permanent user ID`);
        }
        const collision = await IdentityEntitlement.findOne({
          userId: { $ne: account.userId },
          type: { $in: ['official_id', 'custom_display_id'] },
          'config.displayId': new RegExp(`^${displayId}$`, 'i'),
          status: 'active',
          startsAt: { $lte: new Date() },
          expiresAt: { $gt: new Date() },
        }).lean();
        if (collision) return sendResponse(res, 409, false, `Unique ID ${displayId} is already active on another account`);
        const days = Math.max(1, Math.min(730, Number(ownedItem.durationDays || metadata.activationDurationDays) || 30));
        const startsAt = new Date();
        const expiresAt = new Date(startsAt.getTime() + days * 24 * 60 * 60 * 1000);
        const levelNumber = Math.max(1, Number(metadata.levelNumber || 1));
        update.equippedCustomId = displayId;
        uniqueIdActivation = {
          userId: Number(account.userId),
          userObjectId: account._id,
          displayId,
          levelNumber,
          levelId: String(metadata.uniqueIdLevelId || ''),
          badgeName: String(metadata.badgeName || metadata.levelName || 'VIP ID'),
          badgeIconUrl,
          animationType: String(metadata.badgeAnimationType || 'svga'),
          startsAt,
          expiresAt,
          grantSource: ownedItem.source === 'store' ? 'purchase' : ownedItem.source === 'level' ? 'promotional' : 'admin_grant',
        };
      } else if (actualCategory === 'Frames') {
        update.equippedFrame = itemName;
        update.equippedFrameAsset = asset;
      } else if (actualCategory === 'Entry') {
        update.equippedEntry = itemName;
        update.equippedEntryAsset = asset;
      } else if (actualCategory === 'Tassel') {
        update.equippedTassel = itemName;
        update.equippedTasselAsset = asset;
      } else if (actualCategory === 'Entrance') {
        update.equippedEntrance = itemName;
        update.equippedEntranceAsset = asset;
      } else if (actualCategory === 'Chat Bubble') {
        update.equippedChatBubble = itemName;
        update.equippedChatBubbleAsset = asset;
      } else if (actualCategory === 'Mic Wave') {
        update.equippedMicWave = itemName;
      } else if (actualCategory === 'Theme') {
        update.equippedRoomTheme = catalogItem ? String(catalogItem._id) : itemName;
      } else if (actualCategory === 'VIP') {
        update.equippedVipId = catalogItem ? String(catalogItem._id) : itemName;
      } else if (actualCategory === 'Badge') {
        update.equippedBadge = itemName;
        update.equippedBadges = [itemName];
      } else if (actualCategory === 'Vehicle') {
        update.equippedVehicle = itemName;
        update.equippedVehicleAsset = asset;
      } else if (actualCategory === 'Profile Border') {
        update.equippedProfileBorder = itemName;
        update.equippedProfileBorderAsset = asset;
      } else if (actualCategory === 'Custom ID') {
        update.equippedCustomId = itemName;
      } else {
        return sendResponse(res, 400, false, 'This category cannot be equipped');
      }
    }

    const user = await User.findByIdAndUpdate(userId, { $set: update }, { new: true })
      .select('equippedFrame equippedFrameAsset equippedMicWave equippedChatBubble equippedChatBubbleAsset equippedEntry equippedEntryAsset equippedTassel equippedTasselAsset equippedEntrance equippedEntranceAsset equippedVipId equippedSvipId equippedBadge equippedBadges equippedRoomTheme equippedVehicle equippedVehicleAsset equippedCustomId equippedProfileBorder equippedProfileBorderAsset');

    if (!user) {
      return sendResponse(res, 404, false, 'User not found');
    }

    if (uniqueIdActivation) {
      await IdentityEntitlement.updateMany(
        { userId: uniqueIdActivation.userId, type: { $in: ['custom_display_id', 'unique_id_badge'] }, status: 'active' },
        { $set: { status: 'revoked' } },
      );
      const sharedEntitlement = {
        userId: uniqueIdActivation.userId,
        userObjectId: uniqueIdActivation.userObjectId,
        status: 'active',
        startsAt: uniqueIdActivation.startsAt,
        expiresAt: uniqueIdActivation.expiresAt,
        grantedBy: { adminName: 'Unique ID Inventory', role: 'system' },
        grantSource: uniqueIdActivation.grantSource,
        grantReason: 'Activated from My Items',
      };
      await Promise.all([
        IdentityEntitlement.create({
          ...sharedEntitlement,
          type: 'custom_display_id',
          config: { displayId: uniqueIdActivation.displayId, vipLevel: uniqueIdActivation.levelNumber },
        }),
        IdentityEntitlement.create({
          ...sharedEntitlement,
          type: 'unique_id_badge',
          config: {
            displayId: uniqueIdActivation.displayId,
            badgeName: uniqueIdActivation.badgeName,
            badgeIconUrl: uniqueIdActivation.badgeIconUrl,
            animationType: uniqueIdActivation.animationType,
            vipLevel: uniqueIdActivation.levelNumber,
            levelId: uniqueIdActivation.levelId,
          },
        }),
      ]);
    } else if (shouldRevokeUniqueId) {
      const account: any = await User.findById(userId).select('userId').lean();
      if (account) {
        await IdentityEntitlement.updateMany(
          { userId: account.userId, type: { $in: ['custom_display_id', 'unique_id_badge'] }, status: 'active' },
          { $set: { status: 'revoked' } },
        );
      }
    }

    return sendResponse(res, 200, true, 'Item equipped successfully', user);
  } catch (error: any) {
    console.error('equipStoreItem error:', error);
    return sendResponse(res, 500, false, error.message || 'Failed to equip store item');
  }
};
