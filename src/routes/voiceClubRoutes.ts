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
} from '../controllers/voiceClubController';
import { verifyToken } from '../middlewares/authorize.middleware';

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

// Room Tasks & Room Support Endpoints
router.get('/rooms/:id/tasks', verifyToken, getRoomTasks);
router.post('/rooms/:id/tasks/:taskId/claim', verifyToken, claimTaskReward);
router.post('/rooms/:id/tasks/mic-heartbeat', verifyToken, recordMicHeartbeat);
router.get('/rooms/:id/support', verifyToken, getRoomSupport);
router.post('/rooms/:id/support/toggle-auto-send', verifyToken, toggleAutoSendSupport);

export default router;
