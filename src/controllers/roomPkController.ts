import { Response } from 'express';
import { AuthRequest } from '../middlewares/authorize.middleware';
import sendResponse from '../utils/reponse';
import { currentPK, invitePK, pkHistory, pkOpponents, respondPK, RoomPKError } from '../services/roomPk.service';

const handle = (work: (req: AuthRequest) => Promise<any>) => async (req: AuthRequest, res: Response) => {
  try { return sendResponse(res, 200, true, 'PK updated', await work(req)); }
  catch (error: any) {
    const status = error instanceof RoomPKError ? error.status : 503;
    if (status === 503) console.warn('[RoomPK] Request notice:', error?.message);
    return sendResponse(res, status, false, status === 503 ? 'PK is temporarily unavailable. Please try again.' : error.message);
  }
};

export const getCurrentRoomPK = handle(req => currentPK(String(req.params.id)));
export const getRoomPKHistory = handle(req => pkHistory(String(req.params.id)));
export const getRoomPKOpponents = handle(req => pkOpponents(String(req.params.id)));
export const inviteRoomPK = handle(req => invitePK(String(req.params.id), String(req.body?.targetRoomId || ''), req.user));
export const respondRoomPK = handle(req => respondPK(String(req.params.matchId), String(req.params.id), String(req.body?.decision || ''), req.user));
