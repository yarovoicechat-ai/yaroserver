import express from 'express';
import {
  getPublishedKingPlans,
  purchaseKingPlan,
  claimDailyKingReward,
  adminListKingPlans,
  adminCreateKingPlan,
  adminUpdateKingPlan,
  adminToggleKingPlan,
  adminDeleteKingPlan,
  adminReseedKingPlans,
} from '../controllers/kingPlan.controller';
import { verifyToken, requireRoles } from '../middlewares/authorize.middleware';

const router = express.Router();
const adminRoles = requireRoles('owner', 'superAdmin', 'admin', 'operator');

// Public / Mobile Client Catalog
router.get('/', getPublishedKingPlans);

// Authenticated Client Actions
router.post('/purchase', verifyToken, purchaseKingPlan);
router.post('/claim-daily', verifyToken, claimDailyKingReward);

// Admin Console CRUD & Reseed
router.get('/admin', verifyToken, adminRoles, adminListKingPlans);
router.get('/admin/all', verifyToken, adminRoles, adminListKingPlans);
router.get('/admin/plans', verifyToken, adminRoles, adminListKingPlans);
router.post('/admin/create', verifyToken, adminRoles, adminCreateKingPlan);
router.put('/admin/:id', verifyToken, adminRoles, adminUpdateKingPlan);
router.patch('/admin/:id', verifyToken, adminRoles, adminUpdateKingPlan);
router.patch('/admin/:id/toggle', verifyToken, adminRoles, adminToggleKingPlan);
router.delete('/admin/:id', verifyToken, adminRoles, adminDeleteKingPlan);
router.post('/admin/reseed', verifyToken, adminRoles, adminReseedKingPlans);

export const kingPlanRouter = router;
