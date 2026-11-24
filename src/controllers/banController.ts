import { Response } from 'express';
import { AuthRequest } from '../middlewares/authorize.middleware';
import { User } from '../models/user.model';
import { Device } from '../models/device.model';
import { BanHistory } from '../models/banHistory.model';
import {
  calculateBannedUntil,
  checkUserBanStatus,
  checkDeviceBanStatus,
  formatBanPayload,
  getRemainingTimeString,
} from '../services/ban.service';
import sendResponse from '../utils/reponse';
import { getIOOptional } from '../sockets';

const ALLOWED_ADMIN_ROLES = ['owner', 'superAdmin', 'admin', 'superadmin'];

function isAuthorizedAdmin(role?: string): boolean {
  if (!role) return false;
  return ALLOWED_ADMIN_ROLES.includes(role.toLowerCase());
}

/**
 * POST /api/admin/bans/user
 * Ban a User ID (temporary or permanent)
 */
export const banUser = async (req: AuthRequest, res: Response) => {
  try {
    const adminUser = req.user;
    if (!adminUser || !isAuthorizedAdmin(adminUser.role)) {
      return sendResponse(res, 403, false, 'Permission denied: Authorized administrator access required.');
    }

    const { userId, banType = 'temporary', duration, customDate, reason = 'Account suspended by administrator', adminNote = '' } = req.body;
    if (!userId) {
      return sendResponse(res, 400, false, 'User ID is required');
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

    // Role protection: Only owner can ban owner or superadmin
    const targetRole = String(target.role || '').toLowerCase();
    const adminRole = String(adminUser.role || '').toLowerCase();
    if (['owner', 'superadmin'].includes(targetRole) && adminRole !== 'owner') {
      return sendResponse(res, 403, false, 'Cannot ban platform owners or super administrators.');
    }

    const isPermanent = String(banType).toLowerCase() === 'permanent' || String(duration || '').toLowerCase().includes('permanent');
    const computedUntil = isPermanent ? null : calculateBannedUntil(duration, customDate);

    target.isBanned = true;
    target.isBlocked = true; // backward compatibility
    target.banType = isPermanent ? 'permanent' : 'temporary';
    target.banReason = reason;
    target.adminNote = adminNote;
    target.bannedAt = new Date();
    target.bannedUntil = computedUntil;
    target.bannedBy = adminUser.id || (adminUser as any)._id;
    target.bannedByName = adminUser.name || String(adminUser.userId || 'Admin');
    target.banVersion = (target.banVersion || 0) + 1;
    target.activeToken = '';
    target.refreshToken = '';

    await target.save();

    // Record Ban History
    await BanHistory.create({
      targetType: 'USER',
      targetId: String(target.userId),
      action: isPermanent ? 'PERMANENT_BAN' : 'TEMPORARY_BAN',
      banType: target.banType,
      duration: isPermanent ? 'Permanent' : duration || 'Temporary',
      reason,
      adminNote,
      adminId: adminUser.id || (adminUser as any)._id,
      adminName: target.bannedByName,
      bannedAt: target.bannedAt,
      bannedUntil: target.bannedUntil,
      metadata: { targetUserDbId: target._id, targetName: target.name },
    });

    // Force logout and disconnect active Socket.IO sessions
    try {
      const io = getIOOptional();
      if (io) {
        const userRoom = `user:${target.userId}`;
        const payload = formatBanPayload(
          {
            banType: target.banType,
            banReason: target.banReason,
            bannedAt: target.bannedAt,
            bannedUntil: target.bannedUntil,
          },
          'USER'
        );
        io.to(userRoom).emit('force_logout', payload);
        io.to(`user:${target._id}`).emit('force_logout', payload);
        io.to(`user:${target.userId}`).emit('force_logout', payload);
        io.in(userRoom).disconnectSockets(true);
      }
    } catch (sockErr: any) {
      console.warn('[BanController] Socket force logout notice:', sockErr?.message);
    }

    return sendResponse(res, 200, true, `User ${target.userId} banned successfully (${target.banType})`, {
      userId: target.userId,
      isBanned: target.isBanned,
      banType: target.banType,
      bannedAt: target.bannedAt,
      bannedUntil: target.bannedUntil,
      remainingTime: getRemainingTimeString(target.bannedUntil),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to ban user');
  }
};

/**
 * POST /api/admin/bans/user/unban
 * Unban a User ID
 */
export const unbanUser = async (req: AuthRequest, res: Response) => {
  try {
    const adminUser = req.user;
    if (!adminUser || !isAuthorizedAdmin(adminUser.role)) {
      return sendResponse(res, 403, false, 'Permission denied: Authorized administrator access required.');
    }

    const { userId, reason = 'Unbanned by administrator', adminNote = '' } = req.body;
    if (!userId) {
      return sendResponse(res, 400, false, 'User ID is required');
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

    const previousBanType = target.banType;
    target.isBanned = false;
    target.isBlocked = false;
    target.banType = null;
    target.bannedUntil = null;
    target.banReason = '';
    target.adminNote = adminNote || target.adminNote;
    target.banVersion = (target.banVersion || 0) + 1;

    await target.save();

    await BanHistory.create({
      targetType: 'USER',
      targetId: String(target.userId),
      action: 'UNBAN',
      banType: previousBanType,
      reason,
      adminNote,
      adminId: adminUser.id || (adminUser as any)._id,
      adminName: adminUser.name || String(adminUser.userId || 'Admin'),
      metadata: { targetUserDbId: target._id, targetName: target.name },
    });

    return sendResponse(res, 200, true, `User ${target.userId} unbanned successfully`, {
      userId: target.userId,
      isBanned: false,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to unban user');
  }
};

/**
 * POST /api/admin/bans/device
 * Ban a Device ID (temporary or permanent)
 */
export const banDevice = async (req: AuthRequest, res: Response) => {
  try {
    const adminUser = req.user;
    if (!adminUser || !isAuthorizedAdmin(adminUser.role)) {
      return sendResponse(res, 403, false, 'Permission denied: Authorized administrator access required.');
    }

    const { deviceId, banType = 'temporary', duration, customDate, reason = 'Device suspended by administrator', adminNote = '' } = req.body;
    const cleanDeviceId = String(deviceId || '').trim();
    if (!cleanDeviceId) {
      return sendResponse(res, 400, false, 'Device ID is required');
    }

    const isPermanent = String(banType).toLowerCase() === 'permanent' || String(duration || '').toLowerCase().includes('permanent');
    const computedUntil = isPermanent ? null : calculateBannedUntil(duration, customDate);

    // Find users currently associated with this device
    const associatedUsers = await User.find({
      $or: [
        { 'device.createdDeviceId': cleanDeviceId },
        { 'device.currentDeviceId': cleanDeviceId },
        { 'device.loggedInDeviceIds': cleanDeviceId },
      ],
      isDeleted: false,
    }).select('userId _id').lean();

    const associatedIds = associatedUsers.map((u) => u.userId).filter(Boolean);

    const device = await Device.findOneAndUpdate(
      { deviceId: cleanDeviceId },
      {
        $set: {
          isBanned: true,
          banType: isPermanent ? 'permanent' : 'temporary',
          banReason: reason,
          adminNote,
          bannedAt: new Date(),
          bannedUntil: computedUntil,
          bannedBy: adminUser.id || (adminUser as any)._id,
          bannedByName: adminUser.name || String(adminUser.userId || 'Admin'),
          lastSeenAt: new Date(),
        },
        $addToSet: { associatedUserIds: { $each: associatedIds } },
        $setOnInsert: { firstSeenAt: new Date(), platform: 'android' },
      },
      { upsert: true, new: true }
    );

    // Record Ban History
    await BanHistory.create({
      targetType: 'DEVICE',
      targetId: cleanDeviceId,
      action: isPermanent ? 'PERMANENT_BAN' : 'TEMPORARY_BAN',
      banType: device.banType,
      duration: isPermanent ? 'Permanent' : duration || 'Temporary',
      reason,
      adminNote,
      adminId: adminUser.id || (adminUser as any)._id,
      adminName: device.bannedByName,
      bannedAt: device.bannedAt,
      bannedUntil: device.bannedUntil,
      metadata: { associatedUserIds: device.associatedUserIds },
    });

    // Disconnect active sockets for any user associated with this device
    try {
      const io = getIOOptional();
      if (io) {
        const payload = formatBanPayload(
          {
            banType: device.banType,
            banReason: device.banReason,
            bannedAt: device.bannedAt,
            bannedUntil: device.bannedUntil,
            deviceId: cleanDeviceId,
          },
          'DEVICE'
        );
        for (const u of associatedUsers) {
          const userRoom = `user:${u.userId}`;
          io.to(userRoom).emit('force_logout', payload);
          io.to(`user:${u._id}`).emit('force_logout', payload);
          io.in(userRoom).disconnectSockets(true);
        }
      }
    } catch (sockErr: any) {
      console.warn('[BanController] Socket force logout for device notice:', sockErr?.message);
    }

    return sendResponse(res, 200, true, `Device ${cleanDeviceId} banned successfully (${device.banType})`, {
      deviceId: device.deviceId,
      isBanned: device.isBanned,
      banType: device.banType,
      bannedAt: device.bannedAt,
      bannedUntil: device.bannedUntil,
      remainingTime: getRemainingTimeString(device.bannedUntil),
      associatedUserIds: device.associatedUserIds,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to ban device');
  }
};

/**
 * POST /api/admin/bans/device/unban
 * Unban a Device ID
 */
export const unbanDevice = async (req: AuthRequest, res: Response) => {
  try {
    const adminUser = req.user;
    if (!adminUser || !isAuthorizedAdmin(adminUser.role)) {
      return sendResponse(res, 403, false, 'Permission denied: Authorized administrator access required.');
    }

    const { deviceId, reason = 'Unbanned by administrator', adminNote = '' } = req.body;
    const cleanDeviceId = String(deviceId || '').trim();
    if (!cleanDeviceId) {
      return sendResponse(res, 400, false, 'Device ID is required');
    }

    const device = await Device.findOne({ deviceId: cleanDeviceId });
    if (!device) {
      return sendResponse(res, 404, false, 'Device record not found');
    }

    const previousBanType = device.banType;
    device.isBanned = false;
    device.banType = null;
    device.bannedUntil = null;
    device.banReason = '';
    device.adminNote = adminNote || device.adminNote;

    await device.save();

    await BanHistory.create({
      targetType: 'DEVICE',
      targetId: cleanDeviceId,
      action: 'UNBAN',
      banType: previousBanType,
      reason,
      adminNote,
      adminId: adminUser.id || (adminUser as any)._id,
      adminName: adminUser.name || String(adminUser.userId || 'Admin'),
      metadata: { associatedUserIds: device.associatedUserIds },
    });

    return sendResponse(res, 200, true, `Device ${cleanDeviceId} unbanned successfully`, {
      deviceId: cleanDeviceId,
      isBanned: false,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to unban device');
  }
};

/**
 * GET /api/admin/bans/history
 * View Ban History for a target (USER or DEVICE) or all targets
 */
export const getBanHistory = async (req: AuthRequest, res: Response) => {
  try {
    const adminUser = req.user;
    if (!adminUser || !isAuthorizedAdmin(adminUser.role)) {
      return sendResponse(res, 403, false, 'Permission denied');
    }

    const { targetType, targetId, page = 1, limit = 20 } = req.query;
    const filter: any = {};
    if (targetType) filter.targetType = String(targetType).toUpperCase();
    if (targetId) filter.targetId = String(targetId).trim();

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      BanHistory.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      BanHistory.countDocuments(filter),
    ]);

    return sendResponse(res, 200, true, 'Ban history fetched successfully', {
      history: items,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch ban history');
  }
};

/**
 * GET /api/admin/bans/devices
 * List registered devices with ban status and search
 */
export const listDevices = async (req: AuthRequest, res: Response) => {
  try {
    const adminUser = req.user;
    if (!adminUser || !isAuthorizedAdmin(adminUser.role)) {
      return sendResponse(res, 403, false, 'Permission denied');
    }

    const { search, status = 'all', page = 1, limit = 20 } = req.query;
    const filter: any = {};

    if (status === 'banned') filter.isBanned = true;
    if (status === 'active') filter.isBanned = false;

    if (search) {
      const q = String(search).trim();
      const numQ = Number(q);
      filter.$or = [
        { deviceId: { $regex: q, $options: 'i' } },
        ...(isNaN(numQ) ? [] : [{ associatedUserIds: numQ }]),
      ];
    }

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [devices, total] = await Promise.all([
      Device.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limitNum).lean(),
      Device.countDocuments(filter),
    ]);

    const enriched = devices.map((d) => ({
      ...d,
      remainingTime: d.isBanned && d.bannedUntil ? getRemainingTimeString(d.bannedUntil) : d.isBanned ? 'Permanent' : null,
    }));

    return sendResponse(res, 200, true, 'Devices fetched successfully', {
      devices: enriched,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to list devices');
  }
};

/**
 * GET /api/admin/bans/dashboard
 * Summary statistics of bans
 */
export const getBanDashboard = async (req: AuthRequest, res: Response) => {
  try {
    const adminUser = req.user;
    if (!adminUser || !isAuthorizedAdmin(adminUser.role)) {
      return sendResponse(res, 403, false, 'Permission denied');
    }

    const now = new Date();

    const [
      totalBannedUsers,
      tempUserBans,
      permUserBans,
      totalBannedDevices,
      tempDeviceBans,
      permDeviceBans,
      recentActivity,
    ] = await Promise.all([
      User.countDocuments({ isBanned: true, isDeleted: false }),
      User.countDocuments({ isBanned: true, banType: 'temporary', isDeleted: false }),
      User.countDocuments({ isBanned: true, banType: 'permanent', isDeleted: false }),
      Device.countDocuments({ isBanned: true }),
      Device.countDocuments({ isBanned: true, banType: 'temporary' }),
      Device.countDocuments({ isBanned: true, banType: 'permanent' }),
      BanHistory.find().sort({ createdAt: -1 }).limit(15).lean(),
    ]);

    return sendResponse(res, 200, true, 'Ban dashboard data fetched', {
      users: {
        totalBanned: totalBannedUsers,
        temporary: tempUserBans,
        permanent: permUserBans,
      },
      devices: {
        totalBanned: totalBannedDevices,
        temporary: tempDeviceBans,
        permanent: permDeviceBans,
      },
      recentActivity,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch ban dashboard');
  }
};

/**
 * GET /api/admin/bans/users
 * Specifically lists banned users with filters, remaining time, and search
 */
export const getBannedUsers = async (req: AuthRequest, res: Response) => {
  try {
    const adminUser = req.user;
    if (!adminUser || !isAuthorizedAdmin(adminUser.role)) {
      return sendResponse(res, 403, false, 'Permission denied');
    }

    const { search, banType = 'all', status = 'active', page = 1, limit = 20 } = req.query;
    const filter: any = { isDeleted: false };

    if (status === 'active') {
      filter.$or = [{ isBanned: true }, { isBlocked: true }];
    } else if (status === 'temporary') {
      filter.isBanned = true;
      filter.banType = 'temporary';
    } else if (status === 'permanent') {
      filter.isBanned = true;
      filter.banType = 'permanent';
    } else if (status === 'expired') {
      filter.isBanned = false;
      filter.bannedUntil = { $ne: null, $lt: new Date() };
    } else if (status === 'unbanned') {
      filter.isBanned = false;
      filter.bannedAt = { $ne: null };
    } else {
      // 'all'
      filter.$or = [{ isBanned: true }, { isBlocked: true }, { bannedAt: { $ne: null } }];
    }

    if (banType && banType !== 'all') {
      filter.banType = String(banType).toLowerCase();
    }

    if (search) {
      const q = String(search).trim();
      const escaped = q.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const searchConditions: any[] = [
        { name: regex },
        { userName: regex },
        { banReason: regex },
        { bannedByName: regex },
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
        .select('userId name userName image avatar isBanned isBlocked banType banReason adminNote bannedAt bannedUntil bannedByName role')
        .sort({ bannedAt: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(filter),
    ]);

    const enriched = users.map((u: any) => ({
      ...u,
      remainingTime: u.isBanned && u.bannedUntil ? getRemainingTimeString(u.bannedUntil) : u.isBanned ? 'Permanent' : 'Expired / Inactive',
    }));

    return sendResponse(res, 200, true, 'Banned users fetched successfully', {
      users: enriched,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Failed to fetch banned users');
  }
};
