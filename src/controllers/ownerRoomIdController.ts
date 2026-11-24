import { Response } from 'express';
import mongoose from 'mongoose';
import { Room } from '../models/room.model';
import { User } from '../models/user.model';
import { AuditLog } from '../models/auditLog.model';
import { AuthRequest } from '../middlewares/authorize.middleware';
import sendResponse from '../utils/reponse';
import { isRoomIdAvailable, isValid9DigitRoomId } from '../utils/roomIdGenerator';

/**
 * Owner-only: Check if a 9-digit custom Room ID is available.
 */
export const checkCustomRoomId = async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user;
    if (!owner || owner.role !== 'owner') {
      return sendResponse(res, 403, false, 'Forbidden: Owner authorization required.');
    }

    const { roomId } = req.query as { roomId?: string };
    if (!roomId) {
      return sendResponse(res, 400, false, 'Room ID is required.');
    }

    const check = await isRoomIdAvailable(String(roomId).trim());
    return sendResponse(res, 200, true, check.available ? 'Room ID is available.' : (check.reason || 'Room ID is not available.'), {
      roomId: String(roomId).trim(),
      available: check.available,
      reason: check.reason,
    });
  } catch (error: any) {
    console.error('[checkCustomRoomId] error:', error);
    return sendResponse(res, 500, false, error.message || 'Internal server error');
  }
};

/**
 * Owner-only: Create a room with an explicitly assigned custom 9-digit Room ID.
 */
export const createCustomRoom = async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user;
    if (!owner || owner.role !== 'owner') {
      return sendResponse(res, 403, false, 'Forbidden: Only the Owner can create Custom Room IDs.');
    }

    const {
      customRoomId,
      title,
      ownerUserId, // Optional User ID or internal _id to assign room ownership to
      category = 'Chat 💬',
      seatCount = 8,
      about = '',
      coverImage = '',
    } = req.body || {};

    const cleanRoomId = String(customRoomId || '').trim();
    if (!isValid9DigitRoomId(cleanRoomId)) {
      return sendResponse(res, 400, false, 'Validation Error: Custom Room ID must contain exactly 9 digits.');
    }

    const availability = await isRoomIdAvailable(cleanRoomId);
    if (!availability.available) {
      return sendResponse(res, 409, false, availability.reason || 'Room ID already taken.');
    }

    // Determine room owner
    let targetOwnerId: mongoose.Types.ObjectId = owner.id;
    if (ownerUserId) {
      const foundUser = await User.findOne({
        $or: [
          ...(Number(ownerUserId) > 0 ? [{ userId: Number(ownerUserId) }] : []),
          ...(mongoose.Types.ObjectId.isValid(ownerUserId) ? [{ _id: new mongoose.Types.ObjectId(ownerUserId) }] : []),
        ],
      }).select('_id name userId').lean();

      if (!foundUser) {
        return sendResponse(res, 404, false, `Owner User "${ownerUserId}" not found.`);
      }
      targetOwnerId = foundUser._id as any;
    }

    const room = await Room.create({
      title: String(title || 'Custom VIP Voice Room').trim(),
      channelName: cleanRoomId,
      ownerId: targetOwnerId,
      category,
      seatCount: Number(seatCount) || 8,
      about: String(about || '').trim(),
      coverImage: String(coverImage || '').trim(),
      isCustomId: true,
      isActive: true,
      isArchived: false,
    });

    await AuditLog.create({
      adminId: owner.id,
      action: 'CREATE_CUSTOM_ROOM_ID',
      target: cleanRoomId,
      details: `Created custom room with 9-digit ID: ${cleanRoomId} for owner: ${targetOwnerId}`,
      ipAddress: req.ip || '127.0.0.1',
      newValue: {
        roomId: cleanRoomId,
        isCustomId: true,
        title: room.title,
        ownerId: targetOwnerId,
      },
    });

    return sendResponse(res, 201, true, `Custom room created successfully with 9-digit ID: ${cleanRoomId}`, {
      room: {
        _id: room._id,
        channelName: room.channelName,
        isCustomId: room.isCustomId,
        title: room.title,
        ownerId: room.ownerId,
        seatCount: room.seatCount,
        category: room.category,
        isActive: room.isActive,
        createdAt: room.createdAt,
      },
    });
  } catch (error: any) {
    console.error('[createCustomRoom] error:', error);
    return sendResponse(res, 500, false, error.message || 'Internal server error');
  }
};

/**
 * Owner-only: List rooms with metadata distinguishing automatic vs custom 9-digit IDs.
 */
export const listRoomsWithIdMeta = async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user;
    if (!owner || owner.role !== 'owner') {
      return sendResponse(res, 403, false, 'Forbidden: Owner authorization required.');
    }

    const {
      page = 1,
      limit = 20,
      search = '',
      type = 'all', // 'all' | 'custom' | 'auto'
      status = 'all', // 'all' | 'active' | 'archived'
    } = req.query as any;

    const query: any = {};

    if (type === 'custom') {
      query.isCustomId = true;
    } else if (type === 'auto') {
      query.isCustomId = { $ne: true };
    }

    if (status === 'active') {
      query.isActive = true;
      query.isArchived = { $ne: true };
    } else if (status === 'archived') {
      query.$or = [{ isArchived: true }, { isActive: false }];
    }

    if (search && String(search).trim()) {
      const searchStr = String(search).trim();
      const searchConditions: any[] = [
        { channelName: { $regex: searchStr, $options: 'i' } },
        { legacyId: { $regex: searchStr, $options: 'i' } },
        { title: { $regex: searchStr, $options: 'i' } },
      ];
      if (mongoose.Types.ObjectId.isValid(searchStr)) {
        searchConditions.push({ _id: new mongoose.Types.ObjectId(searchStr) });
      }
      query.$and = [{ $or: searchConditions }];
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [rooms, total] = await Promise.all([
      Room.find(query)
        .populate('ownerId', 'userId name phoneNumber image')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Room.countDocuments(query),
    ]);

    const formattedRooms = rooms.map((r: any) => ({
      _id: r._id,
      channelName: r.channelName,
      legacyId: r.legacyId || null,
      isCustomId: Boolean(r.isCustomId),
      title: r.title,
      owner: r.ownerId ? {
        _id: r.ownerId._id,
        userId: r.ownerId.userId,
        name: r.ownerId.name,
      } : null,
      category: r.category,
      seatCount: r.seatCount,
      isActive: Boolean(r.isActive),
      isArchived: Boolean(r.isArchived),
      createdAt: r.createdAt,
    }));

    return sendResponse(res, 200, true, 'Rooms fetched successfully', {
      rooms: formattedRooms,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('[listRoomsWithIdMeta] error:', error);
    return sendResponse(res, 500, false, error.message || 'Internal server error');
  }
};
