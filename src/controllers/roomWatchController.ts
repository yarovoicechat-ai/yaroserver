import { Response } from 'express';
import { AuthRequest } from '../middlewares/authorize.middleware';
import sendResponse from '../utils/reponse';
import {
  searchYouTube,
  getWatchSession,
  selectVideo,
  updatePlayback,
  closeWatchSession,
  addToQueue,
  removeFromQueue,
  RoomWatchError,
} from '../services/roomWatch.service';

const handle = (work: (req: AuthRequest) => Promise<any>) => async (req: AuthRequest, res: Response) => {
  try {
    return sendResponse(res, 200, true, 'Watch session updated', await work(req));
  } catch (error: any) {
    const status = error instanceof RoomWatchError ? error.status : 500;
    return sendResponse(res, status, false, error.message || 'Watch Together operation failed');
  }
};

import mongoose from 'mongoose';
import { User } from '../models/user.model';

export const searchYouTubeController = handle(async req => {
  const authUserId = String(req.user?.id || (req.user as any)?._id || '').trim();
  const numericUserId = req.user?.userId ? String(req.user.userId).trim() : '';

  if (!authUserId && !numericUserId) {
    throw new RoomWatchError('Authentication required to search videos', 401);
  }

  const userLookup: any[] = [];
  if (authUserId && mongoose.Types.ObjectId.isValid(authUserId)) userLookup.push({ _id: authUserId });
  if (numericUserId) userLookup.push({ userId: numericUserId });

  const userDoc = userLookup.length > 0 ? await User.findOne({ $or: userLookup }).select('hasVideoAccess canWatchTogether isBlocked isDeleted').lean() : null;

  if (!userDoc || (!userDoc.hasVideoAccess && !(userDoc as any).canWatchTogether)) {
    throw new RoomWatchError('Video Access Denied: You do not have permission to search or play videos. Permission required from Admin Panel.', 403);
  }

  const q = String(req.query?.q || '');
  const pageToken = String(req.query?.pageToken || '');
  return searchYouTube(q, pageToken);
});

export const getWatchSessionController = handle(async req => {
  const roomId = String(req.params.id || '');
  return getWatchSession(roomId);
});

export const selectVideoController = handle(async req => {
  const roomId = String(req.params.id || '');
  return selectVideo(roomId, req.body, req.user);
});

export const updatePlaybackController = handle(async req => {
  const roomId = String(req.params.id || '');
  return updatePlayback(roomId, req.body, req.user);
});

export const closeWatchSessionController = handle(async req => {
  const roomId = String(req.params.id || '');
  return closeWatchSession(roomId, req.user);
});

export const addToQueueController = handle(async req => {
  const roomId = String(req.params.id || '');
  return addToQueue(roomId, req.body, req.user);
});

export const removeFromQueueController = handle(async req => {
  const roomId = String(req.params.id || '');
  const videoId = String(req.params.videoId || '');
  return removeFromQueue(roomId, videoId, req.user);
});
