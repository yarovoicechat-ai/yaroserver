import mongoose, { Types } from 'mongoose';
import { Gift, GiftCategory, GiftTransaction } from './gift.model';
import { User } from '../models/user.model';
import { CoinsTransaction } from '../models/spentCoinModel';
import { TransactionType } from '../constants/user';
import { getCachedSettings } from '../controllers/settingsController';
import { broadcastGiftSuccess } from './gift.socket';
import { LevelService } from '../services/level.service';
import {
  CreateCategoryDTO,
  CreateGiftDTO,
  GiftFilterQuery,
  SendGiftDTO,
  UpdateCategoryDTO,
  UpdateGiftDTO,
} from './gift.types';

const DEFAULT_COMMISSION_PERCENT = 30;

// Standard categories as required by the design
export const INITIAL_CATEGORIES = [
  { name: 'Gifts', slug: 'gifts', sortOrder: 1, icon: '🎁', isActive: true },
  { name: 'Lucky', slug: 'lucky', sortOrder: 2, icon: '🍀', isActive: true },
  { name: 'Event', slug: 'event', sortOrder: 3, icon: '🎉', isActive: true },
  { name: 'Surprise', slug: 'surprise', sortOrder: 4, icon: '✨', isActive: true },
  { name: 'Custom', slug: 'custom', sortOrder: 5, icon: '💎', isActive: true },
  { name: 'VIP', slug: 'vip', sortOrder: 6, icon: '👑', isActive: true, isVipOnly: true },
  { name: 'Special', slug: 'special', sortOrder: 7, icon: '⭐', isActive: true },
];

