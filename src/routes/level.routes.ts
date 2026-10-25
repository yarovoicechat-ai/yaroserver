// level.routes.ts - Express Routes for Level System
import { Router } from 'express';
import {
  getMyLevelStatus,
  getLevelConfig,
  claimReward,
  equipReward,
  adminAdjustUserExp,
  adminSearchUsersLevels,
  getWealthLevels,
  saveWealthLevel,
  deleteWealthLevel,
} from '../controllers/level.controller';
import { verifyToken, requireRoles } from '../middlewares/authorize.middleware';

const router = Router();
const adminRoles = requireRoles('owner', 'superAdmin', 'admin');

import {
  requestUniqueId,
  getMyUniqueIdRequests,
  checkUniqueIdAvailability,
} from '../controllers/uniqueIdRequest.controller';

// User routes
router.get('/me', verifyToken, getMyLevelStatus);
router.get('/status', verifyToken, getMyLevelStatus);
router.get('/config', getLevelConfig);
router.post('/claim', verifyToken, claimReward);
router.post('/equip', verifyToken, equipReward);

// Unique ID Request Workflow (User Unlocks at Level -> Requests desired number -> Admin Approves)
router.post('/request-unique-id', verifyToken, requestUniqueId);
router.get('/my-unique-id-requests', verifyToken, getMyUniqueIdRequests);
router.get('/check-unique-id/:requestedId', verifyToken, checkUniqueIdAvailability);

// Wealth Levels configuration (Dynamic rewards, uploads & expiry days)
router.get('/wealth', getWealthLevels);
router.post('/wealth', verifyToken, adminRoles, saveWealthLevel);
router.put('/wealth/:level', verifyToken, adminRoles, saveWealthLevel);
router.delete('/wealth/:level', verifyToken, adminRoles, deleteWealthLevel);

// Admin routes
router.post('/admin/adjust-exp', verifyToken, adminRoles, adminAdjustUserExp);
router.get('/admin/users', verifyToken, adminRoles, adminSearchUsersLevels);

export default router;
