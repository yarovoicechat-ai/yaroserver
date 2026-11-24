import { Response } from 'express';
import { AuthRequest } from '../middlewares/authorize.middleware';
import sendResponse from '../utils/reponse';
import { User } from '../models/user.model';
import { getIOOptional } from '../sockets';

const ALLOWED_ADMIN_ROLES = ['owner', 'superadmin', 'superadmin', 'admin'];

function isAuthorized(role?: string) {
  if (!role) return false;
  return ALLOWED_ADMIN_ROLES.includes(role.toLowerCase());
}

/**
 * GET /api/v1/admin/video-access/users
 * Search and list users with video permission status
 */
export const getVideoAccessUsers = async (req: AuthRequest, res: Response) => {
  try {
    if (!isAuthorized(req.user?.role)) {
      return sendResponse(res, 403, false, 'Permission denied: Administrator privileges required.');
    }

    const { search, status = 'all', page = 1, limit = 20 } = req.query;
    const filter: any = { isDeleted: false };

    if (status === 'enabled') {
      filter.$or = [{ hasVideoAccess: true }, { canWatchTogether: true }];
    } else if (status === 'disabled') {
      filter.hasVideoAccess = { $ne: true };
      filter.canWatchTogether = { $ne: true };
    }

    if (search) {
      const q = String(search).trim();
      const escaped = q.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const searchConditions: any[] = [
        { name: regex },
        { userName: regex },
        { email: regex },
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
      if (!isNaN(Number(q))) {
        searchConditions.push({ userId: Number(q) });
      }

      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchConditions }];
        delete filter.$or;
      } else {
        filter.$or = searchConditions;
      }
    }

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('userId name userName email image avatar role hasVideoAccess canWatchTogether videoAccessGrantedByName videoAccessGrantedAt createdAt')
        .sort({ videoAccessGrantedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(filter),
    ]);

    return sendResponse(res, 200, true, 'Video access users fetched', {
      users,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch video access users');
  }
};

/**
 * POST /api/v1/admin/video-access/toggle
 * Enable or disable Video Access for a specific user
 */
export const toggleVideoAccess = async (req: AuthRequest, res: Response) => {
  try {
    const adminUser = req.user;
    if (!adminUser || !isAuthorized(adminUser.role)) {
      return sendResponse(res, 403, false, 'Permission denied: Administrator privileges required.');
    }

    const { userId, hasVideoAccess } = req.body;
    if (userId === undefined || hasVideoAccess === undefined) {
      return sendResponse(res, 400, false, 'userId and hasVideoAccess (boolean) are required');
    }

    const targetNum = Number(userId);
    const target = await User.findOne({
      $or: [
        { userId: !isNaN(targetNum) ? targetNum : -1 },
        { _id: String(userId).length === 24 ? userId : null },
      ],
      isDeleted: false,
    });

    if (!target) {
      return sendResponse(res, 404, false, 'User not found');
    }

    const nextState = Boolean(hasVideoAccess);
    target.hasVideoAccess = nextState;
    target.canWatchTogether = nextState;
    if (nextState) {
      target.videoAccessGrantedBy = adminUser.id || (adminUser as any)._id;
      target.videoAccessGrantedByName = adminUser.name || String(adminUser.userId || 'Admin');
      target.videoAccessGrantedAt = new Date();
    } else {
      target.videoAccessGrantedBy = undefined;
      target.videoAccessGrantedByName = undefined;
      target.videoAccessGrantedAt = undefined;
    }

    await target.save();

    // Real-time Socket.IO notification to user
    try {
      const io = getIOOptional();
      if (io) {
        const payload = {
          userId: target.userId,
          hasVideoAccess: nextState,
          canWatchTogether: nextState,
          timestamp: new Date().toISOString(),
        };
        io.to(`user:${target.userId}`).emit('user:video_permission_updated', payload);
        io.to(`user:${target._id}`).emit('user:video_permission_updated', payload);
      }
    } catch (sockErr: any) {
      console.warn('[VideoAccess] Socket broadcast error:', sockErr?.message);
    }

    return sendResponse(res, 200, true, `Video access ${nextState ? 'enabled' : 'disabled'} for user ${target.userId}`, {
      userId: target.userId,
      hasVideoAccess: target.hasVideoAccess,
      canWatchTogether: target.canWatchTogether,
      videoAccessGrantedByName: target.videoAccessGrantedByName,
      videoAccessGrantedAt: target.videoAccessGrantedAt,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to toggle video access');
  }
};
