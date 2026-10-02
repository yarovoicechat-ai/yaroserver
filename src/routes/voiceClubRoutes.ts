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

const router = Router();

router.get('/config', getVoiceClubConfig);
router.post('/queue/join', joinVoiceQueue);
router.get('/vip-rewards', getVipRewards);

// Voice Room Endpoints
router.get('/rooms', getAllActiveVoiceRooms);
router.get('/my-room', verifyToken, getMyVoiceRoom);
router.post('/my-room', verifyToken, createOrUpdateMyVoiceRoom);
router.post('/rooms/:id/close', verifyToken, closeVoiceRoom);
router.get('/rooms/:id/agora-token', getVoiceRoomToken);
router.post('/rooms/:id/agora-token', getVoiceRoomToken);

export default router;
