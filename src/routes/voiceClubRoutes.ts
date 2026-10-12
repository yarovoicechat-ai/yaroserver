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
} from '../controllers/voiceClubController';
import { verifyToken } from '../middlewares/authorize.middleware';

import {
  getRoomTasks,
  claimTaskReward,
  recordMicHeartbeat,
  getRoomSupport,
  toggleAutoSendSupport,
} from '../controllers/roomTaskController';

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
router.get('/rooms/:id/agora-token', getVoiceRoomToken);
router.post('/rooms/:id/agora-token', getVoiceRoomToken);

// Room Tasks & Room Support Endpoints
router.get('/rooms/:id/tasks', verifyToken, getRoomTasks);
router.post('/rooms/:id/tasks/:taskId/claim', verifyToken, claimTaskReward);
router.post('/rooms/:id/tasks/mic-heartbeat', verifyToken, recordMicHeartbeat);
router.get('/rooms/:id/support', verifyToken, getRoomSupport);
router.post('/rooms/:id/support/toggle-auto-send', verifyToken, toggleAutoSendSupport);

export default router;
