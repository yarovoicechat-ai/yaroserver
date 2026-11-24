import { Response } from 'express';
import mongoose from 'mongoose';
import { Room } from '../models/room.model';
import { RoomPK } from '../models/roomPk.model';
import { RoomWatchSession } from '../models/roomWatchSession.model';
import { RoomContribution } from '../models/roomContribution.model';
import { AuditLog } from '../models/auditLog.model';
import { AuthRequest } from '../middlewares/authorize.middleware';
import sendResponse from '../utils/reponse';
import redis from '../configs/redisConfig';
import { getIOOptional } from '../sockets';

const normalizeRoomId = (id: string): string => {
  if (!id) return '';
  return String(id).trim().replace(/^room:/i, '').replace(/^voice_room_channel:/i, '');
};

/**
 * Owner-only: Preview rooms before executing cleanup.
 */
export const getRoomCleanupPreview = async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user;
    if (!owner || owner.role !== 'owner') {
      return sendResponse(res, 403, false, 'Forbidden: Owner authorization required.');
    }

    const { mode = 'all', roomId } = req.query as { mode?: string; roomId?: string };

    if (mode === 'single') {
      if (!roomId || !String(roomId).trim()) {
        return sendResponse(res, 400, false, 'Room ID is required for single room cleanup preview.');
      }

      const searchVal = String(roomId).trim();
      const targetRoom = await Room.findOne({
        $or: [
          { channelName: searchVal },
          { legacyId: searchVal },
          ...(mongoose.Types.ObjectId.isValid(searchVal) ? [{ _id: new mongoose.Types.ObjectId(searchVal) }] : []),
        ],
      })
        .populate('ownerId', 'userId name phoneNumber image')
        .lean();

      if (!targetRoom) {
        return sendResponse(res, 404, false, `Room "${roomId}" not found.`);
      }

      // Check active PK
      const activePk = await RoomPK.findOne({
        roomIds: targetRoom.channelName,
        status: { $in: ['invited', 'active'] },
      }).lean();

      // Check active watch session
      const activeWatch = await RoomWatchSession.findOne({
        roomId: targetRoom.channelName,
        isActive: true,
      }).lean();

      // Check redis online members count
      let onlineMembersCount = 0;
      try {
        const rawState = await redis.get(`voice_room:${normalizeRoomId(targetRoom.channelName)}`);
        if (rawState) {
          const parsed = JSON.parse(rawState);
          onlineMembersCount = Array.isArray(parsed.seats) ? parsed.seats.filter((s: any) => s && s.user).length : 0;
        }
      } catch {}

      return sendResponse(res, 200, true, 'Single room cleanup preview generated', {
        mode: 'single',
        targetRoom: {
          _id: targetRoom._id,
          channelName: targetRoom.channelName,
          legacyId: targetRoom.legacyId || null,
          isCustomId: Boolean(targetRoom.isCustomId),
          title: targetRoom.title,
          owner: targetRoom.ownerId,
          seatCount: targetRoom.seatCount,
          isActive: Boolean(targetRoom.isActive),
          isArchived: Boolean(targetRoom.isArchived),
          hasActivePK: Boolean(activePk),
          activePkId: (activePk as any)?._id || null,
          hasActiveWatchSession: Boolean(activeWatch),
          onlineOccupantsCount: onlineMembersCount,
        },
        operationId: `PREVIEW_ROOM_SINGLE_${Date.now()}`,
      });
    }

    // Mode: 'all'
    const totalActiveRooms = await Room.countDocuments({
      isActive: true,
      isArchived: { $ne: true },
    });

    const activePkRooms = await RoomPK.countDocuments({
      status: { $in: ['invited', 'active'] },
    });

    const activeWatchRooms = await RoomWatchSession.countDocuments({
      isActive: true,
    });

    // Estimate online rooms from Redis
    let onlineRoomsCount = 0;
    try {
      const keys = await redis.keys('voice_room:*');
      onlineRoomsCount = keys ? keys.length : 0;
    } catch {}

    const offlineRoomsCount = Math.max(0, totalActiveRooms - onlineRoomsCount);

    return sendResponse(res, 200, true, 'Global room cleanup preview generated', {
      mode: 'all',
      preview: {
        totalActiveRooms,
        onlineRoomsCount,
        offlineRoomsCount,
        activePkRoomsCount: activePkRooms,
        activeWatchRoomsCount: activeWatchRooms,
      },
      operationId: `PREVIEW_ROOM_ALL_${Date.now()}`,
    });
  } catch (error: any) {
    console.error('[getRoomCleanupPreview] error:', error);
    return sendResponse(res, 500, false, error.message || 'Internal server error');
  }
};

