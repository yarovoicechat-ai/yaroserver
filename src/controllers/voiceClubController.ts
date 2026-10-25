import { Request, Response } from 'express';
import { Types } from 'mongoose';
import agoraToken from 'agora-token';
const { RtcTokenBuilder, RtcRole } = agoraToken;
import { getAgoraCredentials } from './settingsController';
import { AuthRequest } from '../middlewares/authorize.middleware';
import { getVoiceRoomState } from '../sockets/voiceRoomSocket';
import { hasRoomVoicePublisherAccess } from '../utils/roomVoiceAuthorization';

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

import mongoose from 'mongoose';
import { Room } from '../models/room.model';
import { User } from '../models/user.model';
import redis from '../configs/redisConfig';
import bcrypt from 'bcryptjs';
import { getIOOptional } from '../sockets';

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
        { uniqueId: regex },
        { customDisplayId: regex },
        { displayId: regex },
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
      .populate('ownerId', 'userId name image avatar gender meethiId country uniqueId customDisplayId displayId storeInventory equippedCustomId')
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
        } catch (_) {}
      }

      const isPinned = Boolean(r.isPinned);
      const pinnedOrder = Number(r.pinnedOrder || 0);

      // Rule: "and agar us room me koe nhi to room dikhe hi nhi... chahe un room me koe ho ya na ho lekin room pin me rahe"
      // If 0 users and NOT pinned, hide the room completely!
      if (onlineCount === 0 && !isPinned) {
        return;
      }

      const owner = (r.ownerId as any) || {};
      const hostId = String(owner.userId || owner.meethiId || owner._id || r.channelName);
      const uniqueId = String(owner.uniqueId || owner.customDisplayId || owner.displayId || (r as any).uniqueId || '').trim();
      const displayRoomId = uniqueId || r.channelName;

      let badgeUrl = String((r as any).badgeUrl || (r as any).badgeIconUrl || '').trim();
      if (/frame/i.test(badgeUrl)) badgeUrl = '';
      let uniqueIdBadge = (r as any).uniqueIdBadge || null;
      if (uniqueIdBadge?.badgeIconUrl && /frame/i.test(uniqueIdBadge.badgeIconUrl)) {
        uniqueIdBadge = null;
      }
      if (!badgeUrl && owner) {
        const inventoryList = Array.isArray(owner.storeInventory) ? owner.storeInventory : [];
        const targetId = String(owner.customDisplayId || owner.equippedCustomId || uniqueId || '').trim();
        const uniqueInv = inventoryList.find((it: any) => {
          const cat = String(it.category || it.type || '').toLowerCase().trim();
          if (/frame|theme|bubble|tassel|wave|skin|entry|vehicle/i.test(cat)) return false;
          const isBadgeCategory = ['unique id', 'unique_id', 'custom id', 'custom_id', 'badge', 'id'].includes(cat);
          const itemDisplayId = String(it.metadata?.uniqueDisplayId || it.metadata?.displayId || it.uniqueId || '').trim();
          const matchesId = Boolean(targetId && itemDisplayId && targetId === itemDisplayId);
          return isBadgeCategory || matchesId;
        });
        const candidateBadgeUrl = String(uniqueInv?.metadata?.badgeIconUrl || uniqueInv?.metadata?.badgeUrl || (['unique id', 'unique_id', 'badge', 'custom id'].includes(String(uniqueInv?.category || '').toLowerCase()) ? (uniqueInv?.animationUrl || uniqueInv?.imageUrl) : '') || '').trim();
        if (candidateBadgeUrl && !/frame/i.test(candidateBadgeUrl)) {
          badgeUrl = candidateBadgeUrl;
          uniqueIdBadge = {
            badgeName: uniqueInv?.metadata?.badgeName || 'VIP ID',
            badgeIconUrl: badgeUrl,
            animationType: 'svga',
          };
        }
      }

      formattedRooms.push({
        id: r.channelName, // room ID is user ID
        roomId: r.channelName,
        uniqueId: uniqueId,
        displayRoomId: displayRoomId,
        badgeUrl: badgeUrl,
        uniqueIdBadge: uniqueIdBadge,
        title: r.title,
        about: r.about || '',
        hostName: owner.name || 'Host',
        hostId,
        country: owner.country?.name || (typeof owner.country === 'string' ? owner.country : '') || (r as any).country || 'India',
        flag: owner.country?.flag || (r as any).flag || '🇮🇳',
        ownerId: owner._id,
        coverImage: r.coverImage || owner.image || owner.avatar || '',
        onlineCount: String(onlineCount),
        category: r.category || 'Chat 💬',
        mode: r.mode || 'Public',
        isLocked: Boolean((r as any).isLocked || /private\s*\(pin\)/i.test(String((r as any).mode || ''))),
        hasPin: Boolean((r as any).pinHash || (r as any).isLocked),
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
      .select('+pinHash')
      .populate('ownerId', 'userId name image avatar gender meethiId country equippedFrame equippedFrameAsset uniqueId customDisplayId displayId storeInventory equippedCustomId')
      .lean();

    if (!room) {
      return res.status(200).json({
        success: true,
        data: { exists: false, room: null },
      });
    }

    const owner = (room.ownerId as any) || {};
    const hostId = String(owner.userId || owner.meethiId || owner._id || room.channelName);
    const ownerUniqueId = String(owner.uniqueId || owner.customDisplayId || owner.displayId || user.uniqueId || user.customDisplayId || user.displayId || '').trim();
    const displayRoomId = ownerUniqueId || room.channelName;

    let badgeUrl = String((room as any).badgeUrl || (room as any).badgeIconUrl || '').trim();
    if (/frame/i.test(badgeUrl)) badgeUrl = '';
    let uniqueIdBadge = (room as any).uniqueIdBadge || null;
    if (uniqueIdBadge?.badgeIconUrl && /frame/i.test(uniqueIdBadge.badgeIconUrl)) {
      uniqueIdBadge = null;
    }
    if (!badgeUrl && owner) {
      const inventoryList = Array.isArray(owner.storeInventory) ? owner.storeInventory : (Array.isArray(user.storeInventory) ? user.storeInventory : []);
      const targetId = String(owner.customDisplayId || user.customDisplayId || owner.equippedCustomId || user.equippedCustomId || ownerUniqueId || '').trim();
      const uniqueInv = inventoryList.find((it: any) => {
        const cat = String(it.category || it.type || '').toLowerCase().trim();
        if (/frame|theme|bubble|tassel|wave|skin|entry|vehicle/i.test(cat)) return false;
        const isBadgeCategory = ['unique id', 'unique_id', 'custom id', 'custom_id', 'badge', 'id'].includes(cat);
        const itemDisplayId = String(it.metadata?.uniqueDisplayId || it.metadata?.displayId || it.uniqueId || '').trim();
        const matchesId = Boolean(targetId && itemDisplayId && targetId === itemDisplayId);
        return isBadgeCategory || matchesId;
      });
      const candidateBadgeUrl = String(uniqueInv?.metadata?.badgeIconUrl || uniqueInv?.metadata?.badgeUrl || (['unique id', 'unique_id', 'badge', 'custom id'].includes(String(uniqueInv?.category || '').toLowerCase()) ? (uniqueInv?.animationUrl || uniqueInv?.imageUrl) : '') || '').trim();
      if (candidateBadgeUrl && !/frame/i.test(candidateBadgeUrl)) {
        badgeUrl = candidateBadgeUrl;
        uniqueIdBadge = {
          badgeName: uniqueInv?.metadata?.badgeName || 'VIP ID',
          badgeIconUrl: badgeUrl,
          animationType: 'svga',
        };
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        exists: true,
        room: {
          id: room.channelName,
          roomId: room.channelName,
          uniqueId: ownerUniqueId,
          displayRoomId: displayRoomId,
          badgeUrl: badgeUrl,
          uniqueIdBadge: uniqueIdBadge,
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
          onlineCount: '0',
          category: room.category || 'Chat 💬',
          mode: (room as any).mode || 'Public',
          isLocked: Boolean((room as any).isLocked || /private\s*\(pin\)/i.test(String((room as any).mode || ''))),
          hasPin: Boolean((room as any).pinHash),
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

    const targetRoomId = String(req.body?.roomId || req.body?.channelName || req.body?.id || '').trim();
    const isGlobalManager = Boolean(user.isGlobalRoomManager || ['admin', 'owner', 'superAdmin'].includes(user.role));

    const roomChannelId = String(user.userId || user.meethiId || user.id || user._id);
    const { title, about, coverImage, category, seatCount, mode, pin, themeId, themeAsset, seatSkinId, seatSkinAsset } = req.body || {};
    const isLocked = typeof req.body?.isLocked === 'boolean'
      ? req.body.isLocked
      : /private\s*\(pin\)/i.test(String(mode || ''));
    const roomPin = String(pin || '').trim();
    if (roomPin && !/^\d{4}$/.test(roomPin)) {
      return res.status(400).json({ success: false, message: 'Room PIN must contain exactly 4 digits.' });
    }

    let room: any = null;
    if (isGlobalManager && targetRoomId) {
      room = await Room.findOne({
        $or: [
          { channelName: targetRoomId },
          { channelName: normalizeRoomId(targetRoomId) },
          ...(mongoose.Types.ObjectId.isValid(targetRoomId) ? [{ _id: targetRoomId }] : []),
        ],
      }).select('+pinHash');
    }

    if (!room) {
      room = await Room.findOne({ ownerId: user.id || user._id }).select('+pinHash');
    }

    if (isLocked && !roomPin && !room?.pinHash) {
      return res.status(400).json({ success: false, message: 'Set a 4-digit PIN before enabling room privacy.' });
    }

    if (!room) {
      room = await Room.create({
        title: title || (user.name ? `${user.name}'s Party Club 🎶` : 'My Voice Party 🎵'),
        channelName: roomChannelId,
        ownerId: user.id || user._id,
        category: category || 'Chat 💬',
        seatCount: seatCount || 8,
        coverImage: coverImage || user.image || '',
        about: typeof about === 'string' ? about : '',
        mode: isLocked ? 'Private (PIN)' : (mode || 'Public'),
        isLocked,
        ...(roomPin ? { pinHash: await bcrypt.hash(roomPin, 10) } : {}),
        isActive: true,
      });
    } else {
      room.isActive = true;
      if (!isGlobalManager || !targetRoomId) {
        room.channelName = roomChannelId; // Ensure roomId == userId for own room
      }
      if (title) room.title = title;
      if (typeof about === 'string') (room as any).about = about;
      if (coverImage) (room as any).coverImage = coverImage;
      if (category) room.category = category;
      if (seatCount) (room as any).seatCount = seatCount;
      (room as any).isLocked = isLocked;
      (room as any).mode = isLocked ? 'Private (PIN)' : (mode && !/private\s*\(pin\)/i.test(String(mode)) ? mode : 'Public');
      if (isLocked && roomPin) (room as any).pinHash = await bcrypt.hash(roomPin, 10);
      if (!isLocked) (room as any).pinHash = undefined;
      await room.save();
    }

    // Sync to Redis state for active room
    try {
      const roomKey = `voice_room:${normalizeRoomId(room.channelName)}`;
      const rawState = await redis.get(roomKey);
      if (rawState) {
        const state = JSON.parse(rawState);
        if (title) state.title = title;
        if (coverImage) state.coverImage = coverImage;
        if (about) state.about = about;
        if (seatCount) state.seatCount = seatCount;
        if (themeId) state.themeId = themeId;
        if (themeAsset) state.themeAsset = themeAsset;
        if (seatSkinId) state.seatSkinId = seatSkinId;
        if (seatSkinAsset) state.seatSkinAsset = seatSkinAsset;
        state.isLocked = isLocked;
        state.mode = isLocked ? 'Private (PIN)' : (mode || 'Public');
        await redis.set(roomKey, JSON.stringify(state), 'EX', 86400);

        const io = getIOOptional();
        if (io) {
          const payload = {
            roomId: room.channelName,
            title: state.title,
            coverImage: state.coverImage,
            about: state.about,
            seatCount: state.seatCount,
            isLocked: state.isLocked,
            mode: state.mode,
            themeId: state.themeId,
            themeAsset: state.themeAsset,
            seatSkinId: state.seatSkinId,
            seatSkinAsset: state.seatSkinAsset,
          };
          io.to(`voice_room_channel:${normalizeRoomId(room.channelName)}`).emit('voice_room:details_updated', payload);
          io.to(`voice_room_channel:${room.channelName}`).emit('voice_room:details_updated', payload);
          io.to(`room:${room.channelName}`).emit('voice_room:details_updated', payload);
        }
      }
    } catch (redisErr) {
      console.warn('[createOrUpdateMyVoiceRoom] Redis sync warning:', redisErr);
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
      onlineCount: '0',
      category: room.category || 'Chat 💬',
      mode: (room as any).mode || 'Public',
      isLocked: Boolean((room as any).isLocked || /private\s*\(pin\)/i.test(String((room as any).mode || ''))),
      hasPin: Boolean((room as any).pinHash),
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

export const getVoiceRoomToken = async (req: AuthRequest, res: Response) => {
  try {
    const roomId = String(req.params.id || '').trim();
    const userId = String(req.user?.id || '').trim();
    const numericUserId = String(req.user?.userId || '').trim();
    if (!roomId || !userId) {
      return res.status(401).json({ success: false, message: 'Authenticated room access is required.' });
    }

    const canonicalRoomId = normalizeRoomId(roomId);
    const roomLookup: any[] = [{ channelName: roomId }, { channelName: canonicalRoomId }];
    if (Types.ObjectId.isValid(roomId)) roomLookup.push({ _id: roomId });
    let roomDocument: any = await Room.findOne({ $or: roomLookup }).select('ownerId channelName').lean();
    if (!roomDocument) {
      const ownerUser: any = await User.findOne({
        $or: [
          ...(Number(canonicalRoomId) > 0 ? [{ userId: Number(canonicalRoomId) }] : []),
          ...(Types.ObjectId.isValid(canonicalRoomId) ? [{ _id: canonicalRoomId }] : []),
        ],
      }).select('_id userId name').lean();

      if (ownerUser) {
        roomDocument = await Room.create({
          title: `${ownerUser.name || 'Voice'}'s Party Club`,
          channelName: canonicalRoomId,
          ownerId: ownerUser._id,
          category: 'Chat 💬',
          seatCount: 8,
          isActive: true,
        });
      }
    }
    if (!roomDocument) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }
    const roomState = await getVoiceRoomState(canonicalRoomId);
    const isPublisher = hasRoomVoicePublisherAccess({
      userId,
      numericUserId,
      roomOwnerId: String(roomDocument.ownerId || ''),
      roomChannelName: normalizeRoomId(roomDocument.channelName || ''),
      requestedRoomId: canonicalRoomId,
      seats: roomState.seats,
    });

    // A stable Agora UID is required so refreshed tokens stay bound to this member.
    let agoraUid = Number(numericUserId);
    if (!Number.isSafeInteger(agoraUid) || agoraUid <= 0 || agoraUid > 4294967295) {
      agoraUid = Math.abs(parseInt(userId.slice(-8), 16)) || (Math.floor(Math.random() * 10000000) + 1000);
    }

    const { AgoraTokenService } = await import('../services/agora/agoraToken.service');
    const roomTokenData = await AgoraTokenService.generateRoomToken(canonicalRoomId, agoraUid, isPublisher);

    return res.status(200).json({
      success: true,
      data: {
        appId: roomTokenData.appId,
        channelName: roomTokenData.channelName,
        agoraUid: roomTokenData.agoraUid,
        token: roomTokenData.token,
        isPublisher,
        projectId: roomTokenData.projectId,
        configVersion: roomTokenData.configVersion,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Retrieve real room administrators for RoomAdminListModal
 */
export const getRoomAdmins = async (req: Request, res: Response) => {
  try {
    const rawRoomId = String(req.params.id || '').trim();
    if (!rawRoomId) return res.status(400).json({ success: false, message: 'Room ID is required' });
    const roomId = normalizeRoomId(rawRoomId);

    const state = await getVoiceRoomState(roomId);
    const adminIds = Array.isArray(state?.admins) ? state.admins.map(String) : [];

    if (!adminIds.length) {
      return res.status(200).json({ success: true, data: [] });
    }

    const objectIds = adminIds.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));
    const numericIds = adminIds.map(Number).filter((num) => Number.isSafeInteger(num) && num > 0);

    const queryConditions: any[] = [];
    if (objectIds.length) queryConditions.push({ _id: { $in: objectIds } });
    if (numericIds.length) queryConditions.push({ userId: { $in: numericIds } });

    const adminUsers = queryConditions.length
      ? await User.find({ $or: queryConditions }).select('userId name image avatar level wealthLevel charmLevel equippedFrameAsset equippedFrame').lean()
      : [];

    const formatted = adminUsers.map((u: any) => ({
      id: String(u._id),
      userId: String(u.userId || u._id),
      name: u.name || 'Admin',
      avatar: u.image || u.avatar || 'https://api.yaroapp.in/uploads/avatars/male_default.webp',
      level: u.level || 1,
      wealthLevel: u.wealthLevel || u.level || 1,
      charmLevel: u.charmLevel || 0,
      equippedFrame: u.equippedFrameAsset || u.equippedFrame || null,
    }));

    return res.status(200).json({ success: true, data: formatted });
  } catch (error: any) {
    console.error('[getRoomAdmins] Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Remove an administrator from a room
 */
export const removeRoomAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const rawRoomId = String(req.params.id || '').trim();
    const targetUserId = String(req.body?.targetUserId || '').trim();
    if (!rawRoomId || !targetUserId) {
      return res.status(400).json({ success: false, message: 'Room ID and targetUserId are required' });
    }
    const roomId = normalizeRoomId(rawRoomId);

    const state = await getVoiceRoomState(roomId);
    const currentAdmins = new Set((state.admins || []).map(String));
    currentAdmins.delete(targetUserId);
    state.admins = Array.from(currentAdmins);

    const { saveVoiceRoomState } = await import('../sockets/voiceRoomSocket');
    await saveVoiceRoomState(state);

    const io = getIOOptional();
    if (io) {
      io.to(`voice_room_channel:${roomId}`).emit('voice_room:admin_updated', {
        roomId,
        admins: state.admins,
      });
      if (rawRoomId !== roomId) {
        io.to(`voice_room_channel:${rawRoomId}`).emit('voice_room:admin_updated', {
          roomId,
          admins: state.admins,
        });
      }
    }

    return res.status(200).json({ success: true, message: 'Admin removed successfully', data: { admins: state.admins } });
  } catch (error: any) {
    console.error('[removeRoomAdmin] Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Set Room Lock PIN or toggle lock
 */
export const setRoomLockPin = async (req: AuthRequest, res: Response) => {
  try {
    const rawRoomId = String(req.params.id || '').trim();
    const { isLocked, pin } = req.body;
    if (!rawRoomId) return res.status(400).json({ success: false, message: 'Room ID is required' });
    const roomId = normalizeRoomId(rawRoomId);

    const roomLookup: any[] = [
      { channelName: rawRoomId },
      { channelName: roomId },
      { channelName: `room_${roomId}` },
      { channelName: `room_${rawRoomId}` },
    ];
    if (mongoose.Types.ObjectId.isValid(rawRoomId)) roomLookup.push({ _id: rawRoomId });
    if (req.user?.id) roomLookup.push({ ownerId: req.user.id });

    const room = await Room.findOne({ $or: roomLookup }).select('+pinHash');
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

    if (isLocked) {
      if (!pin || String(pin).length !== 4) {
        return res.status(400).json({ success: false, message: 'Please set a 4-digit PIN password' });
      }
      room.pinHash = await bcrypt.hash(String(pin), 10);
      room.isLocked = true;
      room.mode = 'Private (PIN)';
    } else {
      room.isLocked = false;
      room.pinHash = undefined;
      room.mode = 'Public';
    }

    await room.save();

    const state = await getVoiceRoomState(roomId);
    state.isLocked = Boolean(isLocked);
    state.mode = room.mode;
    state.hasPin = Boolean(isLocked);

    const { saveVoiceRoomState } = await import('../sockets/voiceRoomSocket');
    await saveVoiceRoomState(state);

    const io = getIOOptional();
    if (io) {
      const payload = {
        roomId,
        isLocked: state.isLocked,
        mode: state.mode,
        hasPin: state.hasPin,
      };
      io.to(`voice_room_channel:${roomId}`).emit('voice_room:details_updated', payload);
      if (rawRoomId !== roomId) {
        io.to(`voice_room_channel:${rawRoomId}`).emit('voice_room:details_updated', payload);
      }
    }

    return res.status(200).json({ success: true, message: isLocked ? 'Room locked successfully' : 'Room unlocked', data: { isLocked: room.isLocked } });
  } catch (error: any) {
    console.error('[setRoomLockPin] Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Verify Room Lock PIN when a user joins
 */
export const verifyRoomLockPin = async (req: Request, res: Response) => {
  try {
    const rawRoomId = String(req.params.id || '').trim();
    const pin = String(req.body?.pin || '').trim();
    if (!rawRoomId || !pin) {
      return res.status(400).json({ success: false, message: 'Room ID and PIN are required' });
    }
    const roomId = normalizeRoomId(rawRoomId);

    const roomLookup: any[] = [
      { channelName: rawRoomId },
      { channelName: roomId },
      { channelName: `room_${roomId}` },
      { channelName: `room_${rawRoomId}` },
    ];
    if (mongoose.Types.ObjectId.isValid(rawRoomId)) roomLookup.push({ _id: rawRoomId });

    const room = await Room.findOne({ $or: roomLookup }).select('+pinHash');
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

    if (!room.pinHash) {
      // Room has no password set
      return res.status(200).json({ success: true, valid: true });
    }

    const isValid = await bcrypt.compare(pin, room.pinHash);
    if (!isValid) {
      return res.status(400).json({ success: false, valid: false, message: 'Incorrect password. Please try again.' });
    }

    return res.status(200).json({ success: true, valid: true, message: 'Password verified' });
  } catch (error: any) {
    console.error('[verifyRoomLockPin] Error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};


