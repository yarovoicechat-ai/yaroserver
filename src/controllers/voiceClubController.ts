import { Request, Response } from 'express';

export const getVoiceClubConfig = async (req: Request, res: Response) => {
  try {
    return res.status(200).json({
      success: true,
      data: {
        appName: 'Yaro',
        package: 'yaro.vc.app',
        deepLinkScheme: 'voiceclub://',
        version: '2.0.0',
        features: {
          voiceCallsEnabled: true,
          videoCallsEnabled: true,
          giftExchangeEnabled: true,
          vipLoungesEnabled: true,
          instantMatchingEnabled: true,
        },
        bannerNotice: 'Welcome to Yaro! Connect with vibrant hosts instantly.',
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const joinVoiceQueue = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id || req.body.userId;
    const { preferredLanguage, callType } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    return res.status(200).json({
      success: true,
      message: 'Successfully queued for Yaro audio lounge match',
      data: {
        queueTicketId: `VCQ-${Date.now()}-${userId.toString().slice(-4)}`,
        status: 'WAITING',
        estimatedWaitSeconds: 15,
        preferredLanguage: preferredLanguage || 'English',
        callType: callType || 'voice',
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getVipRewards = async (req: Request, res: Response) => {
  try {
    return res.status(200).json({
      success: true,
      data: {
        tiers: [
          { name: 'Bronze Club', minCoinsSpent: 1000, callDiscountPercent: 5, badgeUrl: '/uploads/badges/bronze.png' },
          { name: 'Silver Club', minCoinsSpent: 5000, callDiscountPercent: 10, badgeUrl: '/uploads/badges/silver.png' },
          { name: 'Gold Club', minCoinsSpent: 20000, callDiscountPercent: 15, badgeUrl: '/uploads/badges/gold.png' },
          { name: 'Diamond VIP Club', minCoinsSpent: 100000, callDiscountPercent: 25, badgeUrl: '/uploads/badges/diamond.png' },
        ],
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

import { Room } from '../models/room.model';
import { User } from '../models/user.model';

export const getAllActiveVoiceRooms = async (req: Request, res: Response) => {
  try {
    const { category, search, limit = 50 } = req.query;
    const filter: any = { isActive: { $ne: false } };
    if (category && category !== 'All' && category !== 'Popular') {
      filter.category = category;
    }
    if (search) {
      const searchStr = String(search).trim();
      const escaped = searchStr.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');

      const userOr: any[] = [
        { name: regex },
        { userName: regex },
        { meethiId: regex },
        {
          $expr: {
            $regexMatch: {
              input: { $toString: "$userId" },
              regex: escaped,
              options: "i",
            },
          },
        },
      ];
      if (!isNaN(Number(searchStr))) {
        userOr.push({ userId: Number(searchStr) });
      }
      const matchingUsers = await User.find({ $or: userOr }).select('_id').lean();
      const matchingUserIds = matchingUsers.map(u => u._id);

      filter.$or = [
        { title: regex },
        { channelName: regex },
        { category: regex },
        { about: regex },
        ...(matchingUserIds.length ? [{ ownerId: { $in: matchingUserIds } }] : []),
      ];
    }
    const rooms = await Room.find(filter)
      .populate('ownerId', 'userId name image avatar gender meethiId')
      .sort({ updatedAt: -1 })
      .limit(Number(limit))
      .lean();

    const formattedRooms = rooms.map((r: any) => {
      const owner = r.ownerId || {};
      const hostId = String(owner.userId || owner.meethiId || owner._id || r.channelName);
      return {
        id: r.channelName, // room ID is user ID
        roomId: r.channelName,
        title: r.title,
        about: r.about || '',
        hostName: owner.name || 'Host',
        hostId,
        ownerId: owner._id,
        coverImage: r.coverImage || owner.image || owner.avatar || '',
        onlineCount: r.members?.length ? String(r.members.length) : '1',
        category: r.category || 'Chat 💬',
        mode: r.mode || 'Public',
        seatCount: r.seatCount || 8,
        isActive: r.isActive,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        rooms: formattedRooms,
        total: formattedRooms.length,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getMyVoiceRoom = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const room = await Room.findOne({ ownerId: user.id || user._id })
      .populate('ownerId', 'userId name image avatar gender meethiId')
      .lean();

    if (!room) {
      return res.status(200).json({
        success: true,
        data: { exists: false, room: null },
      });
    }

    const owner = (room.ownerId as any) || {};
    const hostId = String(owner.userId || owner.meethiId || owner._id || room.channelName);

    return res.status(200).json({
      success: true,
      data: {
        exists: true,
        room: {
          id: room.channelName,
          roomId: room.channelName,
          title: room.title,
          about: (room as any).about || '',
          hostName: owner.name || user.name || 'You',
          hostId,
          ownerId: owner._id || user.id,
          coverImage: (room as any).coverImage || owner.image || user.image || '',
          onlineCount: '1',
          category: room.category || 'Chat 💬',
          mode: (room as any).mode || 'Public',
          seatCount: (room as any).seatCount || 8,
          isSelfHost: true,
        },
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createOrUpdateMyVoiceRoom = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const roomChannelId = String(user.userId || user.meethiId || user.id || user._id);
    const { title, about, coverImage, category, seatCount, mode } = req.body || {};

    let room = await Room.findOne({ ownerId: user.id || user._id });

    if (!room) {
      room = await Room.create({
        title: title || (user.name ? `${user.name}'s Party Club 🎶` : 'My Voice Party 🎵'),
        channelName: roomChannelId,
        ownerId: user.id || user._id,
        category: category || 'Chat 💬',
        seatCount: seatCount || 8,
        coverImage: coverImage || user.image || '',
        about: about || 'Welcome to my party! Grab a seat and chat 💕',
        mode: mode || 'Public',
        isActive: true,
      });
    } else {
      room.isActive = true;
      room.channelName = roomChannelId; // Ensure roomId == userId
      if (title) room.title = title;
      if (about) (room as any).about = about;
      if (coverImage) (room as any).coverImage = coverImage;
      if (category) room.category = category;
      if (seatCount) (room as any).seatCount = seatCount;
      if (mode) (room as any).mode = mode;
      await room.save();
    }

    const hostId = String(user.userId || user.meethiId || user.id || user._id);
    const formatted = {
      id: room.channelName,
      roomId: room.channelName,
      title: room.title,
      about: (room as any).about || '',
      hostName: user.name || 'You',
      hostId,
      ownerId: user.id || user._id,
      coverImage: (room as any).coverImage || user.image || '',
      onlineCount: '1',
      category: room.category || 'Chat 💬',
      mode: (room as any).mode || 'Public',
      seatCount: (room as any).seatCount || 8,
      isSelfHost: true,
    };

    return res.status(200).json({
      success: true,
      message: 'Room ready',
      data: { room: formatted },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const closeVoiceRoom = async (req: any, res: Response) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    await Room.findOneAndUpdate(
      { ownerId: user.id || user._id },
      { $set: { isActive: false } }
    );

    return res.status(200).json({
      success: true,
      message: 'Room closed',
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