/**
 * Owner-only: Execute Room Cleanup safely.
 * Ends active sessions, clears Redis room state, archives active rooms in DB.
 * Historical PK records, gift history, and user/wallet balances are 100% preserved.
 */
export const executeRoomCleanup = async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user;
    if (!owner || owner.role !== 'owner') {
      return sendResponse(res, 403, false, 'Forbidden: Owner authorization required.');
    }

    const {
      mode = 'all', // 'all' | 'single'
      roomId,
      resetRoomRankings = true,
      confirmationToken,
      secondConfirmation,
    } = req.body || {};

    if (mode === 'all') {
      if (confirmationToken !== 'CONFIRM_CLEAN_ALL_ROOMS') {
        return sendResponse(res, 400, false, 'Safety Check: Primary confirmation token required: "CONFIRM_CLEAN_ALL_ROOMS".');
      }
      if (secondConfirmation !== true) {
        return sendResponse(res, 400, false, 'Safety Check: Secondary confirmation flag must be explicitly confirmed for Clean All.');
      }
    }

    const io = getIOOptional();
    const opId = `OP_ROOM_CLEANUP_${mode.toUpperCase()}_${Date.now()}`;

    // A. Single Room Cleanup
    if (mode === 'single') {
      if (!roomId || !String(roomId).trim()) {
        return sendResponse(res, 400, false, 'Room ID is required for single room cleanup.');
      }

      const searchVal = String(roomId).trim();
      const targetRoom = await Room.findOne({
        $or: [
          { channelName: searchVal },
          { legacyId: searchVal },
          ...(mongoose.Types.ObjectId.isValid(searchVal) ? [{ _id: new mongoose.Types.ObjectId(searchVal) }] : []),
        ],
      });

      if (!targetRoom) {
        return sendResponse(res, 404, false, `Room "${roomId}" not found.`);
      }

      const canonicalId = targetRoom.channelName;
      const normalizedId = normalizeRoomId(canonicalId);

      // 1. Safely cancel any active PK session
      await RoomPK.updateMany(
        { roomIds: canonicalId, status: { $in: ['invited', 'active'] } },
        { $set: { status: 'cancelled', isOpen: false, busyRoomIds: [] } }
      );

      // 2. End any active watch session
      await RoomWatchSession.updateMany(
        { roomId: canonicalId, isActive: true },
        { $set: { isActive: false, status: 'ended' } }
      );

      // 3. Notify socket room channels to disconnect members gracefully
      if (io) {
        const payload = {
          roomId: canonicalId,
          reason: 'Room session ended by administrator.',
          closedAt: new Date().toISOString(),
        };
        io.to(`voice_room_channel:${normalizedId}`).emit('voice_room:closed', payload);
        io.to(`voice_room_channel:${canonicalId}`).emit('voice_room:closed', payload);
        io.to(`room:${canonicalId}`).emit('voice_room:closed', payload);
      }

      // 4. Remove active Redis room keys
      try {
        await redis.del(`voice_room:${normalizedId}`);
        await redis.del(`voice_room:${canonicalId}`);
        await redis.del(`voice_room_members:${canonicalId}`);
      } catch {}

      // 4b. Safely reset room ranking & contribution aggregates (User wallet balances strictly preserved)
      if (resetRoomRankings !== false) {
        await RoomContribution.deleteMany({ roomId: { $in: [canonicalId, normalizedId] } });
        try {
          const rankKeys = await redis.keys(`*${canonicalId}*`);
          const toDel = rankKeys.filter(k => k.includes('leaderboard') || k.includes('ranking') || k.includes('score') || k.includes('contributor'));
          if (toDel.length > 0) await redis.del(...toDel);
        } catch {}
      }

      // 5. Update MongoDB Room record: archive & deactivate (NEVER delete historical document)
      targetRoom.isActive = false;
      targetRoom.isArchived = true;
      targetRoom.closedAt = new Date();
      targetRoom.closedReason = 'Owner Room Cleanup';
      await targetRoom.save();

      await AuditLog.create({
        adminId: owner.id,
        action: 'ROOM_CLEANUP_SINGLE',
        target: canonicalId,
        details: `Cleaned and archived room "${targetRoom.title}" (ID: ${canonicalId}) safely.`,
        ipAddress: req.ip || '127.0.0.1',
        newValue: { operationId: opId, roomId: canonicalId, isArchived: true, isActive: false },
      });

      return sendResponse(res, 200, true, `Successfully cleaned and archived room ${canonicalId}`, {
        operationId: opId,
        mode: 'single',
        cleanedRoomId: canonicalId,
        isArchived: true,
        isActive: false,
      });
    }

    // B. Clean All Active Rooms
    const activeRooms = await Room.find({ isActive: true, isArchived: { $ne: true } }).select('channelName title').lean();
    const activeRoomIds = activeRooms.map(r => r.channelName);

    // 1. Safely cancel all active PK sessions
    await RoomPK.updateMany(
      { status: { $in: ['invited', 'active'] } },
      { $set: { status: 'cancelled', isOpen: false, busyRoomIds: [] } }
    );

    // 2. End all active watch sessions
    await RoomWatchSession.updateMany(
      { isActive: true },
      { $set: { isActive: false, status: 'ended' } }
    );

    // 3. Notify socket room channels
    if (io) {
      for (const rId of activeRoomIds) {
        const normId = normalizeRoomId(rId);
        const payload = {
          roomId: rId,
          reason: 'Global room cleanup executed by administrator.',
          closedAt: new Date().toISOString(),
        };
        io.to(`voice_room_channel:${normId}`).emit('voice_room:closed', payload);
        io.to(`voice_room_channel:${rId}`).emit('voice_room:closed', payload);
        io.to(`room:${rId}`).emit('voice_room:closed', payload);
      }
    }

    // 4. Flush Redis active room keys
    try {
      const keys = await redis.keys('voice_room:*');
      if (keys && keys.length > 0) {
        await redis.del(...keys);
      }
    } catch {}

    // 4b. Safely reset all room rankings & contribution aggregates (User wallet balances 100% preserved)
    if (resetRoomRankings !== false) {
      await RoomContribution.deleteMany({});
      try {
        const rankKeys = await redis.keys('room_leaderboard:*');
        const contribKeys = await redis.keys('room_contributors:*');
        const allRanks = [...(rankKeys || []), ...(contribKeys || [])];
        if (allRanks.length > 0) await redis.del(...allRanks);
      } catch {}
    }

    // 5. Deactivate & archive active rooms in MongoDB
    const archiveResult = await Room.updateMany(
      { isActive: true },
      {
        $set: {
          isActive: false,
          isArchived: true,
          closedAt: new Date(),
          closedReason: 'Owner Global Room Cleanup',
        },
      }
    );

    // 6. Verify active room list is now empty
    const remainingActive = await Room.countDocuments({ isActive: true, isArchived: { $ne: true } });

    await AuditLog.create({
      adminId: owner.id,
      action: 'ROOM_CLEANUP_ALL',
      target: 'GLOBAL_ROOMS',
      details: `Executed Clean All Rooms. Archived ${archiveResult.modifiedCount} active rooms. Remaining active: ${remainingActive}`,
      ipAddress: req.ip || '127.0.0.1',
      newValue: {
        operationId: opId,
        archivedCount: archiveResult.modifiedCount,
        remainingActive,
      },
    });

    return sendResponse(res, 200, true, `Clean All Rooms completed. Archived ${archiveResult.modifiedCount} rooms. Active listings are clean.`, {
      operationId: opId,
      mode: 'all',
      archivedRoomsCount: archiveResult.modifiedCount,
      remainingActiveRooms: remainingActive,
    });
  } catch (error: any) {
    console.error('[executeRoomCleanup] error:', error);
    return sendResponse(res, 500, false, error.message || 'Internal server error');
  }
};

