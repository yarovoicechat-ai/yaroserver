import { Router } from 'express';
import { getVoiceClubConfig, joinVoiceQueue, getVipRewards } from '../controllers/voiceClubController';

const router = Router();

router.get('/config', getVoiceClubConfig);
router.post('/queue/join', joinVoiceQueue);
router.get('/vip-rewards', getVipRewards);

export default router;
