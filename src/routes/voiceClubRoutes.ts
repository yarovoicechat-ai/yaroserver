import { Router } from 'express';
import {
  getVoiceClubConfig,
  joinVoiceQueue,
  getVipRewards,
  getAllActiveVoiceRooms,
  getMyVoiceRoom,
  createOrUpdateMyVoiceRoom,
  closeVoiceRoom,
  getVoiceRoomToken,
  getRoomAdmins,
  removeRoomAdmin,
  setRoomLockPin,
  verifyRoomLockPin,
  getRoomCalculator,
  startRoomCalculator,
  endRoomCalculator,
} from '../controllers/voiceClubController';
import { verifyToken } from '../middlewares/authorize.middleware';
import {
  cancelRoomPK,
  createRoomPK,
  getCurrentRoomPK,
  getRoomPKHistory,
  getRoomPKOpponents,
  inviteRoomPK,
  respondRoomPK,
  voteRoomPK,
  matchRoomPK,
  cancelMatchRoomPK,
} from '../controllers/roomPkController';

import {
  getRoomTasks,
  claimTaskReward,
  recordMicHeartbeat,
  getRoomSupport,
  toggleAutoSendSupport,
} from '../controllers/roomTaskController';

import {
  getRoomContributors,
  getFanClubDetails,
  joinRoomFanClub,
  recordFanClubStayHeartbeat,
} from '../controllers/roomCommunityController';

import {
  searchYouTubeController,
  getWatchSessionController,
  selectVideoController,
  updatePlaybackController,
  closeWatchSessionController,
  addToQueueController,
  removeFromQueueController,
} from '../controllers/roomWatchController';

const router = Router();

router.get('/config', getVoiceClubConfig);
router.post('/queue/join', joinVoiceQueue);
router.get('/vip-rewards', getVipRewards);

// Voice Room Endpoints
router.get('/rooms', getAllActiveVoiceRooms);
router.get('/my-room', verifyToken, getMyVoiceRoom);
router.post('/my-room', verifyToken, createOrUpdateMyVoiceRoom);
router.post('/create-or-update', verifyToken, createOrUpdateMyVoiceRoom);
router.post('/rooms/:id/close', verifyToken, closeVoiceRoom);
router.get('/rooms/:id/agora-token', verifyToken, getVoiceRoomToken);
router.post('/rooms/:id/agora-token', verifyToken, getVoiceRoomToken);
router.get('/rooms/:id/pk', verifyToken, getCurrentRoomPK);
router.get('/rooms/:id/pk/history', verifyToken, getRoomPKHistory);
router.get('/rooms/:id/pk/opponents', verifyToken, getRoomPKOpponents);
router.post('/rooms/:id/pk/create', verifyToken, createRoomPK);
router.post('/rooms/:id/pk/invite', verifyToken, inviteRoomPK);
router.post('/rooms/:id/pk/vote', verifyToken, voteRoomPK);
router.post('/rooms/:id/pk/match', verifyToken, matchRoomPK);
router.post('/rooms/:id/pk/match/cancel', verifyToken, cancelMatchRoomPK);
router.post('/rooms/:id/pk/cancel', verifyToken, cancelRoomPK);
router.post('/rooms/:id/pk/:matchId/cancel', verifyToken, cancelRoomPK);
router.post('/rooms/:id/pk/:matchId/respond', verifyToken, respondRoomPK);

// Room Contributors & Leaderboard (Daily, Weekly, Monthly)
router.get('/rooms/:id/contributors', verifyToken, getRoomContributors);

// Room Fan Club Endpoints
router.get('/rooms/:id/fan-club', verifyToken, getFanClubDetails);
router.post('/rooms/:id/fan-club/join', verifyToken, joinRoomFanClub);
router.post('/rooms/:id/fan-club/stay', verifyToken, recordFanClubStayHeartbeat);

// Room Admins Management
router.get('/rooms/:id/admins', verifyToken, getRoomAdmins);
router.post('/rooms/:id/admins/remove', verifyToken, removeRoomAdmin);

// Room Lock & PIN
router.post('/rooms/:id/lock', verifyToken, setRoomLockPin);
router.post('/rooms/:id/verify-pin', verifyToken, verifyRoomLockPin);

// Room Calculator (Charm Activity) Endpoints
router.get('/rooms/:id/calculator', verifyToken, getRoomCalculator);
router.post('/rooms/:id/calculator/start', verifyToken, startRoomCalculator);
router.post('/rooms/:id/calculator/end', verifyToken, endRoomCalculator);

// Room Tasks & Room Support Endpoints
router.get('/rooms/:id/tasks', verifyToken, getRoomTasks);
router.post('/rooms/:id/tasks/:taskId/claim', verifyToken, claimTaskReward);
router.post('/rooms/:id/tasks/mic-heartbeat', verifyToken, recordMicHeartbeat);
router.get('/rooms/:id/support', verifyToken, getRoomSupport);
router.post('/rooms/:id/support/toggle-auto-send', verifyToken, toggleAutoSendSupport);

// YouTube Watch Together Endpoints
router.get('/youtube/search', verifyToken, searchYouTubeController);
router.get('/search', verifyToken, searchYouTubeController);
router.get('/rooms/:id/watch', verifyToken, getWatchSessionController);
router.post('/rooms/:id/watch/select', verifyToken, selectVideoController);
router.post('/rooms/:id/watch/playback', verifyToken, updatePlaybackController);
router.post('/rooms/:id/watch/close', verifyToken, closeWatchSessionController);
router.post('/rooms/:id/watch/queue', verifyToken, addToQueueController);
router.delete('/rooms/:id/watch/queue/:videoId', verifyToken, removeFromQueueController);

export default router;