// Rich default gifts with Diamond pricing matching reference design
export const INITIAL_GIFTS: Array<Partial<CreateGiftDTO>> = [
  {
    name: 'Glory Crown',
    slug: 'glory-crown',
    category: 'Gifts',
    icon: '👑',
    price: 50,
    cost: 50,
    currency: 'diamonds',
    rarity: 'common',
    animationType: 'NORMAL',
    duration: 2500,
    sortOrder: 1,
    isActive: true,
  },
  {
    name: 'Clover',
    slug: 'clover',
    category: 'Lucky',
    icon: '🍀',
    price: 25,
    cost: 25,
    currency: 'diamonds',
    rarity: 'common',
    animationType: 'NORMAL',
    duration: 2200,
    sortOrder: 2,
    isActive: true,
  },
  {
    name: 'Friends Player',
    slug: 'friends-player',
    category: 'Surprise',
    icon: '🎰',
    price: 25,
    cost: 25,
    currency: 'diamonds',
    rarity: 'common',
    animationType: 'SPECIAL',
    duration: 2600,
    sortOrder: 3,
    isActive: true,
  },
  {
    name: 'Rich',
    slug: 'rich',
    category: 'Event',
    icon: '🎩',
    price: 3999,
    cost: 3999,
    currency: 'diamonds',
    rarity: 'rare',
    animationType: 'CENTER_STAGE',
    duration: 3500,
    sortOrder: 4,
    isActive: true,
  },
  {
    name: 'Friend Gift',
    slug: 'friend-gift',
    category: 'Custom',
    icon: '🐯',
    price: 5999,
    cost: 5999,
    currency: 'diamonds',
    rarity: 'rare',
    animationType: 'CENTER_STAGE',
    duration: 3500,
    sortOrder: 5,
    isActive: true,
  },
  {
    name: 'MASUM',
    slug: 'masum',
    category: 'Special',
    icon: '👸',
    price: 29999,
    cost: 29999,
    currency: 'diamonds',
    rarity: 'epic',
    animationType: 'FULL_SCREEN',
    duration: 5000,
    sortOrder: 6,
    isActive: true,
  },
  {
    name: 'Falcon King',
    slug: 'falcon-king',
    category: 'VIP',
    icon: '🦅',
    price: 49999,
    cost: 49999,
    currency: 'diamonds',
    rarity: 'legendary',
    isVipOnly: true,
    animationType: 'VIP',
    duration: 6000,
    sortOrder: 7,
    isActive: true,
  },
  {
    name: 'Boss Arrival',
    slug: 'boss-arrival',
    category: 'SVIP',
    icon: '🏎️',
    price: 99999,
    cost: 99999,
    currency: 'diamonds',
    rarity: 'legendary',
    isVipOnly: true,
    animationType: 'LUXURY',
    duration: 7000,
    sortOrder: 8,
    isActive: true,
  },
  {
    name: 'Rose',
    slug: 'rose',
    category: 'Gifts',
    icon: '🌹',
    price: 1,
    cost: 1,
    currency: 'diamonds',
    rarity: 'common',
    animationType: 'NORMAL',
    duration: 2000,
    sortOrder: 9,
    isActive: true,
  },
  {
    name: 'Heart',
    slug: 'heart',
    category: 'Gifts',
    icon: '❤️',
    price: 5,
    cost: 5,
    currency: 'diamonds',
    rarity: 'common',
    animationType: 'FLOATING',
    duration: 2200,
    sortOrder: 10,
    isActive: true,
  },
  {
    name: 'Lollipop',
    slug: 'lollipop',
    category: 'Gifts',
    icon: '🍭',
    price: 10,
    cost: 10,
    currency: 'diamonds',
    rarity: 'common',
    animationType: 'NORMAL',
    duration: 2200,
    sortOrder: 11,
    isActive: true,
  },
  {
    name: 'Ice Cream',
    slug: 'ice-cream',
    category: 'Gifts',
    icon: '🍦',
    price: 15,
    cost: 15,
    currency: 'diamonds',
    rarity: 'rare',
    animationType: 'NORMAL',
    duration: 2400,
    sortOrder: 12,
    isActive: true,
  },
  {
    name: 'Diamond Ring',
    slug: 'diamond-ring',
    category: 'Custom',
    icon: '💍',
    price: 99,
    cost: 99,
    currency: 'diamonds',
    rarity: 'epic',
    animationType: 'FLY_TO_RECEIVER',
    duration: 3000,
    sortOrder: 13,
    isActive: true,
  },
  {
    name: 'Love Letter',
    slug: 'love-letter',
    category: 'Surprise',
    icon: '💌',
    price: 20,
    cost: 20,
    currency: 'diamonds',
    rarity: 'rare',
    animationType: 'FLOATING',
    duration: 2500,
    sortOrder: 14,
    isActive: true,
  },
  {
    name: 'Romantic Kiss',
    slug: 'romantic-kiss',
    category: 'Surprise',
    icon: '💋',
    price: 50,
    cost: 50,
    currency: 'diamonds',
    rarity: 'epic',
    animationType: 'SPECIAL',
    duration: 3000,
    sortOrder: 15,
    isActive: true,
  },
  {
    name: 'Flower Bouquet',
    slug: 'flower-bouquet',
    category: 'Event',
    icon: '💐',
    price: 88,
    cost: 88,
    currency: 'diamonds',
    rarity: 'epic',
    animationType: 'CENTER_STAGE',
    duration: 3200,
    sortOrder: 16,
    isActive: true,
  },
];

export class GiftService {
  /**
   * Seed initial catalog with Diamond pricing if empty.
   */
  static async seedInitialCatalog() {
    try {
      const categoryCount = await GiftCategory.countDocuments();
      if (categoryCount === 0) {
        console.log('[GiftService] Seeding default gift categories...');
        await GiftCategory.insertMany(INITIAL_CATEGORIES);
      }

      const giftCount = await Gift.countDocuments();
      if (giftCount === 0) {
        console.log('[GiftService] Seeding initial rich gifts catalog with Diamonds...');
        const categories = await GiftCategory.find().lean();
        const categoryMap = new Map(categories.map((c) => [c.name.toLowerCase(), c._id]));

        const giftsWithRefs = INITIAL_GIFTS.map((g) => ({
          ...g,
          categoryId: categoryMap.get((g.category || 'Gifts').toLowerCase()) || categories[0]?._id,
          currency: 'diamonds',
          cost: g.price,
        }));
        await Gift.insertMany(giftsWithRefs);
      }
    } catch (err: any) {
      console.warn('[GiftService] Seed warning:', err.message);
    }
  }

