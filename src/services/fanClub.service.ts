import mongoose from 'mongoose';
import { FanClubMember } from '../models/fanClubMember.model';
import { Room } from '../models/room.model';
import { User } from '../models/user.model';
import { normalizeRoomId } from './roomContribution.service';

export interface IFanClubBadge {
  grade: 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Diamond';
  subTier: 1 | 2 | 3;
  label: string;
  stars: number;
  color: string;
  ribbonColor: string;
}

export function getFanClubBadge(exp: number): IFanClubBadge {
  const points = Math.max(0, Number(exp) || 0);

  // Exact user thresholds:
  // 0 - 10k: Bronze 1
  // 10k - 20k: Bronze 2
  // 20k - 40k: Bronze 3
  if (points < 10000) {
    return { grade: 'Bronze', subTier: 1, label: 'Bronze 1', stars: 1, color: '#CD7F32', ribbonColor: '#92400E' };
  } else if (points < 20000) {
    return { grade: 'Bronze', subTier: 2, label: 'Bronze 2', stars: 2, color: '#CD7F32', ribbonColor: '#92400E' };
  } else if (points < 40000) {
    return { grade: 'Bronze', subTier: 3, label: 'Bronze 3', stars: 3, color: '#CD7F32', ribbonColor: '#92400E' };
  }
  // 40k - 70k: Silver 1
  // 70k - 110k: Silver 2
  // 110k - 170k: Silver 3
  else if (points < 70000) {
    return { grade: 'Silver', subTier: 1, label: 'Silver 1', stars: 1, color: '#94A3B8', ribbonColor: '#64748B' };
  } else if (points < 110000) {
    return { grade: 'Silver', subTier: 2, label: 'Silver 2', stars: 2, color: '#94A3B8', ribbonColor: '#64748B' };
  } else if (points < 170000) {
    return { grade: 'Silver', subTier: 3, label: 'Silver 3', stars: 3, color: '#CBD5E1', ribbonColor: '#475569' };
  }
  // 170k - 240k: Gold 1
  // 240k - 350k: Gold 2
  // 350k - 500k: Gold 3
  else if (points < 240000) {
    return { grade: 'Gold', subTier: 1, label: 'Gold 1', stars: 1, color: '#F59E0B', ribbonColor: '#D97706' };
  } else if (points < 350000) {
    return { grade: 'Gold', subTier: 2, label: 'Gold 2', stars: 2, color: '#F59E0B', ribbonColor: '#D97706' };
  } else if (points < 500000) {
    return { grade: 'Gold', subTier: 3, label: 'Gold 3', stars: 3, color: '#FBBF24', ribbonColor: '#B45309' };
  }
  // 500k - 700k: Platinum 1
  // 700k - 1M: Platinum 2
  // 1M - 1.5M: Platinum 3
  else if (points < 700000) {
    return { grade: 'Platinum', subTier: 1, label: 'Platinum 1', stars: 1, color: '#6366F1', ribbonColor: '#4F46E5' };
  } else if (points < 1000000) {
    return { grade: 'Platinum', subTier: 2, label: 'Platinum 2', stars: 2, color: '#6366F1', ribbonColor: '#4F46E5' };
  } else if (points < 1500000) {
    return { grade: 'Platinum', subTier: 3, label: 'Platinum 3', stars: 3, color: '#818CF8', ribbonColor: '#4338CA' };
  }
  // 1.5M - 2.5M: Diamond 1
  // 2.5M - 1CR (10,000,000): Diamond 2
  // 1CR+ (or 2CR+): Diamond 3 (unlimited)
  else if (points < 2500000) {
    return { grade: 'Diamond', subTier: 1, label: 'Diamond 1', stars: 1, color: '#EC4899', ribbonColor: '#DB2777' };
  } else if (points < 10000000) {
    return { grade: 'Diamond', subTier: 2, label: 'Diamond 2', stars: 2, color: '#F43F5E', ribbonColor: '#E11D48' };
  } else {
    return { grade: 'Diamond', subTier: 3, label: 'Diamond 3', stars: 3, color: '#E11D48', ribbonColor: '#BE123C' };
  }
}

