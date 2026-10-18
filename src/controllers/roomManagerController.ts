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

export const listGlobalRoomManagers = async (_req: Request, res: Response) => {
  try {
    const managers = await User.find({ isGlobalRoomManager: true, isDeleted: false })
      .select('userId name userName image role')
      .sort({ userId: 1 })
      .lean();
    return sendResponse(res, 200, true, 'Global room managers fetched', managers);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Could not fetch global room managers');
  }
};

export const grantGlobalRoomManager = async (req: Request, res: Response) => {
  try {
    const userId = parseAppUserId(req.body?.userId);
    if (userId === null) return sendResponse(res, 400, false, 'Enter a valid numeric app user ID');

    const target = await User.findOne({ userId, isDeleted: false });
    if (!target) return sendResponse(res, 404, false, 'App user not found');
    if (!['user', 'host'].includes(String(target.role))) {
      return sendResponse(res, 400, false, 'Global room manager access can only be assigned to an app user or host');
    }

    target.isGlobalRoomManager = true;
    await target.save();
    getIOOptional()?.to(getUserRoom(String(target.userId))).emit('voice_room:manager_role_updated', { isGlobalRoomManager: true });
    return sendResponse(res, 200, true, 'Global room manager access granted', {
      userId: target.userId,
      name: target.name,
      userName: target.userName,
      image: target.image,
      role: target.role,
      isGlobalRoomManager: true,
    });
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Could not grant global room manager access');
  }
};

export const revokeGlobalRoomManager = async (req: Request, res: Response) => {
  try {
    const userId = parseAppUserId(req.params.userId);
    if (userId === null) return sendResponse(res, 400, false, 'Invalid app user ID');
    const target = await User.findOneAndUpdate(
      { userId, isGlobalRoomManager: true },
      { $set: { isGlobalRoomManager: false } },
      { new: true },
    ).select('userId name userName');
    if (!target) return sendResponse(res, 404, false, 'Global room manager not found');
    getIOOptional()?.to(getUserRoom(String(target.userId))).emit('voice_room:manager_role_updated', { isGlobalRoomManager: false });
    return sendResponse(res, 200, true, 'Global room manager access revoked', target);
  } catch (error: any) {
    return sendResponse(res, 500, false, error.message || 'Could not revoke global room manager access');
  }
};