  /**
   * Fetch categories with automatic fallback seed if empty.
   */
  static async getCategories() {
    let categories = await GiftCategory.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
    if (!categories || categories.length === 0) {
      await this.seedInitialCatalog();
      categories = await GiftCategory.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
    }
    return categories;
  }

  /**
   * Fetch active gifts with optional category, search, and rarity filtering.
   */
  static async getGifts(filter: GiftFilterQuery = {}) {
    const now = new Date();
    const query: any = {};

    if (String(filter.includeInactive) !== 'true') {
      query.isActive = true;
      query.$and = [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      ];
    }

    if (filter.categoryId && Types.ObjectId.isValid(String(filter.categoryId))) {
      query.categoryId = filter.categoryId;
    } else if (filter.category && filter.category.toLowerCase() !== 'all') {
      const cat = await GiftCategory.findOne({
        $or: [
          { slug: filter.category.toLowerCase() },
          { name: new RegExp(`^${filter.category}$`, 'i') },
        ],
      }).lean();
      if (cat) {
        query.$or = [{ categoryId: cat._id }, { category: new RegExp(`^${filter.category}$`, 'i') }];
      } else {
        query.category = new RegExp(`^${filter.category}$`, 'i');
      }
    }

    if (filter.rarity) {
      query.rarity = filter.rarity;
    }

    if (filter.isVipOnly !== undefined) {
      query.isVipOnly = String(filter.isVipOnly) === 'true';
    }

    let gifts = await Gift.find(query).sort({ sortOrder: 1, price: 1, cost: 1 }).lean();

    if ((!gifts || gifts.length === 0) && (!filter.category || filter.category.toLowerCase() === 'all')) {
      await this.seedInitialCatalog();
      gifts = await Gift.find(query).sort({ sortOrder: 1, price: 1, cost: 1 }).lean();
    }

    return gifts.map((g) => ({
      ...g,
      price: g.price !== undefined ? g.price : g.cost,
      cost: g.cost !== undefined ? g.cost : g.price,
      currency: 'diamonds',
    }));
  }

  /**
   * Get user's current Diamond balance.
   */
  static async getUserDiamondsBalance(userId: string | Types.ObjectId): Promise<number> {
    const user = await User.findById(userId).select('diamonds coins').lean();
    if (!user) return 0;
    return Math.max(0, Number(user.diamonds || 0));
  }

