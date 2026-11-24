import { Response } from 'express';
import { AuthRequest } from '../middlewares/authorize.middleware';
import sendResponse from '../utils/reponse';
import { User } from '../models/user.model';
import { getIOOptional } from '../sockets';

export const VALID_ROLES = [
  'owner',
  'superAdmin',
  'admin',
  'countryManager',
  'stateManager',
  'bdLeader',
  'bd',
  'agency',
  'operator',
  'host',
  'customerSupport',
  'coinSeller',
  'user',
];

/**
 * GET /api/v1/admin/owner/users
 * Search and list users with their roles (Owner only)
 */
export const getOwnerUsers = async (req: AuthRequest, res: Response) => {
  try {
    if (String(req.user?.role || '').toLowerCase() !== 'owner') {
      return sendResponse(res, 403, false, 'Permission denied: Platform Owner access required.');
    }

    const { search, role, page = 1, limit = 20 } = req.query;
    const filter: any = { isDeleted: false };

    if (role && role !== 'all') {
      filter.role = role;
    }

    if (search) {
      const q = String(search).trim();
      const escaped = q.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const searchConditions: any[] = [
        { name: regex },
        { userName: regex },
        { email: regex },
        { phoneNumber: regex },
        { role: regex },
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

      filter.$or = searchConditions;
    }

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('userId name userName email phoneNumber role image avatar isBanned isBlocked coins diamonds createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(filter),
    ]);

    return sendResponse(res, 200, true, 'Users loaded for Owner Console', {
      users,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to list users');
  }
};

/**
 * POST /api/v1/admin/owner/change-role
 * Owner can change anyone's panel / role
 */
export const changeUserRole = async (req: AuthRequest, res: Response) => {
  try {
    if (String(req.user?.role || '').toLowerCase() !== 'owner') {
      return sendResponse(res, 403, false, 'Permission denied: Platform Owner access required.');
    }

    const { userId, newRole, reason = 'Role changed from Owner Panel' } = req.body;
    if (!userId || !newRole) {
      return sendResponse(res, 400, false, 'userId and newRole are required');
    }

    if (!VALID_ROLES.includes(newRole)) {
      return sendResponse(res, 400, false, `Invalid role. Allowed roles: ${VALID_ROLES.join(', ')}`);
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

    const previousRole = target.role;
    target.role = newRole as any;
    // Invalidate old session tokens so new role takes effect upon next request
    target.activeToken = '';
    target.refreshToken = '';

    await target.save();

    // Broadcast role updated event
    try {
      const io = getIOOptional();
      if (io) {
        io.to(`user:${target.userId}`).emit('user:role_updated', {
          userId: target.userId,
          previousRole,
          newRole,
          updatedBy: req.user?.name || req.user?.userId || 'Owner',
        });
      }
    } catch (_) {}

    return sendResponse(res, 200, true, `Role of user ${target.userId} changed from ${previousRole} to ${newRole}`, {
      userId: target.userId,
      previousRole,
      newRole,
      reason,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to change user role');
  }
};
