import { Router } from 'express';
import {
  getFamilies,
  getFamilyById,
  createFamily,
  joinFamily,
  adminGetFamilies,
  adminUpdateFamily,
  adminDeleteFamily,
} from '../controllers/family.controller';
import { verifyToken, requireRoles } from '../middlewares/authorize.middleware';

const router = Router();
const adminManagers = requireRoles('owner', 'superAdmin', 'admin', 'operator');

// Public / Mobile app
router.get('/', getFamilies);
router.get('/:id', getFamilyById);
router.post('/create', verifyToken, createFamily);
router.post('/:id/join', verifyToken, joinFamily);

// Admin management
router.get('/admin/all', verifyToken, adminManagers, adminGetFamilies);
router.put('/admin/:id', verifyToken, adminManagers, adminUpdateFamily);
router.delete('/admin/:id', verifyToken, adminManagers, adminDeleteFamily);

export default router;