  /**
   * Core Send Gift Engine using DIAMONDS:
   * 1. Idempotency protection with requestId
   * 2. Server-side gift and price validation
   * 3. Multi-receiver calculation
   * 4. Atomic Diamond balance deduction (sender.diamonds >= totalDiamonds)
   * 5. Platform commission and host earnings split
   * 6. GiftTransaction creation with currency: "DIAMONDS"
   * 7. Real-time Socket broadcast
   */
  static async sendGift(senderId: string | Types.ObjectId, dto: SendGiftDTO) {
    const { requestId, giftId, quantity: rawQty = 1, comboCount = 1, roomId, callId } = dto;

    if (!requestId || typeof requestId !== 'string') {
      throw new Error('requestId is required for idempotency protection');
    }

    // 1. Idempotency Check
    const existingTx = await GiftTransaction.findOne({ requestId })
      .populate('giftId')
      .lean();
    if (existingTx) {
      console.log(`[GiftService] Idempotent replay detected for requestId: ${requestId}`);
      const senderBal = await this.getUserDiamondsBalance(senderId);
      return {
        isReplay: true,
        transaction: existingTx,
        newBalance: senderBal,
        gift: existingTx.giftId,
        totalDiamonds: existingTx.totalDiamonds || existingTx.totalPrice || 0,
        quantity: existingTx.quantity,
      };
    }

    // 2. Validate Gift
    if (!giftId || !Types.ObjectId.isValid(String(giftId))) {
      throw new Error('Invalid giftId specified');
    }
    const gift = await Gift.findById(giftId);
    if (!gift || !gift.isActive) {
      throw new Error('Gift not found or currently unavailable');
    }

    const now = new Date();
    if (gift.startsAt && gift.startsAt > now) {
      throw new Error(`This event gift is not yet active (starts at ${gift.startsAt.toISOString()})`);
    }
    if (gift.endsAt && gift.endsAt < now) {
      throw new Error('This limited-time gift has expired');
    }

    const unitPrice = Number(gift.price !== undefined ? gift.price : gift.cost);
    if (isNaN(unitPrice) || unitPrice < 0) {
      throw new Error('Invalid gift price');
    }

    // 3. Validate Quantity
    const qty = Math.max(1, Math.min(1000, Math.floor(Number(rawQty) || 1)));

    // 4. Resolve Receivers
    let targetReceiverIds: string[] = [];
    if (Array.isArray(dto.receiverIds) && dto.receiverIds.length > 0) {
      targetReceiverIds = dto.receiverIds.map(String);
    } else if (dto.receiverId) {
      targetReceiverIds = [String(dto.receiverId)];
    }

    targetReceiverIds = Array.from(new Set(targetReceiverIds.filter(Boolean)));
    if (targetReceiverIds.length === 0) {
      throw new Error('Please select at least one gift recipient');
    }

    const receivers: any[] = [];
    for (const rawId of targetReceiverIds) {
      let rec: any = null;
      if (Types.ObjectId.isValid(rawId)) {
        rec = await User.findById(rawId).select('_id userId name image avatar coins diamonds').lean();
      }
      if (!rec) {
        const num = Number(rawId);
        rec = await User.findOne({
          $or: [
            ...(isNaN(num) ? [] : [{ userId: num }]),
            { meethiId: String(rawId) },
          ],
        }).select('_id userId name image avatar coins diamonds').lean();
      }
      if (rec) {
        receivers.push(rec);
      }
    }

    if (receivers.length === 0) {
      throw new Error('Selected recipients could not be found');
    }

    // 5. Total Diamonds Calculation
    const totalDiamonds = unitPrice * qty * receivers.length;

    // 6. Sender Validation
    const sender = await User.findById(senderId).select('_id userId name image avatar coins diamonds level').lean();
    if (!sender) {
      throw new Error('Sender user not found');
    }

    if (gift.isVipOnly) {
      const userLevel = Number(sender.level || 1);
      if (userLevel < 5) {
        throw new Error('This gift is exclusive to VIP members (Level 5+)');
      }
    }

    // 7. Check Balance & Deduct Atomically in DIAMONDS
    const currentDiamonds = Number(sender.diamonds || 0);

    if (currentDiamonds < totalDiamonds) {
      const err: any = new Error(
        `Insufficient Diamonds. Required: ${totalDiamonds} 💎, Available: ${currentDiamonds} 💎`
      );
      err.code = 'INSUFFICIENT_DIAMONDS';
      err.requiredDiamonds = totalDiamonds;
      err.availableDiamonds = currentDiamonds;
      throw err;
    }

    // Perform atomic deduction on diamonds
    const updatedSender = await User.findOneAndUpdate(
      { _id: sender._id, diamonds: { $gte: totalDiamonds } },
      { $inc: { diamonds: -totalDiamonds } },
      { new: true }
    );

    if (!updatedSender) {
      const err: any = new Error('Insufficient Diamonds (concurrency lock)');
      err.code = 'INSUFFICIENT_DIAMONDS';
      throw err;
    }

    // 8. Calculate Earnings & Credit Receivers
    const settings = await getCachedSettings();
    const commissionPercent = Math.max(
      0,
      Math.min(100, Number(settings.giftCommissionPercent ?? DEFAULT_COMMISSION_PERCENT))
    );
    const hostShare = (100 - commissionPercent) / 100;
    const perReceiverCost = unitPrice * qty;
    const perReceiverEarning = Math.round(perReceiverCost * hostShare);
    const totalHostEarnings = perReceiverEarning * receivers.length;
    const platformCommission = Math.max(0, totalDiamonds - totalHostEarnings);

    const receiverBalances: Array<{ userId: string; diamonds: number }> = [];
    for (const rec of receivers) {
      if (perReceiverEarning > 0) {
        const updatedRec = await User.findByIdAndUpdate(
          rec._id,
          { $inc: { diamonds: perReceiverEarning, coins: perReceiverEarning } },
          { new: true }
        ).select('_id coins diamonds').lean();
        receiverBalances.push({
          userId: String(rec._id),
          diamonds: Number((updatedRec as any)?.diamonds || 0),
        });
      } else {
        receiverBalances.push({
          userId: String(rec._id),
          diamonds: Number(rec.diamonds || 0),
        });
      }
    }

    // 9. Record Gift Transaction with Unique RequestId
    let transactionDoc: any;
    try {
      transactionDoc = await GiftTransaction.create({
        requestId,
        senderId: sender._id,
        receiverId: receivers[0]._id,
        receiverIds: receivers.map((r) => r._id),
        roomId: roomId || '',
        callId: callId || '',
        giftId: gift._id,
        quantity: qty,
        unitPrice,
        totalDiamonds,
        totalPrice: totalDiamonds,
        currency: 'DIAMONDS',
        type: 'GIFT_SEND',
        status: 'SUCCESS',
        hostEarning: totalHostEarnings,
        platformCommission,
        commissionPercent,
        comboCount: Number(comboCount) || 1,
        meta: {
          giftName: gift.name,
          giftIcon: gift.icon,
          animationType: gift.animationType,
          receiverCount: receivers.length,
          currency: 'DIAMONDS',
        },
      });
    } catch (createErr: any) {
      if (createErr.code === 11000) {
        console.warn(`[GiftService] Duplicate key conflict caught on requestId ${requestId}`);
        const existing = await GiftTransaction.findOne({ requestId }).lean();
        if (existing) {
          return {
            isReplay: true,
            transaction: existing,
            newBalance: await this.getUserDiamondsBalance(senderId),
            gift,
            totalDiamonds,
            quantity: qty,
          };
        }
      }
      throw createErr;
    }

    // Optional legacy transaction log
    try {
      await CoinsTransaction.create({
        userId: sender._id,
        hostId: receivers[0]._id,
        type: TransactionType.GIFT_SENT || 'gift_sent',
        coinsSpent: totalDiamonds,
        diamondsEarned: perReceiverEarning,
        callStatus: 'completed',
        callDuration: 0,
      });
    } catch (logErr) {
      console.warn('[GiftService] CoinsTransaction log error:', logErr);
    }

    // Award Wealth EXP to Sender & Charm EXP to Receivers
    try {
      await LevelService.addWealthExp(
        String(sender._id),
        totalDiamonds,
        'send_gift',
        String(transactionDoc?._id || requestId)
      );

      for (const rec of receivers) {
        await LevelService.addCharmExp(
          String(rec._id),
          perReceiverCost,
          'receive_gift',
          String(transactionDoc?._id || requestId)
        );
      }
    } catch (levelErr: any) {
      console.warn('[GiftService] Level EXP award error:', levelErr?.message);
    }

    // 10. Real-time Socket Broadcast
    const payload = {
      transactionId: String(transactionDoc._id),
      requestId,
      roomId: roomId || '',
      callId: callId || '',
      sender: {
        id: String(sender._id),
        userId: sender.userId,
        name: sender.name,
        avatar: sender.image || (sender as any).avatar,
      },
      receivers: receivers.map((r) => ({
        id: String(r._id),
        userId: r.userId,
        name: r.name,
        avatar: r.image || r.avatar,
      })),
      receiver: {
        id: String(receivers[0]._id),
        userId: receivers[0].userId,
        name: receivers[0].name,
        avatar: receivers[0].image || receivers[0].avatar,
      },
      gift: {
        id: String(gift._id),
        name: gift.name,
        icon: gift.icon,
        image: (gift as any).image || (gift as any).imageUrl || (gift as any).previewUrl || '',
        giftImage: (gift as any).image || (gift as any).imageUrl || (gift as any).previewUrl || '',
        previewUrl: (gift as any).previewUrl || (gift as any).imageUrl || '',
        animationUrl: gift.animationUrl,
        animationType: gift.animationType,
        rarity: gift.rarity,
        duration: gift.duration,
        price: unitPrice,
        currency: 'DIAMONDS',
      },
      quantity: qty,
      totalDiamonds,
      comboCount: Number(comboCount) || 1,
      senderBalance: updatedSender.diamonds,
      receiverBalances,
      timestamp: Date.now(),
    };

    broadcastGiftSuccess({ ...payload, transaction: transactionDoc });

    return {
      success: true,
      data: payload,
      transaction: transactionDoc,
      newBalance: updatedSender.diamonds,
    };
  }

