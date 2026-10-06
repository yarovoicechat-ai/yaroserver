// level.routes.ts - Express Routes for Level System
import { Router } from 'express';
import {
  getMyLevelStatus,
  getLevelConfig,
  claimReward,
  equipReward,
  adminAdjustUserExp,
  adminSearchUsersLevels,
} from '../controllers/level.controller';
import { verifyToken, requireRoles } from '../middlewares/authorize.middleware';

const router = Router();
const adminRoles = requireRoles('owner', 'superAdmin', 'admin');

// User routes
router.get('/me', verifyToken, getMyLevelStatus);
router.get('/status', verifyToken, getMyLevelStatus);
router.get('/config', getLevelConfig);
router.post('/claim', verifyToken, claimReward);
router.post('/equip', verifyToken, equipReward);

// Admin routes
router.post('/admin/adjust-exp', verifyToken, adminRoles, adminAdjustUserExp);
router.get('/admin/users', verifyToken, adminRoles, adminSearchUsersLevels);

export default router;