export function calculateFanTier(exp: number): number {
  const badge = getFanClubBadge(exp);
  switch (badge.grade) {
    case 'Diamond':
      return 5;
    case 'Platinum':
      return 4;
    case 'Gold':
      return 3;
    case 'Silver':
      return 2;
    default:
      return 1;
  }
}

export function getFanTierName(tier: number): string {
  switch (tier) {
    case 5:
      return 'Diamond Fan';
    case 4:
      return 'Platinum Fan';
    case 3:
      return 'Gold Fan';
    case 2:
      return 'Silver Fan';
    default:
      return 'Bronze Fan';
  }
}

export class FanClubService {
  /**
   * Retrieves fan club membership details, active member list, and real EXP
   */
  static async getFanClubInfo(roomId: string, currentUserId?: string) {
    const cleanRoomId = normalizeRoomId(roomId);

    // Resolve room and owner
    const room = await Room.findOne({
      $or: [
        { channelName: cleanRoomId },
        { channelName: String(roomId).trim() },
        ...(mongoose.Types.ObjectId.isValid(roomId) ? [{ _id: new mongoose.Types.ObjectId(roomId) }] : []),
      ],
    })
      .select('_id title coverImage ownerId')
      .populate('ownerId', '_id userId name image avatar')
      .lean();

    const owner: any = room?.ownerId || null;
    const ownerIdStr = owner ? String(owner._id || owner.userId || '') : '';

    let isJoined = false;
    let currentUserMembership: any = null;

    let userObjId: mongoose.Types.ObjectId | null = null;
    if (currentUserId) {
      if (mongoose.Types.ObjectId.isValid(currentUserId)) {
        userObjId = new mongoose.Types.ObjectId(currentUserId);
      } else {
        const found = await User.findOne({
          $or: [{ userId: Number(currentUserId) || -1 }, { meethiId: String(currentUserId) }],
        }).select('_id').lean();
        if (found) userObjId = found._id as mongoose.Types.ObjectId;
      }
    }

    // Room owner is automatically a member
    if (userObjId && ownerIdStr && (String(userObjId) === ownerIdStr || String(currentUserId) === ownerIdStr)) {
      isJoined = true;
    }

    if (userObjId) {
      const memberDoc = await FanClubMember.findOne({
        $or: [{ roomId: cleanRoomId }, { roomId: String(roomId).trim() }],
        userId: userObjId,
        isActive: true,
        expiresAt: { $gt: new Date() },
      }).lean();

      if (memberDoc) {
        isJoined = true;
        const curExp = memberDoc.exp || 0;
        const curBadge = getFanClubBadge(curExp);
        currentUserMembership = {
          tier: memberDoc.tier || calculateFanTier(curExp),
          tierName: curBadge.label,
          badge: curBadge,
          exp: curExp,
          stayMinutes: memberDoc.stayMinutes || 0,
          diamondsSent: memberDoc.diamondsSent || 0,
          joinedAt: memberDoc.joinedAt,
          expiresAt: memberDoc.expiresAt,
        };
      }
    }

    // Fetch all real active members sorted by EXP descending
    const memberDocs = await FanClubMember.find({
      $or: [{ roomId: cleanRoomId }, { roomId: String(roomId).trim() }],
      isActive: true,
      expiresAt: { $gt: new Date() },
    })
      .sort({ exp: -1 })
      .limit(100)
      .populate('userId', '_id userId name image avatar')
      .lean();

    const members: any[] = [];
    let hasOwnerInList = false;

    memberDocs.forEach((doc: any, index: number) => {
      const u: any = doc.userId;
      if (!u) return;
      const isItemOwner = ownerIdStr && String(u._id) === ownerIdStr;
      if (isItemOwner) hasOwnerInList = true;

      const memberExp = Number(doc.exp || 0);
      const tier = doc.tier || calculateFanTier(memberExp);
      const badge = getFanClubBadge(memberExp);

      members.push({
        id: String(u._id),
        _id: String(u._id),
        userId: u.userId || String(u._id),
        name: u.name || `Member #${index + 1}`,
        avatar: u.avatar || u.image || '',
        exp: memberExp,
        stayMinutes: doc.stayMinutes || 0,
        diamondsSent: doc.diamondsSent || 0,
        tier,
        tierName: badge.label,
        badge,
        isOwner: isItemOwner,
        joinedAt: doc.joinedAt,
      });
    });

    // If owner is not in memberDocs, add owner at the top
    if (owner && !hasOwnerInList) {
      members.unshift({
        id: String(owner._id),
        _id: String(owner._id),
        userId: owner.userId || String(owner._id),
        name: owner.name || 'Room Host',
        avatar: owner.avatar || owner.image || room?.coverImage || '',
        exp: 0,
        stayMinutes: 0,
        diamondsSent: 0,
        tier: 5,
        tierName: 'Club Host',
        badge: { grade: 'Diamond', subTier: 3, label: 'Club Host', stars: 3, color: '#E11D48', ribbonColor: '#BE123C' },
        isOwner: true,
        joinedAt: room?.createdAt || new Date(),
      });
    }

    return {
      roomId: cleanRoomId,
      roomTitle: room?.title || 'Voice Room',
      owner: owner
        ? {
            id: String(owner._id),
            userId: owner.userId,
            name: owner.name,
            avatar: owner.avatar || owner.image || '',
          }
        : null,
      isJoined,
      currentUserMembership,
      membersCount: members.length,
      members,
    };
  }

