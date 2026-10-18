import { Request, Response } from 'express';
import { User } from '../models/user.model';
import sendResponse from '../utils/reponse';
import { getIOOptional, getUserRoom } from '../sockets';

const parseAppUserId = (value: unknown): number | null => {
  const raw = String(value ?? '').trim();
  if (!/^\d{1,15}$/.test(raw)) return null;
  const userId = Number(raw);
  return Number.isSafeInteger(userId) ? userId : null;
};

export interface OfficialPowersPayload {
  canBanRoom?: boolean;
  canBanUser?: boolean;
  canGhostEntry?: boolean;
  canKickAnyUser?: boolean;
  canMuteAnyUser?: boolean;
  canLockAnySeat?: boolean;
  isGlobalRoomManager?: boolean;
}

/**
 * Lists all users with official in-app powers or global room manager access.
 */
export const listOfficialPowerUsers = async (_req: Request, res: Response) => {
  try {
    const users = await User.find({
      $or: [
        { isGlobalRoomManager: true },
        { 'officialPowers.canBanRoom': true },
        { 'officialPowers.canBanUser': true },
        { 'officialPowers.canGhostEntry': true },
        { 'officialPowers.canKickAnyUser': true },
        { 'officialPowers.canMuteAnyUser': true },
        { 'officialPowers.canLockAnySeat': true },
        { 'officialPowers.isGlobalRoomManager': true },
      ],
      isDeleted: false,
    })
      .select('userId name userName image role officialPowers isGlobalRoomManager isBlocked status createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .lean();

    const formatted = users.map((u: any) => ({
      userId: u.userId,
      name: u.name || 'User #' + u.userId,
      userName: u.userName || '',
      image: u.image || '',
      role: u.role || 'user',
      isBlocked: Boolean(u.isBlocked),
      status: u.status || 'Active',
      isGlobalRoomManager: Boolean(u.isGlobalRoomManager || u.officialPowers?.isGlobalRoomManager),
      officialPowers: {
        canBanRoom: Boolean(u.officialPowers?.canBanRoom),
        canBanUser: Boolean(u.officialPowers?.canBanUser),
        canGhostEntry: Boolean(u.officialPowers?.canGhostEntry),
        canKickAnyUser: Boolean(u.officialPowers?.canKickAnyUser),
        canMuteAnyUser: Boolean(u.officialPowers?.canMuteAnyUser),
        canLockAnySeat: Boolean(u.officialPowers?.canLockAnySeat),
        isGlobalRoomManager: Boolean(u.officialPowers?.isGlobalRoomManager || u.isGlobalRoomManager),
      },
      updatedAt: u.updatedAt,
      createdAt: u.createdAt,
    }));

    return sendResponse(res, 200, true, 'Official power users retrieved successfully', formatted);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Could not fetch official power users');
  }
};

/**
 * Searches a user by numeric userId, phone, name or userName to inspect or grant powers.
 */
export const searchUserForPowers = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return sendResponse(res, 400, false, 'Please provide a search term (numeric ID, name, username, or phone)');
    }

    const numericId = parseAppUserId(q);
    const conditions: any[] = [];

    if (numericId !== null) {
      conditions.push({ userId: numericId });
    }
    conditions.push(
      { userName: { $regex: q, $options: 'i' } },
      { name: { $regex: q, $options: 'i' } },
      { phoneNumber: { $regex: q, $options: 'i' } }
    );

    const users = await User.find({
      $or: conditions,
      isDeleted: false,
    })
      .select('userId name userName image role officialPowers isGlobalRoomManager isBlocked status diamonds coins level')
      .limit(10)
      .lean();

    const formatted = users.map((u: any) => ({
      userId: u.userId,
      name: u.name || 'User #' + u.userId,
      userName: u.userName || '',
      image: u.image || '',
      role: u.role || 'user',
      level: u.level || 1,
      diamonds: u.diamonds || 0,
      coins: u.coins || 0,
      isBlocked: Boolean(u.isBlocked),
      status: u.status || 'Active',
      isGlobalRoomManager: Boolean(u.isGlobalRoomManager || u.officialPowers?.isGlobalRoomManager),
      officialPowers: {
        canBanRoom: Boolean(u.officialPowers?.canBanRoom),
        canBanUser: Boolean(u.officialPowers?.canBanUser),
        canGhostEntry: Boolean(u.officialPowers?.canGhostEntry),
        canKickAnyUser: Boolean(u.officialPowers?.canKickAnyUser),
        canMuteAnyUser: Boolean(u.officialPowers?.canMuteAnyUser),
        canLockAnySeat: Boolean(u.officialPowers?.canLockAnySeat),
        isGlobalRoomManager: Boolean(u.officialPowers?.isGlobalRoomManager || u.isGlobalRoomManager),
      },
    }));

    return sendResponse(res, 200, true, 'Users found', formatted);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Error searching user');
  }
};

