import { Router } from 'express';
import {
  getCouples,
  getMyCp,
  dissolveCp,
  adminGetCouples,
  adminUpdateCouple,
  adminDeleteCouple,
} from '../controllers/couple.controller';
import { verifyToken, requireRoles } from '../middlewares/authorize.middleware';

const router = Router();
const adminManagers = requireRoles('owner', 'superAdmin', 'admin', 'operator');

// Public / Mobile app
router.get('/', getCouples);
router.get('/my', verifyToken, getMyCp);
router.post('/dissolve', verifyToken, dissolveCp);

// Admin management
router.get('/admin/all', verifyToken, adminManagers, adminGetCouples);
router.put('/admin/:id', verifyToken, adminManagers, adminUpdateCouple);
router.delete('/admin/:id', verifyToken, adminManagers, adminDeleteCouple);

export default router;
