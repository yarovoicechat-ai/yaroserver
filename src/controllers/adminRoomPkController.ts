import { Response } from 'express';
import { AuthRequest } from '../middlewares/authorize.middleware';
import sendResponse from '../utils/reponse';
import { RoomPK } from '../models/roomPk.model';
import LiveBroadcast from '../models/liveBroadcast.model';
import { getIOOptional } from '../sockets';

const ALLOWED_ADMIN_ROLES = ['owner', 'superadmin', 'superadmin', 'admin', 'operator'];

function isAuthorized(role?: string) {
  if (!role) return false;
  return ALLOWED_ADMIN_ROLES.includes(role.toLowerCase());
}

/**
 * GET /api/v1/admin/room-pk/dashboard
 * Summary of Room PK activity and modes
 */
export const getAdminRoomPKDashboard = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAuthorized(req.user?.role)) {
      return sendResponse(res, 403, false, 'Permission denied');
    }

    const [
      activePKs,
      finishedPKs,
      totalPKs,
      voteCount,
      personalCount,
      teamCount,
      activeLivePKs,
    ] = await Promise.all([
      RoomPK.countDocuments({ isOpen: true, status: 'active' }),
      RoomPK.countDocuments({ status: 'finished' }),
      RoomPK.countDocuments({}),
      RoomPK.countDocuments({ pkMode: 'vote' }),
      RoomPK.countDocuments({ pkMode: 'personal' }),
      RoomPK.countDocuments({ pkMode: 'team' }),
      LiveBroadcast.countDocuments({ 'pk.isActive': true, status: 'live' }),
    ]);

    return sendResponse(res, 200, true, 'Room PK dashboard loaded', {
      activePKs,
      finishedPKs,
      totalPKs,
      modes: {
        vote: voteCount,
        personal: personalCount,
        team: teamCount,
      },
      activeLivePKs,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch Room PK dashboard');
  }
};

/**
 * GET /api/v1/admin/room-pk/sessions
 * List Room PK sessions with search, mode filter, and status filter
 */
export const getAdminRoomPKSessions = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAuthorized(req.user?.role)) {
      return sendResponse(res, 403, false, 'Permission denied');
    }

    const {
      search,
      status = 'all',
      pkMode = 'all',
      roomId,
      page = 1,
      limit = 20,
    } = req.query;

    const filter: any = {};

    if (status !== 'all') {
      if (status === 'active') {
        filter.isOpen = true;
        filter.status = 'active';
      } else if (status === 'completed' || status === 'finished') {
        filter.status = 'finished';
      } else if (status === 'cancelled') {
        filter.status = { $in: ['cancelled', 'declined', 'expired'] };
      } else {
        filter.status = status;
      }
    }

    if (pkMode !== 'all') {
      filter.pkMode = pkMode;
    }

    if (roomId) {
      filter.roomIds = String(roomId).trim();
    }

    if (search) {
      const q = String(search).trim();
      const numQ = Number(q);
      const orConditions: any[] = [
        { _id: q.length === 24 ? q : null },
        { roomIds: q },
        { invitedBy: q },
        { 'participantA.name': new RegExp(q, 'i') },
        { 'participantB.name': new RegExp(q, 'i') },
      ];
      if (!isNaN(numQ)) {
        orConditions.push({ 'participantA.userId': numQ });
        orConditions.push({ 'participantB.userId': numQ });
      }
      filter.$or = orConditions.filter(c => Object.values(c)[0] !== null);
    }

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [sessions, total] = await Promise.all([
      RoomPK.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      RoomPK.countDocuments(filter),
    ]);

    return sendResponse(res, 200, true, 'Room PK sessions fetched', {
      sessions,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to list Room PK sessions');
  }
};

/**
 * GET /api/v1/admin/room-pk/sessions/:id
 * Detailed Room PK session view
 */
export const getAdminRoomPKDetail = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAuthorized(req.user?.role)) {
      return sendResponse(res, 403, false, 'Permission denied');
    }

    const { id } = req.params;
    const session = await RoomPK.findById(id).lean();
    if (!session) {
      return sendResponse(res, 404, false, 'PK session not found');
    }

    return sendResponse(res, 200, true, 'PK session detail', session);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to get PK session');
  }
};

/**
 * POST /api/v1/admin/room-pk/sessions/:id/cancel
 * Cancel an active Room PK session from Admin Panel
 */
export const cancelAdminRoomPK = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAuthorized(req.user?.role)) {
      return sendResponse(res, 403, false, 'Permission denied');
    }

    const { id } = req.params;
    const { reason = 'Cancelled by platform administrator' } = req.body;

    const session = await RoomPK.findById(id);
    if (!session) {
      return sendResponse(res, 404, false, 'PK session not found');
    }

    if (!session.isOpen && session.status !== 'active' && session.status !== 'invited') {
      return sendResponse(res, 400, false, `PK session is already ${session.status}`);
    }

    session.isOpen = false;
    session.busyRoomIds = [];
    session.status = 'cancelled';
    session.finishedAt = new Date();
    await session.save();

    // Broadcast cancel to the voice rooms
    try {
      const io = getIOOptional();
      if (io) {
        for (const rId of session.roomIds) {
          io.to(`room:${rId}`).emit('room:pk_cancelled', {
            matchId: session._id,
            reason,
            byAdmin: req.user?.name || req.user?.userId || 'Admin',
          });
        }
      }
    } catch (_) {}

    return sendResponse(res, 200, true, 'Room PK session cancelled successfully', session);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to cancel Room PK session');
  }
};

/**
 * GET /api/v1/admin/live-pk/sessions
 * List active & recent Live Broadcast PK battles
 */
export const getAdminLivePKSessions = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAuthorized(req.user?.role)) {
      return sendResponse(res, 403, false, 'Permission denied');
    }

    const { status = 'all', page = 1, limit = 20 } = req.query;
    const filter: any = {};

    if (status === 'active') {
      filter['pk.isActive'] = true;
      filter.status = 'live';
    } else {
      filter.$or = [
        { 'pk.isActive': true },
        { 'pk.startTime': { $ne: null } },
      ];
    }

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [rooms, total] = await Promise.all([
      LiveBroadcast.find(filter)
        .populate('host', 'name avatar image userId level')
        .populate('pk.rivalHost', 'name avatar image userId level')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      LiveBroadcast.countDocuments(filter),
    ]);

    return sendResponse(res, 200, true, 'Live PK sessions fetched', {
      sessions: rooms.map((r: any) => ({
        id: r._id,
        roomId: r._id,
        title: r.title,
        status: r.status,
        isPKActive: Boolean(r.pk?.isActive),
        host: r.host,
        rivalHost: r.pk?.rivalHost,
        rivalRoomId: r.pk?.rivalRoomId,
        leftScore: r.pk?.leftScore || 0,
        rightScore: r.pk?.rightScore || 0,
        durationSeconds: r.pk?.durationSeconds || 300,
        startTime: r.pk?.startTime,
        endTime: r.pk?.endTime,
      })),
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to list live PK sessions');
  }
};
