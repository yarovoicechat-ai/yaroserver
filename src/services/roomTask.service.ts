import mongoose from 'mongoose';
import { RoomTaskProgress } from '../models/roomTaskProgress.model';
import { RoomSupportStats } from '../models/roomSupportStats.model';
import { Room } from '../models/room.model';
import { User } from '../models/user.model';

export interface ITaskDefinition {
  id: string;
  category: 'Gifts' | 'Followers' | 'Visitors' | 'Host';
  title: string;
  description: string;
  target: number;
  unit: string;
  reward: number;
  icon: string;
}

// 13 Room Tasks with reduced, modest coin rewards
export const ROOM_TASKS_CONFIG: ITaskDefinition[] = [
  // 1. Gifts
  {
    id: 'task_gift_1',
    category: 'Gifts',
    title: 'Send a gift',
    description: 'Send at least one gift in your room today',
    target: 1,
    unit: 'count',
    reward: 10,
    icon: 'gift',
  },
  {
    id: 'task_gift_10',
    category: 'Gifts',
    title: 'Send 10 gifts',
    description: 'Send gifts 10 times in your room today',
    target: 10,
    unit: 'count',
    reward: 50,
    icon: 'gift-outline',
  },
  {
    id: 'task_gift_new_3',
    category: 'Gifts',
    title: 'Gift 3 new users',
    description: 'Send gifts to 3 different new users in your room (joined in the last 7 days)',
    target: 3,
    unit: 'count',
    reward: 30,
    icon: 'sparkles',
  },
  {
    id: 'task_gift_users_5',
    category: 'Gifts',
    title: '5 users send gifts',
    description: '5 different users (not new accounts) send gifts in your room today',
    target: 5,
    unit: 'count',
    reward: 60,
    icon: 'account-group',
  },
  {
    id: 'task_gift_new_send_3',
    category: 'Gifts',
    title: '3 new users send gifts',
    description: '3 different new users send gifts in your room today',
    target: 3,
    unit: 'count',
    reward: 25,
    icon: 'account-star',
  },

  // 2. Followers
  {
    id: 'task_follow_1',
    category: 'Followers',
    title: 'Get 1 new follower',
    description: 'Gain 1 new follower today',
    target: 1,
    unit: 'count',
    reward: 5,
    icon: 'account-plus',
  },
  {
    id: 'task_follow_10',
    category: 'Followers',
    title: 'Get 10 new followers',
    description: 'Gain 10 new followers today',
    target: 10,
    unit: 'count',
    reward: 25,
    icon: 'account-multiple-plus',
  },
  {
    id: 'task_follow_new_3',
    category: 'Followers',
    title: '3 new users follow you',
    description: '3 different new users follow you today',
    target: 3,
    unit: 'count',
    reward: 15,
    icon: 'account-heart',
  },

  // 3. Visitors
  {
    id: 'task_visitors_10',
    category: 'Visitors',
    title: '10 unique visitors',
    description: '10 different users enter your room today',
    target: 10,
    unit: 'count',
    reward: 15,
    icon: 'eye-outline',
  },
  {
    id: 'task_visitors_new_3',
    category: 'Visitors',
    title: '3 new visitors',
    description: '3 different new users enter your room today',
    target: 3,
    unit: 'count',
    reward: 10,
    icon: 'account-eye',
  },

  // 4. Host (Mic time)
  {
    id: 'task_mic_10',
    category: 'Host',
    title: 'On mic for 10 minutes',
    description: 'Stay on the mic in your room for 10 minutes today',
    target: 10,
    unit: 'minutes',
    reward: 10,
    icon: 'microphone',
  },
  {
    id: 'task_mic_30',
    category: 'Host',
    title: 'On mic for 30 minutes',
    description: 'Stay on the mic in your room for 30 minutes today',
    target: 30,
    unit: 'minutes',
    reward: 25,
    icon: 'microphone',
  },
  {
    id: 'task_mic_120',
    category: 'Host',
    title: 'On mic for 120 minutes',
    description: 'Stay on the mic in your room for 120 minutes today',
    target: 120,
    unit: 'minutes',
    reward: 50,
    icon: 'microphone',
  },
];