  /**
   * Joins a room's fan club
   */
  static async joinFanClub(
    roomId: string,
    userId: string,
    plan: '1_month' | '3_months' = '1_month'
  ) {
    const cleanRoomId = normalizeRoomId(roomId);

    let userObjId: mongoose.Types.ObjectId | null = null;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      userObjId = new mongoose.Types.ObjectId(userId);
    } else {
      const found = await User.findOne({
        $or: [{ userId: Number(userId) || -1 }, { meethiId: String(userId) }],
      }).select('_id').lean();
      if (found) userObjId = found._id as mongoose.Types.ObjectId;
    }
    if (!userObjId) throw new Error('User not found');

    const room = await Room.findOne({
      $or: [
        { channelName: cleanRoomId },
        { channelName: String(roomId).trim() },
        ...(mongoose.Types.ObjectId.isValid(roomId) ? [{ _id: new mongoose.Types.ObjectId(roomId) }] : []),
      ],
    }).select('ownerId');

    const hostId = (room?.ownerId as mongoose.Types.ObjectId) || userObjId;

    const days = plan === '3_months' ? 90 : 30;
    const cost = plan === '3_months' ? 249 : 99;

    const sender = await User.findById(userObjId).select('diamonds');
    const availableDiamonds = Number(sender?.diamonds || 0);

    if (availableDiamonds < cost) {
      const err: any = new Error(
        `Insufficient Diamonds. Required: ${cost} 💎, Available: ${availableDiamonds} 💎`
      );
      err.code = 'INSUFFICIENT_DIAMONDS';
      throw err;
    }