/**
 * Owner-only: Get Cleanup Operation Audit History.
 */
export const getCleanupHistory = async (req: AuthRequest, res: Response) => {
  try {
    const owner = req.user;
    if (!owner || owner.role !== 'owner') {
      return sendResponse(res, 403, false, 'Forbidden: Owner authorization required.');
    }

    const { page = 1, limit = 20, type = 'all' } = req.query as any;

    const query: any = {};
    if (type === 'chat') {
      query.action = { $regex: 'CHAT_CLEANUP', $options: 'i' };
    } else if (type === 'room') {
      query.action = { $regex: 'ROOM_CLEANUP', $options: 'i' };
    } else {
      query.action = { $regex: 'CLEANUP', $options: 'i' };
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .populate('adminId', 'name userId email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    const formatted = logs.map((l: any) => ({
      _id: l._id,
      action: l.action,
      target: l.target,
      details: l.details,
      ipAddress: l.ipAddress,
      performedBy: l.adminId ? {
        _id: l.adminId._id,
        name: l.adminId.name,
        userId: l.adminId.userId,
      } : null,
      metadata: l.newValue,
      createdAt: l.createdAt,
    }));

    return sendResponse(res, 200, true, 'Cleanup history fetched successfully', {
      logs: formatted,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('[getCleanupHistory] error:', error);
    return sendResponse(res, 500, false, error.message || 'Internal server error');
  }
};