  /**
   * Get User Sent Gifts History
   */
  static async getSentGifts(userId: string | Types.ObjectId, page = 1, limit = 20) {
    const skip = (Math.max(1, page) - 1) * limit;
    const [transactions, total] = await Promise.all([
      GiftTransaction.find({ senderId: userId, status: 'COMPLETED' })
        .populate('giftId')
        .populate('receiverId', 'name image avatar userId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      GiftTransaction.countDocuments({ senderId: userId, status: 'COMPLETED' }),
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get User Received Gifts History
   */
  static async getReceivedGifts(userId: string | Types.ObjectId, page = 1, limit = 20) {
    const skip = (Math.max(1, page) - 1) * limit;
    const query = {
      $or: [{ receiverId: userId }, { receiverIds: userId }],
      status: 'COMPLETED',
    };

    const [transactions, total] = await Promise.all([
      GiftTransaction.find(query)
        .populate('giftId')
        .populate('senderId', 'name image avatar userId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      GiftTransaction.countDocuments(query),
    ]);

    return {
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Admin: Create Gift
   */
  static async createGift(dto: CreateGiftDTO) {
    const gift = new Gift({
      ...dto,
      currency: 'diamonds',
      cost: dto.price,
    });
    return gift.save();
  }

  /**
   * Admin: Update Gift
   */
  static async updateGift(id: string, dto: UpdateGiftDTO) {
    return Gift.findByIdAndUpdate(id, { $set: dto }, { new: true, runValidators: true });
  }

  /**
   * Admin: Toggle Status
   */
  static async toggleGiftStatus(id: string, active?: boolean) {
    const gift = await Gift.findById(id);
    if (!gift) throw new Error('Gift not found');
    gift.isActive = active !== undefined ? active : !gift.isActive;
    return gift.save();
  }

  /**
   * Admin: Delete Gift
   */
  static async deleteGift(id: string) {
    return Gift.findByIdAndDelete(id);
  }

  /**
   * Admin: Create Category
   */
  static async createCategory(dto: CreateCategoryDTO) {
    const cat = new GiftCategory(dto);
    return cat.save();
  }

  /**
   * Admin: Update Category
   */
  static async updateCategory(id: string, dto: UpdateCategoryDTO) {
    return GiftCategory.findByIdAndUpdate(id, { $set: dto }, { new: true, runValidators: true });
  }

  /**
   * Admin: Delete Category
   */
  static async deleteCategory(id: string) {
    return GiftCategory.findByIdAndDelete(id);
  }

  /**
   * History helper for gift controller
   */
  static async getHistory(userId: string | Types.ObjectId, type: 'all' | 'sent' | 'received' = 'all', page = 1, limit = 20) {
    if (type === 'sent') return this.getSentGifts(userId, page, limit);
    if (type === 'received') return this.getReceivedGifts(userId, page, limit);
    const [sent, received] = await Promise.all([
      this.getSentGifts(userId, page, limit),
      this.getReceivedGifts(userId, page, limit),
    ]);
    return {
      sent: sent.transactions,
      received: received.transactions,
      pagination: sent.pagination,
    };
  }

  static async adminCreateGift(dto: CreateGiftDTO) {
    return this.createGift(dto);
  }

  static async adminUpdateGift(id: string, dto: UpdateGiftDTO) {
    return this.updateGift(id, dto);
  }

  static async adminDeleteGift(id: string) {
    return this.deleteGift(id);
  }

  static async adminToggleGiftActive(id: string, active?: boolean) {
    return this.toggleGiftStatus(id, active);
  }

  static async adminCreateCategory(dto: CreateCategoryDTO) {
    return this.createCategory(dto);
  }

  static async adminUpdateCategory(id: string, dto: UpdateCategoryDTO) {
    return this.updateCategory(id, dto);
  }

  static async adminDeleteCategory(id: string) {
    return this.deleteCategory(id);
  }
}
