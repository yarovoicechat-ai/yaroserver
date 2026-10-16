import express from 'express';
import {
  getPublishedSvipPlans,
  getSvipPlanDetails,
  purchaseSvipPlan,
  adminListSvipPlans,
  adminCreateSvipPlan,
  adminUpdateSvipPlan,
  adminDuplicateSvipPlan,
  adminToggleSvipPlan,
  adminDeleteSvipPlan,
  adminReseedSvipPlans,
} from '../controllers/svipPlan.controller';
import { verifyToken, requireRoles } from '../middlewares/authorize.middleware';

const router = express.Router();
const adminRoles = requireRoles('owner', 'superAdmin', 'admin', 'operator');

// Public / Mobile Client Catalog
router.get('/', getPublishedSvipPlans);
router.get('/details/:idOrSlug', getSvipPlanDetails);

// Authenticated Purchase
router.post('/purchase', verifyToken, purchaseSvipPlan);

// Admin SVIP Plan Builder & Management
router.get('/admin/all', verifyToken, adminRoles, adminListSvipPlans);
router.post('/admin/create', verifyToken, adminRoles, adminCreateSvipPlan);
router.put('/admin/:id', verifyToken, adminRoles, adminUpdateSvipPlan);
router.patch('/admin/:id', verifyToken, adminRoles, adminUpdateSvipPlan);
router.post('/admin/:id/duplicate', verifyToken, adminRoles, adminDuplicateSvipPlan);
router.patch('/admin/:id/toggle', verifyToken, adminRoles, adminToggleSvipPlan);
router.delete('/admin/:id', verifyToken, adminRoles, adminDeleteSvipPlan);
router.post('/admin/reseed', verifyToken, adminRoles, adminReseedSvipPlans);
router.post('/reseed', verifyToken, adminRoles, adminReseedSvipPlans);

export const svipPlanRouter = router;
