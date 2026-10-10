import { Request, Response } from 'express';
import agoraToken from 'agora-token';
const { RtcTokenBuilder, RtcRole } = agoraToken;
import { getAgoraCredentials } from './settingsController';

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
import redis from '../configs/redisConfig';

const normalizeRoomId = (id: string): string => {
  const clean = String(id || '').trim();
  if (/^10000\d{3}$/.test(clean)) {
    const lastDigits = clean.slice(5);
    return `100000000${lastDigits}`.slice(-10);
  }
  return clean;
};

export const getAllActiveVoiceRooms = async (req: Request, res: Response) => {
  try {
    const { category, search, country, limit = 50 } = req.query;
    const filter: any = { isActive: { $ne: false } };
    if (category && category !== 'All' && category !== 'Popular') {
      filter.category = category;
    }
    if (typeof country === 'string' && country.trim()) {
      const trimmedCountry = country.trim();
      const escapedCountry = trimmedCountry.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const countryRegex = new RegExp(`^${escapedCountry}$`, 'i');
      const isIndia = /^india$/i.test(trimmedCountry) || /^in$/i.test(trimmedCountry);

      const userConditions: any[] = [
        { 'country.name': countryRegex },
        { 'country.code': countryRegex },
        { 'country': countryRegex },
      ];

      // Default fallback: if filtering for India, also match users with no country set
      if (isIndia) {
        userConditions.push(
          { 'country.name': { $in: ['', null] } },
          { 'country': { $in: ['', null] } },
          { country: { $exists: false } }
        );
      }

      const owners = await User.find({ $or: userConditions }).select('_id').lean();
      filter.ownerId = { $in: owners.map(owner => owner._id) };
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
      .populate('ownerId', 'userId name image avatar gender meethiId country')
      .sort({ updatedAt: -1 })
      .limit(Math.max(Number(limit) * 2, 100))
      .lean();

    // Query Redis for live room states
    const roomKeys = rooms.map((r: any) => `voice_room:${normalizeRoomId(r.channelName)}`);
    let redisStates: (string | null)[] = [];
    try {
      if (roomKeys.length > 0) {
        redisStates = await redis.mget(roomKeys);
      }
    } catch (e) {
      console.warn('[getAllActiveVoiceRooms] Redis mget warning:', e);
    }

    const formattedRooms: any[] = [];

    rooms.forEach((r: any, idx: number) => {
      let onlineCount = 0;
      const rawState = redisStates[idx];
      if (rawState) {
        try {
          const parsed = JSON.parse(rawState);
          if (parsed?.onlineUsers && typeof parsed.onlineUsers === 'object') {
            onlineCount = Object.keys(parsed.onlineUsers).length;
          }
          if (onlineCount === 0 && Array.isArray(parsed?.seats)) {
            onlineCount = parsed.seats.filter((s: any) => Boolean(s.user)).length;
          }
        } catch (_) {}
      }

      const isPinned = Boolean(r.isPinned);
      const pinnedOrder = Number(r.pinnedOrder || 0);

      // Rule: "and agar us room me koe nhi to room dikhe hi nhi... chahe un room me koe ho ya na ho lekin room pin me rahe"
      // If 0 users and NOT pinned, hide the room completely!
      if (onlineCount === 0 && !isPinned) {
        return;
      }

      const owner = r.ownerId || {};
      const hostId = String(owner.userId || owner.meethiId || owner._id || r.channelName);

      formattedRooms.push({
        id: r.channelName, // room ID is user ID
        roomId: r.channelName,
        title: r.title,
        about: r.about || '',
        hostName: owner.name || 'Host',
        hostId,
        country: owner.country?.name || (typeof owner.country === 'string' ? owner.country : '') || (r as any).country || 'India',
        flag: owner.country?.flag || (r as any).flag || '🇮🇳',
        ownerId: owner._id,
        coverImage: r.coverImage || owner.image || owner.avatar || '',
        onlineCount: String(onlineCount > 0 ? onlineCount : (isPinned ? 0 : 1)),
        category: r.category || 'Chat 💬',
        mode: r.mode || 'Public',
        seatCount: r.seatCount || 8,
        isActive: r.isActive,
        isPinned,
        pinnedOrder,
        pinnedAt: r.pinnedAt,
      });
    });

    // Sort: Pinned rooms first by pinnedOrder ASC (1, 2, 3...), then by onlineCount DESC, then updatedAt
    formattedRooms.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      if (a.isPinned && b.isPinned) {
        if (a.pinnedOrder !== b.pinnedOrder) {
          return a.pinnedOrder - b.pinnedOrder;
        }
        return new Date(b.pinnedAt || 0).getTime() - new Date(a.pinnedAt || 0).getTime();
      }
      return Number(b.onlineCount) - Number(a.onlineCount);
    });

    const finalRooms = formattedRooms.slice(0, Number(limit));

    return res.status(200).json({
      success: true,
      data: {
        rooms: finalRooms,
        total: finalRooms.length,
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
      .populate('ownerId', 'userId name image avatar gender meethiId country equippedFrame equippedFrameAsset')
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
          country: owner.country?.name || '',
          flag: owner.country?.flag || '',
          ownerId: owner._id || user.id,
          coverImage: (room as any).coverImage || owner.image || user.image || '',
          hostEquippedFrame: owner.equippedFrameAsset || owner.equippedFrame || null,
          hostEquippedFrameAsset: owner.equippedFrameAsset || null,
          onlineCount: '1',
          category: room.category || 'Chat 💬',
          mode: (room as any).mode || 'Public',
          seatCount: (room as any).seatCount || 8,
          showSeatCharm: Boolean((room as any).showSeatCharm),
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
      hostEquippedFrame: user.equippedFrameAsset || user.equippedFrame || null,
      hostEquippedFrameAsset: user.equippedFrameAsset || null,
      onlineCount: '1',
      category: room.category || 'Chat 💬',
      mode: (room as any).mode || 'Public',
      seatCount: (room as any).seatCount || 8,
      showSeatCharm: Boolean((room as any).showSeatCharm),
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

export const getVoiceRoomToken = async (req: Request, res: Response) => {
  try {
    const { id: roomId } = req.params;
    const userId = (req as any).user?._id || (req as any).user?.id || req.query.userId || req.body.userId;
    const isPublisher = req.query.role === 'broadcaster' || req.body.role === 'broadcaster' || true;

    const agoraCredentials = await getAgoraCredentials();
    const APP_ID = agoraCredentials.appId || process.env.AGORA_APP_ID || 'd23c897f9305450faa7809ffcf666e57';
    const APP_CERTIFICATE = agoraCredentials.certificate || process.env.APP_CERTIFICATE || '1b562d3ec8134249bda984e72d02213c';

    // Channel name for the voice room
    const channelName = `voiceroom_${roomId}`;

    // Numeric UID for Agora RTC
    let agoraUid = 0;
    if (userId) {
      const numericStr = String(userId).replace(/\D/g, '').slice(-8);
      agoraUid = numericStr ? parseInt(numericStr, 10) : Math.floor(Math.random() * 1e8) + 1000;
    } else {
      agoraUid = Math.floor(Math.random() * 1e8) + 1000;
    }

    const tokenExpireSeconds = 86400; // 24 hours validity

    let token = '';
    if (APP_CERTIFICATE) {
      token = RtcTokenBuilder.buildTokenWithUid(
        APP_ID,
        APP_CERTIFICATE,
        channelName,
        agoraUid,
        isPublisher ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER,
        tokenExpireSeconds,
        tokenExpireSeconds
      );
    }

    return res.status(200).json({
      success: true,
      data: {
        appId: APP_ID,
        channelName,
        agoraUid,
        token,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