    // Deduct diamonds atomically
    await User.findByIdAndUpdate(userObjId, { $inc: { diamonds: -cost } });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 86400000);

    const memberDoc = await FanClubMember.findOneAndUpdate(
      {
        roomId: cleanRoomId,
        userId: userObjId,
      },
      {
        $set: {
          hostId,
          joinedAt: now,
          expiresAt,
          isActive: true,
        },
        $inc: { exp: 100 }, // 100 initial bonus exp for joining
      },
      { upsert: true, new: true }
    );

    const tier = calculateFanTier(memberDoc.exp);
    if (memberDoc.tier !== tier) {
      memberDoc.tier = tier;
      await memberDoc.save();
    }

    return {
      success: true,
      isJoined: true,
      membership: {
        tier,
        tierName: getFanTierName(tier),
        exp: memberDoc.exp,
        stayMinutes: memberDoc.stayMinutes,
        diamondsSent: memberDoc.diamondsSent,
        joinedAt: memberDoc.joinedAt,
        expiresAt: memberDoc.expiresAt,
      },
      message: 'Successfully joined the Fan Club!',
    };
  }

  /**
   * Increases Fan Club EXP based on STAY time in the room (e.g. 1 min = 10 EXP)
   */
  static async recordStay(roomId: string, userId: string, minutes: number = 1) {
    if (!roomId || !userId || minutes <= 0) return;

    try {
      const cleanRoomId = normalizeRoomId(roomId);
      let userObjId: mongoose.Types.ObjectId | null = null;
      if (mongoose.Types.ObjectId.isValid(userId)) {
        userObjId = new mongoose.Types.ObjectId(userId);
      } else {
        const found = await User.findOne({
          $or: [{ userId: Number(userId) || -1 }, { meethiId: String(userId) }],
        }).select('_id').lean();
        if (found) userObjId = found._id as mongoose.Types.ObjectId;
      }
      if (!userObjId) return;

      const expGain = Math.max(1, Math.round(minutes * 10)); // 10 EXP per minute of stay

      const updated = await FanClubMember.findOneAndUpdate(
        {
          $or: [{ roomId: cleanRoomId }, { roomId: String(roomId).trim() }],
          userId: userObjId,
          isActive: true,
          expiresAt: { $gt: new Date() },
        },
        {
          $inc: {
            exp: expGain,
            stayMinutes: minutes,
          },
        },
        { new: true }
      );

      if (updated) {
        const newTier = calculateFanTier(updated.exp);
        if (updated.tier !== newTier) {
          await FanClubMember.findByIdAndUpdate(updated._id, { tier: newTier });
        }
      }
    } catch (err: any) {
      console.warn('[FanClubService] recordStay error:', err?.message);
    }
  }

  /**
   * Increases Fan Club EXP based on SENDING gifts in the room (e.g. 1 Diamond = 1 EXP)
   */
  static async recordSending(roomId: string, userId: string, diamonds: number) {
    if (!roomId || !userId || diamonds <= 0) return;

    try {
      const cleanRoomId = normalizeRoomId(roomId);
      let userObjId: mongoose.Types.ObjectId | null = null;
      if (mongoose.Types.ObjectId.isValid(userId)) {
        userObjId = new mongoose.Types.ObjectId(userId);
      } else {
        const found = await User.findOne({
          $or: [{ userId: Number(userId) || -1 }, { meethiId: String(userId) }],
        }).select('_id').lean();
        if (found) userObjId = found._id as mongoose.Types.ObjectId;
      }
      if (!userObjId) return;

      const expGain = Math.round(diamonds); // 1 Diamond = 1 EXP

      const updated = await FanClubMember.findOneAndUpdate(
        {
          $or: [{ roomId: cleanRoomId }, { roomId: String(roomId).trim() }],
          userId: userObjId,
          isActive: true,
          expiresAt: { $gt: new Date() },
        },
        {
          $inc: {
            exp: expGain,
            diamondsSent: diamonds,
          },
        },
        { new: true }
      );

      if (updated) {
        const newTier = calculateFanTier(updated.exp);
        if (updated.tier !== newTier) {
          await FanClubMember.findByIdAndUpdate(updated._id, { tier: newTier });
        }
      }
    } catch (err: any) {
      console.warn('[FanClubService] recordSending error:', err?.message);
    }
  }
}