// 22 Levels of Room Support Target & Reward from video reference
export const ROOM_SUPPORT_LEVELS = [
  { level: 1, targetCoins: 3_000_000, targetCoinsFormatted: '3M', minVisitors: 20, ownerReward: 450_000, ownerRewardFormatted: '450K' },
  { level: 2, targetCoins: 6_000_000, targetCoinsFormatted: '6M', minVisitors: 50, ownerReward: 900_000, ownerRewardFormatted: '900K' },
  { level: 3, targetCoins: 12_000_000, targetCoinsFormatted: '12M', minVisitors: 75, ownerReward: 1_800_000, ownerRewardFormatted: '1.80M' },
  { level: 4, targetCoins: 20_000_000, targetCoinsFormatted: '20M', minVisitors: 100, ownerReward: 3_000_000, ownerRewardFormatted: '3M' },
  { level: 5, targetCoins: 27_000_000, targetCoinsFormatted: '27M', minVisitors: 130, ownerReward: 4_050_000, ownerRewardFormatted: '4.05M' },
  { level: 6, targetCoins: 36_000_000, targetCoinsFormatted: '36M', minVisitors: 170, ownerReward: 5_400_000, ownerRewardFormatted: '5.40M' },
  { level: 7, targetCoins: 45_000_000, targetCoinsFormatted: '45M', minVisitors: 210, ownerReward: 6_750_000, ownerRewardFormatted: '6.75M' },
  { level: 8, targetCoins: 60_000_000, targetCoinsFormatted: '60M', minVisitors: 260, ownerReward: 9_000_000, ownerRewardFormatted: '9M' },
  { level: 9, targetCoins: 90_000_000, targetCoinsFormatted: '90M', minVisitors: 320, ownerReward: 13_500_000, ownerRewardFormatted: '13.50M' },
  { level: 10, targetCoins: 120_000_000, targetCoinsFormatted: '120M', minVisitors: 380, ownerReward: 18_000_000, ownerRewardFormatted: '18M' },
  { level: 11, targetCoins: 180_000_000, targetCoinsFormatted: '180M', minVisitors: 450, ownerReward: 30_600_000, ownerRewardFormatted: '30.60M' },
  { level: 12, targetCoins: 240_000_000, targetCoinsFormatted: '240M', minVisitors: 500, ownerReward: 40_800_000, ownerRewardFormatted: '40.80M' },
  { level: 13, targetCoins: 360_000_000, targetCoinsFormatted: '360M', minVisitors: 600, ownerReward: 72_000_000, ownerRewardFormatted: '72M' },
  { level: 14, targetCoins: 480_000_000, targetCoinsFormatted: '480M', minVisitors: 800, ownerReward: 96_000_000, ownerRewardFormatted: '96M' },
  { level: 15, targetCoins: 780_000_000, targetCoinsFormatted: '780M', minVisitors: 1000, ownerReward: 156_000_000, ownerRewardFormatted: '156M' },
  { level: 16, targetCoins: 1_140_000_000, targetCoinsFormatted: '1.14B', minVisitors: 1250, ownerReward: 228_000_000, ownerRewardFormatted: '228M' },
  { level: 17, targetCoins: 2_000_000_000, targetCoinsFormatted: '2B', minVisitors: 2000, ownerReward: 400_000_000, ownerRewardFormatted: '400M' },
  { level: 18, targetCoins: 3_000_000_000, targetCoinsFormatted: '3B', minVisitors: 2000, ownerReward: 600_000_000, ownerRewardFormatted: '600M' },
  { level: 19, targetCoins: 4_000_000_000, targetCoinsFormatted: '4B', minVisitors: 2500, ownerReward: 800_000_000, ownerRewardFormatted: '800M' },
  { level: 20, targetCoins: 5_000_000_000, targetCoinsFormatted: '5B', minVisitors: 2500, ownerReward: 1_000_000_000, ownerRewardFormatted: '1B' },
  { level: 21, targetCoins: 6_500_000_000, targetCoinsFormatted: '6.50B', minVisitors: 3000, ownerReward: 1_300_000_000, ownerRewardFormatted: '1.30B' },
  { level: 22, targetCoins: 9_000_000_000, targetCoinsFormatted: '9B', minVisitors: 3000, ownerReward: 1_800_000_000, ownerRewardFormatted: '1.80B' },
];