/**
 * Grants, updates, or adjusts checkboxes of official powers for a specific User ID.
 */
export const setOfficialPowers = async (req: Request, res: Response) => {
  try {
    const userId = parseAppUserId(req.body?.userId);
    if (userId === null) {
      return sendResponse(res, 400, false, 'Please enter a valid numeric app user ID');
    }

    const powers: OfficialPowersPayload = req.body?.powers || {};
    const target = await User.findOne({ userId, isDeleted: false });
    if (!target) {
      return sendResponse(res, 404, false, 'App user not found with ID ' + userId);
    }

    const updatedPowers = {
      canBanRoom: Boolean(powers.canBanRoom),
      canBanUser: Boolean(powers.canBanUser),
      canGhostEntry: Boolean(powers.canGhostEntry),
      canKickAnyUser: Boolean(powers.canKickAnyUser),
      canMuteAnyUser: Boolean(powers.canMuteAnyUser),
      canLockAnySeat: Boolean(powers.canLockAnySeat),
      isGlobalRoomManager: Boolean(powers.isGlobalRoomManager),
    };

    const hasAnyActivePower = Object.values(updatedPowers).some(Boolean);
    const effectiveIsGlobalManager = Boolean(updatedPowers.isGlobalRoomManager || updatedPowers.canBanRoom);

    target.officialPowers = updatedPowers;
    target.isGlobalRoomManager = effectiveIsGlobalManager;
    await target.save();

    // Emit real-time notification to user's mobile app socket room
    const io = getIOOptional();
    if (io) {
      io.to(getUserRoom(String(target.userId))).emit('voice_room:official_powers_updated', {
        userId: target.userId,
        officialPowers: updatedPowers,
        isGlobalRoomManager: effectiveIsGlobalManager,
      });
      io.to(getUserRoom(String(target.userId))).emit('voice_room:manager_role_updated', {
        isGlobalRoomManager: effectiveIsGlobalManager,
      });
    }

    return sendResponse(res, 200, true, 'Official ID powers updated successfully', {
      userId: target.userId,
      name: target.name,
      userName: target.userName,
      image: target.image,
      role: target.role,
      officialPowers: updatedPowers,
      isGlobalRoomManager: effectiveIsGlobalManager,
      hasAnyActivePower,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Could not update official ID powers');
  }
};

/**
 * Revokes all official in-app powers from a User ID.
 */
export const revokeAllOfficialPowers = async (req: Request, res: Response) => {
  try {
    const userId = parseAppUserId(req.params.userId);
    if (userId === null) {
      return sendResponse(res, 400, false, 'Invalid app user ID');
    }

    const target = await User.findOneAndUpdate(
      { userId, isDeleted: false },
      {
        $set: {
          isGlobalRoomManager: false,
          officialPowers: {
            canBanRoom: false,
            canBanUser: false,
            canGhostEntry: false,
            canKickAnyUser: false,
            canMuteAnyUser: false,
            canLockAnySeat: false,
            isGlobalRoomManager: false,
          },
        },
      },
      { new: true }
    ).select('userId name userName image role officialPowers isGlobalRoomManager');

    if (!target) {
      return sendResponse(res, 404, false, 'App user not found');
    }

    // Emit real-time revoking event to user's mobile app
    const io = getIOOptional();
    if (io) {
      io.to(getUserRoom(String(target.userId))).emit('voice_room:official_powers_updated', {
        userId: target.userId,
        officialPowers: target.officialPowers,
        isGlobalRoomManager: false,
      });
      io.to(getUserRoom(String(target.userId))).emit('voice_room:manager_role_updated', {
        isGlobalRoomManager: false,
      });
    }

    return sendResponse(res, 200, true, 'All official powers revoked from ID ' + userId, target);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Could not revoke official powers');
  }
};
