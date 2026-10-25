import mongoose from 'mongoose';
import { RoomContribution } from '../models/roomContribution.model';
import { User } from '../models/user.model';
import { GiftTransaction } from '../gift/gift.model';
import { FanClubService } from './fanClub.service';

export function getISTNow(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 3600000);
}

export function getISTDateKey(date = getISTNow()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getISTMonthKey(date = getISTNow()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function getISTWeekRange(offsetWeeks = 0): {
  weekKey: string;
  startMonday: Date;
  endSunday: Date;
} {
  const ist = getISTNow();
  if (offsetWeeks !== 0) {
    ist.setDate(ist.getDate() + offsetWeeks * 7);
  }

  const dayOfWeek = ist.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const startMonday = new Date(ist);
  startMonday.setDate(ist.getDate() + diffToMonday);
  startMonday.setHours(0, 0, 0, 0);

  const endSunday = new Date(startMonday);
  endSunday.setDate(startMonday.getDate() + 6);
  endSunday.setHours(23, 59, 59, 999);

  const y1 = startMonday.getFullYear();
  const m1 = String(startMonday.getMonth() + 1).padStart(2, '0');
  const d1 = String(startMonday.getDate()).padStart(2, '0');

  const y2 = endSunday.getFullYear();
  const m2 = String(endSunday.getMonth() + 1).padStart(2, '0');
  const d2 = String(endSunday.getDate()).padStart(2, '0');

  const weekKey = `${y1}-${m1}-${d1}_${y2}-${m2}-${d2}`;
  return { weekKey, startMonday, endSunday };
}

export function normalizeRoomId(id: string): string {
  const clean = String(id || '').trim();
  if (/^10000\d{3}$/.test(clean)) {
    return `100000000${clean.slice(5)}`.slice(-10);
  }
  return clean;
}

export class RoomContributionService {
  /**
   * Records a gift contribution into daily, weekly, and monthly tracking
   */
  static async recordContribution(
    roomId: string,
    senderId: string | mongoose.Types.ObjectId,
    diamonds: number
  ) {
    if (!roomId || !senderId || !diamonds || diamonds <= 0) return;

    try {
      const cleanRoomId = normalizeRoomId(roomId);
      let senderObjId: mongoose.Types.ObjectId | null = null;
      if (mongoose.Types.ObjectId.isValid(String(senderId))) {
        senderObjId = new mongoose.Types.ObjectId(String(senderId));
      } else {
        const found = await User.findOne({
          $or: [{ userId: Number(senderId) || -1 }, { meethiId: String(senderId) }],
        }).select('_id').lean();
        if (found) senderObjId = found._id as mongoose.Types.ObjectId;
      }
      if (!senderObjId) return;

      const istNow = getISTNow();
      const dateKey = getISTDateKey(istNow);
      const { weekKey } = getISTWeekRange(0);
      const monthKey = getISTMonthKey(istNow);

      // Atomically upsert daily record
      await RoomContribution.findOneAndUpdate(
        { roomId: cleanRoomId, dateKey, userId: senderObjId },
        {
          $setOnInsert: { weekKey, monthKey },
          $inc: { diamonds: Number(diamonds) || 0 },
        },
        { upsert: true, new: true }
      );

      // Also record Fan Club sending EXP
      try {
        await FanClubService.recordSending(cleanRoomId, String(senderObjId), Number(diamonds));
      } catch (fcErr: any) {
        console.warn('[RoomContributionService] Fan club sending EXP error:', fcErr?.message);
      }
    } catch (err: any) {
      console.error('[RoomContributionService] recordContribution error:', err);
    }
  }

  /**
   * Fetches room contributors for Daily, Weekly, or Monthly period
   */
  static async getRoomContributors(
    roomId: string,
    currentUserId?: string,
    period: 'daily' | 'weekly' | 'monthly' = 'daily'
  ) {
    const cleanRoomId = normalizeRoomId(roomId);
    const istNow = getISTNow();
    const dateKey = getISTDateKey(istNow);
    const { weekKey, startMonday, endSunday } = getISTWeekRange(0);
    const monthKey = getISTMonthKey(istNow);

    let rawContributors: Array<{ userId: string; points: number }> = [];

    if (period === 'daily') {
      // Find today's contributions
      const dailyDocs = await RoomContribution.find({
        $or: [{ roomId: cleanRoomId }, { roomId: String(roomId).trim() }],
        dateKey,
        diamonds: { $gt: 0 },
      })
        .sort({ diamonds: -1 })
        .limit(100)
        .lean();

      rawContributors = dailyDocs.map((doc) => ({
        userId: String(doc.userId),
        points: doc.diamonds,
      }));

      // Fallback to GiftTransaction if no RoomContribution records yet today
      if (rawContributors.length === 0) {
        const startOfDay = new Date(istNow);
        startOfDay.setHours(0, 0, 0, 0);
        // Convert IST back to UTC for Mongo query
        const utcStartOfDay = new Date(startOfDay.getTime() - 5.5 * 3600000);

        const txDocs = await GiftTransaction.aggregate([
          {
            $match: {
              $or: [{ roomId: cleanRoomId }, { roomId: String(roomId).trim() }],
              status: { $in: ['SUCCESS', 'COMPLETED'] },
              createdAt: { $gte: utcStartOfDay },
            },
          },
          {
            $group: {
              _id: '$senderId',
              totalDiamonds: { $sum: '$totalDiamonds' },
            },
          },
          { $sort: { totalDiamonds: -1 } },
          { $limit: 100 },
        ]);

        rawContributors = txDocs.map((tx) => ({
          userId: String(tx._id),
          points: tx.totalDiamonds,
        }));
      }
    } else if (period === 'weekly') {
      // Aggregate across all days of the current week
      const weeklyDocs = await RoomContribution.aggregate([
        {
          $match: {
            $or: [{ roomId: cleanRoomId }, { roomId: String(roomId).trim() }],
            weekKey,
            diamonds: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: '$userId',
            totalDiamonds: { $sum: '$diamonds' },
          },
        },
        { $sort: { totalDiamonds: -1 } },
        { $limit: 100 },
      ]);

      rawContributors = weeklyDocs.map((doc) => ({
        userId: String(doc._id),
        points: doc.totalDiamonds,
      }));

      // Fallback to GiftTransaction if needed
      if (rawContributors.length === 0) {
        const utcStartOfWeek = new Date(startMonday.getTime() - 5.5 * 3600000);
        const txDocs = await GiftTransaction.aggregate([
          {
            $match: {
              $or: [{ roomId: cleanRoomId }, { roomId: String(roomId).trim() }],
              status: { $in: ['SUCCESS', 'COMPLETED'] },
              createdAt: { $gte: utcStartOfWeek },
            },
          },
          {
            $group: {
              _id: '$senderId',
              totalDiamonds: { $sum: '$totalDiamonds' },
            },
          },
          { $sort: { totalDiamonds: -1 } },
          { $limit: 100 },
        ]);

        rawContributors = txDocs.map((tx) => ({
          userId: String(tx._id),
          points: tx.totalDiamonds,
        }));
      }
    } else {
      // Monthly aggregation
      const monthlyDocs = await RoomContribution.aggregate([
        {
          $match: {
            $or: [{ roomId: cleanRoomId }, { roomId: String(roomId).trim() }],
            monthKey,
            diamonds: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: '$userId',
            totalDiamonds: { $sum: '$diamonds' },
          },
        },
        { $sort: { totalDiamonds: -1 } },
        { $limit: 100 },
      ]);

      rawContributors = monthlyDocs.map((doc) => ({
        userId: String(doc._id),
        points: doc.totalDiamonds,
      }));

      // Fallback to GiftTransaction if needed
      if (rawContributors.length === 0) {
        const startOfMonth = new Date(istNow.getFullYear(), istNow.getMonth(), 1, 0, 0, 0, 0);
        const utcStartOfMonth = new Date(startOfMonth.getTime() - 5.5 * 3600000);

        const txDocs = await GiftTransaction.aggregate([
          {
            $match: {
              $or: [{ roomId: cleanRoomId }, { roomId: String(roomId).trim() }],
              status: { $in: ['SUCCESS', 'COMPLETED'] },
              createdAt: { $gte: utcStartOfMonth },
            },
          },
          {
            $group: {
              _id: '$senderId',
              totalDiamonds: { $sum: '$totalDiamonds' },
            },
          },
          { $sort: { totalDiamonds: -1 } },
          { $limit: 100 },
        ]);

        rawContributors = txDocs.map((tx) => ({
          userId: String(tx._id),
          points: tx.totalDiamonds,
        }));
      }
    }

    // Populate user profiles
    const userIds = rawContributors
      .map((c) => c.userId)
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const userDocs = await User.find({ _id: { $in: userIds } })
      .select('_id userId name avatar image level wealthLevel svipLevel')
      .lean();

    const userMap = new Map<string, any>();
    userDocs.forEach((u) => {
      userMap.set(String(u._id), u);
      if (u.userId) userMap.set(String(u.userId), u);
    });

    const contributors = rawContributors
      .map((item, index) => {
        const profile = userMap.get(item.userId) || {};
        return {
          rank: index + 1,
          id: item.userId,
          _id: item.userId,
          userId: profile.userId || item.userId,
          name: profile.name || `User #${index + 1}`,
          avatar: profile.avatar || profile.image || '',
          level: profile.level || 1,
          wealthLevel: profile.wealthLevel || 1,
          svipLevel: profile.svipLevel || 0,
          points: item.points,
          diamonds: item.points,
          wealthPoints: item.points,
        };
      })
      .filter((c) => c.points > 0);

    // Current user's rank & contribution
    let myContribution = 0;
    let myRank: string | number = '99+';

    if (currentUserId) {
      const cleanMyId = String(currentUserId).trim();
      const foundIdx = contributors.findIndex(
        (c) =>
          String(c.id) === cleanMyId ||
          String(c._id) === cleanMyId ||
          String(c.userId) === cleanMyId
      );
      if (foundIdx >= 0) {
        myContribution = contributors[foundIdx].points;
        myRank = foundIdx + 1;
      }
    }

    // Dynamic human-readable time period text
    let timePeriodText = '';
    const dateFormatted = `${String(istNow.getDate()).padStart(2, '0')}/${String(
      istNow.getMonth() + 1
    ).padStart(2, '0')}/${istNow.getFullYear()}`;

    if (period === 'daily') {
      timePeriodText = `Time period: ${dateFormatted} 00:00am ~ 23:59pm`;
    } else if (period === 'weekly') {
      timePeriodText = `Time period: This Week (Mon ~ Sun)`;
    } else {
      const monthName = istNow.toLocaleString('default', { month: 'short' });
      timePeriodText = `Time period: This Month (${monthName} 01 ~ ${monthName} 31)`;
    }

    return {
      period,
      dateKey,
      weekKey,
      monthKey,
      timePeriodText,
      contributors,
      myContribution,
      myRank,
    };
  }
}