export const ROOM_SUPPORT_RULES = [
  'Weekly Room Visitors and Weekly Room Coins are counted from Monday 00:00 to Sunday 23:59 (UTC + 5:30)',
  'Reaching the Room Level requires meeting both the Target for the recorded Room Coins and Room Visitors.',
  'Each user can only receive 1 reward per week.',
  'Room Support rewards will be sent out every Wednesday. If the user qualifies for the reward in the current week, the reward will be sent out on Wednesday of the following week.',
  "This has nothing to do with Apple or Google Play's policies, and is solely based on Yaro's internal Room Support program.",
];

/**
 * IST (UTC+5:30) Date and Time Utilities
 */
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

export function getISTSecondsUntilMidnight(): number {
  const istNow = getISTNow();
  const tomorrow = new Date(istNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((tomorrow.getTime() - istNow.getTime()) / 1000));
}

/**
 * Returns current week range (Monday 00:00 to Sunday 23:59:59 in IST)
 */
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

/**
 * Returns seconds remaining until this Sunday 23:59:59 IST
 */
export function getISTSecondsUntilWeekEnd(): number {
  const istNow = getISTNow();
  const { endSunday } = getISTWeekRange(0);
  return Math.max(0, Math.floor((endSunday.getTime() - istNow.getTime()) / 1000));
}

/**
 * Returns seconds remaining until next Wednesday 00:00:00 IST payout
 */
export function getISTSecondsUntilRewardSend(): number {
  const istNow = getISTNow();
  const dayOfWeek = istNow.getDay(); // 0: Sun, 1: Mon, 2: Tue, 3: Wed...
  
  // Find next Wednesday 00:00
  let daysUntilWednesday = (3 - dayOfWeek + 7) % 7;
  if (daysUntilWednesday === 0 && (istNow.getHours() > 0 || istNow.getMinutes() > 0)) {
    daysUntilWednesday = 7;
  }

  const nextWed = new Date(istNow);
  nextWed.setDate(istNow.getDate() + daysUntilWednesday);
  nextWed.setHours(0, 0, 0, 0);

  return Math.max(0, Math.floor((nextWed.getTime() - istNow.getTime()) / 1000));
}

export class RoomTaskService {
  /**
   * Retrieves or initializes daily task progress for a room and user
   */
  static async getRoomTasks(roomId: string, userId: string) {
    const dateKey = getISTDateKey();
    let userObjId: mongoose.Types.ObjectId | null = null;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      userObjId = new mongoose.Types.ObjectId(userId);
    } else {
      const found = await User.findOne({ userId: Number(userId) || -1 }).select('_id').lean();
      if (found) userObjId = found._id as mongoose.Types.ObjectId;
    }

    if (!userObjId) {
      return {
        dateKey,
        resetsInSeconds: getISTSecondsUntilMidnight(),
        summary: { total: ROOM_TASKS_CONFIG.length, done: 0, claimable: 0, claimed: 0 },
        tasks: ROOM_TASKS_CONFIG.map((def) => ({ ...def, progress: 0, status: 'in_progress', claimedAt: null })),
      };
    }

    // Fetch existing records for today
    const existing = await RoomTaskProgress.find({
      roomId,
      userId: userObjId,
      dateKey,
    }).lean();

    const existingMap = new Map<string, any>();
    existing.forEach((doc) => existingMap.set(doc.taskId, doc));

    const tasksToInsert: any[] = [];
    const fullTasks: any[] = [];

    for (const def of ROOM_TASKS_CONFIG) {
      if (existingMap.has(def.id)) {
        const item = existingMap.get(def.id);
        fullTasks.push({
          ...def,
          progress: item.progress,
          status: item.status,
          claimedAt: item.claimedAt,
        });
      } else {
        const initial = {
          roomId,
          userId: userObjId,
          dateKey,
          taskId: def.id,
          category: def.category,
          title: def.title,
          description: def.description,
          target: def.target,
          unit: def.unit,
          progress: 0,
          reward: def.reward,
          status: 'in_progress',
        };
        tasksToInsert.push(initial);
        fullTasks.push({
          ...def,
          progress: 0,
          status: 'in_progress',
        });
      }
    }

    if (tasksToInsert.length > 0) {
      try {
        await RoomTaskProgress.insertMany(tasksToInsert, { ordered: false });
      } catch (err: any) {
        // Ignore duplicate key errors on race conditions
      }
    }

    // Compute summary counters
    let done = 0;
    let claimable = 0;
    let claimed = 0;

    fullTasks.forEach((t) => {
      if (t.status === 'claimed') {
        claimed++;
        done++;
      } else if (t.status === 'claimable') {
        claimable++;
        done++;
      } else if (t.progress >= t.target) {
        claimable++;
        done++;
      }
    });

    const resetsInSeconds = getISTSecondsUntilMidnight();

    return {
      dateKey,
      resetsInSeconds,
      summary: {
        total: ROOM_TASKS_CONFIG.length,
        done,
        claimable,
        claimed,
      },
      tasks: fullTasks,
    };
  }

  /**
   * Claims a completed task reward
   */
  static async claimTaskReward(roomId: string, userId: string, taskId: string) {
    const dateKey = getISTDateKey();
    let userObjId: mongoose.Types.ObjectId | null = null;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      userObjId = new mongoose.Types.ObjectId(userId);
    } else {
      const found = await User.findOne({ userId: Number(userId) || -1 }).select('_id').lean();
      if (found) userObjId = found._id as mongoose.Types.ObjectId;
    }
    if (!userObjId) throw new Error('User not found');

    const taskDoc = await RoomTaskProgress.findOne({
      roomId,
      userId: userObjId,
      dateKey,
      taskId,
    });

    if (!taskDoc) {
      throw new Error('Task progress record not found');
    }

    if (taskDoc.status === 'claimed') {
      throw new Error('Task reward has already been claimed');
    }

    if (taskDoc.progress < taskDoc.target) {
      throw new Error(`Task target not yet reached (${taskDoc.progress}/${taskDoc.target})`);
    }

    // Atomically claim and credit coins
    const currentDef = ROOM_TASKS_CONFIG.find((d) => d.id === taskId);
    const rewardToCredit = currentDef ? currentDef.reward : (taskDoc.reward || 10);
    taskDoc.reward = rewardToCredit;
    taskDoc.status = 'claimed';
    taskDoc.claimedAt = new Date();
    await taskDoc.save();

    const updatedUser = await User.findByIdAndUpdate(
      userObjId,
      { $inc: { coins: rewardToCredit } },
      { new: true }
    ).select('_id coins diamonds name');

    return {
      taskId,
      reward: rewardToCredit,
      status: 'claimed',
      claimedAt: taskDoc.claimedAt,
      newCoins: (updatedUser as any)?.coins || 0,
    };
  }

  /**
   * Records gift sending activity in the room:
   * updates task progress and updates weekly Room Support coins
   */
  static async recordGiftActivity(
    roomId: string,
    senderId: string,
    receiverIds: string[],
    diamondAmount: number
  ) {
    try {
      const dateKey = getISTDateKey();
      const senderObjId = new mongoose.Types.ObjectId(senderId);

      // Check sender creation time to know if they are a new user (< 7 days)
      const senderUser = await User.findById(senderObjId).select('createdAt');
      const isSenderNew = Boolean(
        senderUser?.createdAt &&
          Date.now() - new Date(senderUser.createdAt).getTime() < 7 * 86400000
      );

      // Check receivers creation time
      let newReceiversCount = 0;
      if (receiverIds && receiverIds.length > 0) {
        const receiverDocs = await User.find({
          _id: { $in: receiverIds.map((id) => new mongoose.Types.ObjectId(id)) },
        }).select('createdAt');

        const sevenDaysAgo = Date.now() - 7 * 86400000;
        newReceiversCount = receiverDocs.filter(
          (r) => r.createdAt && new Date(r.createdAt).getTime() >= sevenDaysAgo
        ).length;
      }

      // Update sender's gift tasks
      await this.incrementTaskProgress(roomId, senderId, 'task_gift_1', 1);
      await this.incrementTaskProgress(roomId, senderId, 'task_gift_10', 1);

      if (newReceiversCount > 0) {
        await this.incrementTaskProgress(roomId, senderId, 'task_gift_new_3', newReceiversCount);
      }

      // Track unique gifters today for room owner tasks
      const room = await Room.findOne({ channelName: roomId }).select('ownerId');
      if (room && room.ownerId) {
        const ownerId = String(room.ownerId);

        // Task: "5 users send gifts" (unique senders today who are not new)
        if (!isSenderNew) {
          const progressKey = `meta_gifters_${dateKey}`;
          const ownerTask = await RoomTaskProgress.findOne({
            roomId,
            userId: room.ownerId,
            dateKey,
            taskId: 'task_gift_users_5',
          });

          const currentGifters: string[] = ownerTask?.metadata?.gifters || [];
          if (!currentGifters.includes(senderId)) {
            currentGifters.push(senderId);
            await RoomTaskProgress.findOneAndUpdate(
              { roomId, userId: room.ownerId, dateKey, taskId: 'task_gift_users_5' },
              {
                $set: {
                  progress: Math.min(5, currentGifters.length),
                  status: currentGifters.length >= 5 ? 'claimable' : 'in_progress',
                  'metadata.gifters': currentGifters,
                },
              },
              { upsert: true }
            );
          }
        }

        // Task: "3 new users send gifts" (unique new user senders today)
        if (isSenderNew) {
          const ownerTask = await RoomTaskProgress.findOne({
            roomId,
            userId: room.ownerId,
            dateKey,
            taskId: 'task_gift_new_send_3',
          });
          const currentNewGifters: string[] = ownerTask?.metadata?.newGifters || [];
          if (!currentNewGifters.includes(senderId)) {
            currentNewGifters.push(senderId);
            await RoomTaskProgress.findOneAndUpdate(
              { roomId, userId: room.ownerId, dateKey, taskId: 'task_gift_new_send_3' },
              {
                $set: {
                  progress: Math.min(3, currentNewGifters.length),
                  status: currentNewGifters.length >= 3 ? 'claimable' : 'in_progress',
                  'metadata.newGifters': currentNewGifters,
                },
              },
              { upsert: true }
            );
          }
        }
      }

      // Update weekly Room Support statistics (roomCoins)
      const { weekKey } = getISTWeekRange(0);
      const roomOwnerId = room?.ownerId || senderObjId;

      const supportStats = await RoomSupportStats.findOneAndUpdate(
        { roomId, weekKey },
        {
          $setOnInsert: { roomOwnerId, autoSendRewards: true },
          $inc: { roomCoins: Number(diamondAmount) || 0 },
        },
        { upsert: true, new: true }
      );

      // Recalculate level
      await this.recalculateRoomSupportLevel(supportStats);
    } catch (err) {
      console.warn('[RoomTaskService] recordGiftActivity error:', err);
    }
  }

  /**
   * Records a user entry into the room:
   * updates unique visitor tasks and weekly Room Support visitors
   */
  static async recordVisitor(roomId: string, visitorId: string) {
    try {
      const dateKey = getISTDateKey();
      const room = await Room.findOne({ channelName: roomId }).select('ownerId');
      if (!room || !room.ownerId) return;

      const ownerId = String(room.ownerId);
      if (visitorId === ownerId) return; // Owner entering own room doesn't count as visitor

      const visitorUser = await User.findById(visitorId).select('createdAt');
      const isNewVisitor = Boolean(
        visitorUser?.createdAt &&
          Date.now() - new Date(visitorUser.createdAt).getTime() < 7 * 86400000
      );

      // 1. Task: 10 unique visitors
      const vTask10 = await RoomTaskProgress.findOne({
        roomId,
        userId: room.ownerId,
        dateKey,
        taskId: 'task_visitors_10',
      });
      const visitorsToday: string[] = vTask10?.metadata?.visitors || [];
      if (!visitorsToday.includes(visitorId)) {
        visitorsToday.push(visitorId);
        await RoomTaskProgress.findOneAndUpdate(
          { roomId, userId: room.ownerId, dateKey, taskId: 'task_visitors_10' },
          {
            $set: {
              progress: Math.min(10, visitorsToday.length),
              status: visitorsToday.length >= 10 ? 'claimable' : 'in_progress',
              'metadata.visitors': visitorsToday,
            },
          },
          { upsert: true }
        );
      }

      // 2. Task: 3 new visitors
      if (isNewVisitor) {
        const vTask3 = await RoomTaskProgress.findOne({
          roomId,
          userId: room.ownerId,
          dateKey,
          taskId: 'task_visitors_new_3',
        });
        const newVisitorsToday: string[] = vTask3?.metadata?.newVisitors || [];
        if (!newVisitorsToday.includes(visitorId)) {
          newVisitorsToday.push(visitorId);
          await RoomTaskProgress.findOneAndUpdate(
            { roomId, userId: room.ownerId, dateKey, taskId: 'task_visitors_new_3' },
            {
              $set: {
                progress: Math.min(3, newVisitorsToday.length),
                status: newVisitorsToday.length >= 3 ? 'claimable' : 'in_progress',
                'metadata.newVisitors': newVisitorsToday,
              },
            },
            { upsert: true }
          );
        }
      }

      // 3. Weekly Room Support unique visitors
      const { weekKey } = getISTWeekRange(0);
      const supportStats = await RoomSupportStats.findOne({ roomId, weekKey });
      const weekVisitors: string[] = supportStats?.uniqueVisitorIds || [];

      if (!weekVisitors.includes(visitorId)) {
        weekVisitors.push(visitorId);
        const updated = await RoomSupportStats.findOneAndUpdate(
          { roomId, weekKey },
          {
            $setOnInsert: { roomOwnerId: room.ownerId, autoSendRewards: true },
            $set: {
              uniqueVisitorIds: weekVisitors,
              roomVisitors: weekVisitors.length,
            },
          },
          { upsert: true, new: true }
        );
        await this.recalculateRoomSupportLevel(updated);
      }
    } catch (err) {
      console.warn('[RoomTaskService] recordVisitor error:', err);
    }
  }

  /**
   * Records follower gained:
   * updates follower tasks for the host
   */
  static async recordFollower(targetUserId: string, followerId: string, roomId?: string) {
    try {
      const dateKey = getISTDateKey();
      const targetObjId = new mongoose.Types.ObjectId(targetUserId);

      // Find active room for this user if not provided
      let roomChannel = roomId;
      if (!roomChannel) {
        const activeRoom = await Room.findOne({ ownerId: targetObjId }).select('channelName');
        roomChannel = activeRoom?.channelName || targetUserId;
      }

      const followerUser = await User.findById(followerId).select('createdAt');
      const isNewFollower = Boolean(
        followerUser?.createdAt &&
          Date.now() - new Date(followerUser.createdAt).getTime() < 7 * 86400000
      );

      await this.incrementTaskProgress(roomChannel, targetUserId, 'task_follow_1', 1);
      await this.incrementTaskProgress(roomChannel, targetUserId, 'task_follow_10', 1);

      if (isNewFollower) {
        await this.incrementTaskProgress(roomChannel, targetUserId, 'task_follow_new_3', 1);
      }
    } catch (err) {
      console.warn('[RoomTaskService] recordFollower error:', err);
    }
  }

  /**
   * Records on-mic duration (minutes)
   */
  static async recordMicDuration(roomId: string, userId: string, minutes = 1) {
    try {
      await this.incrementTaskProgress(roomId, userId, 'task_mic_10', minutes);
      await this.incrementTaskProgress(roomId, userId, 'task_mic_30', minutes);
      await this.incrementTaskProgress(roomId, userId, 'task_mic_120', minutes);
    } catch (err) {
      console.warn('[RoomTaskService] recordMicDuration error:', err);
    }
  }

  /**
   * Helper to increment a task's progress
   */
  static async incrementTaskProgress(
    roomId: string,
    userId: string,
    taskId: string,
    amount = 1
  ) {
    const dateKey = getISTDateKey();
    const userObjId = new mongoose.Types.ObjectId(userId);
    const def = ROOM_TASKS_CONFIG.find((t) => t.id === taskId);
    if (!def) return;

    let doc = await RoomTaskProgress.findOne({ roomId, userId: userObjId, dateKey, taskId });
    if (!doc) {
      doc = new RoomTaskProgress({
        roomId,
        userId: userObjId,
        dateKey,
        taskId: def.id,
        category: def.category,
        title: def.title,
        description: def.description,
        target: def.target,
        unit: def.unit,
        progress: 0,
        reward: def.reward,
        status: 'in_progress',
      });
    }

    if (doc.status === 'claimed') return; // Already claimed

    doc.progress = Math.min(doc.target, doc.progress + amount);
    if (doc.progress >= doc.target && doc.status === 'in_progress') {
      doc.status = 'claimable';
    }

    await doc.save();
    return doc;
  }

  /**
   * Recalculates reached level for a RoomSupportStats document
   */
  static async recalculateRoomSupportLevel(statsDoc: any) {
    if (!statsDoc) return;
    const coins = statsDoc.roomCoins || 0;
    const visitors = statsDoc.roomVisitors || 0;

    let reachedLevel = 0;
    let earnedBonus = 0;

    for (const lvl of ROOM_SUPPORT_LEVELS) {
      if (coins >= lvl.targetCoins && visitors >= lvl.minVisitors) {
        reachedLevel = lvl.level;
        earnedBonus = lvl.ownerReward;
      }
    }

    statsDoc.currentLevel = reachedLevel;
    statsDoc.bonusCoins = earnedBonus;
    await statsDoc.save();
  }

  /**
   * Retrieves complete Room Support stats (this week + last week + countdowns + levels + rules)
   */
  static async getRoomSupportStats(roomId: string, userId: string) {
    const room = await Room.findOne({ channelName: roomId });
    const roomOwnerId = room?.ownerId || new mongoose.Types.ObjectId(userId);

    const { weekKey: thisWeekKey } = getISTWeekRange(0);
    const { weekKey: lastWeekKey } = getISTWeekRange(-1);

    const thisWeekDoc = await RoomSupportStats.findOne({ roomId, weekKey: thisWeekKey }).lean();
    const lastWeekDoc = await RoomSupportStats.findOne({ roomId, weekKey: lastWeekKey }).lean();

    const thisWeek = {
      bonusCoins: thisWeekDoc?.bonusCoins || 0,
      roomVisitors: thisWeekDoc?.roomVisitors || 0,
      roomCoins: thisWeekDoc?.roomCoins || 0,
      currentLevel: thisWeekDoc?.currentLevel || 0,
    };

    const lastWeek = {
      bonusCoins: lastWeekDoc?.bonusCoins || 0,
      roomVisitors: lastWeekDoc?.roomVisitors || 0,
      roomCoins: lastWeekDoc?.roomCoins || 0,
      currentLevel: lastWeekDoc?.currentLevel || 0,
    };

    const rewardSendTimeSeconds = getISTSecondsUntilRewardSend();
    const thisWeekCountdownSeconds = getISTSecondsUntilWeekEnd();
    const autoSendRewards = thisWeekDoc?.autoSendRewards ?? true;

    return {
      roomId,
      myRoom: {
        thisWeek,
        lastWeek,
      },
      rewardSendTimeSeconds,
      thisWeekCountdownSeconds,
      autoSendRewards,
      targetAndReward: ROOM_SUPPORT_LEVELS,
      rules: ROOM_SUPPORT_RULES,
    };
  }

  /**
   * Toggles autoSendRewards flag
   */
  static async toggleAutoSendRewards(roomId: string, autoSend: boolean) {
    const { weekKey } = getISTWeekRange(0);
    const updated = await RoomSupportStats.findOneAndUpdate(
      { roomId, weekKey },
      { $set: { autoSendRewards: autoSend } },
      { upsert: true, new: true }
    );
    return { autoSendRewards: updated.autoSendRewards };
  }
}
