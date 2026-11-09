import { Router } from 'express';
import {
  getFamilies,
  getMyFamily,
  getFamilyById,
  createFamily,
  joinFamily,
  leaveFamily,
  manageMember,
  familyCheckin,
  updateFamilyNotice,
  adminGetFamilies,
  adminUpdateFamily,
  adminDeleteFamily,
} from '../controllers/family.controller';
import { verifyToken, requireRoles } from '../middlewares/authorize.middleware';

const router = Router();
const adminManagers = requireRoles('owner', 'superAdmin', 'admin', 'operator');

// Public / Mobile app
router.get('/', getFamilies);
router.get('/my', verifyToken, getMyFamily);
router.get('/me', verifyToken, getMyFamily);
router.get('/:id', getFamilyById);
router.post('/create', verifyToken, createFamily);
router.post('/checkin', verifyToken, familyCheckin);
router.post('/leave', verifyToken, leaveFamily);
router.post('/:id/join', verifyToken, joinFamily);
router.post('/:id/leave', verifyToken, leaveFamily);
router.put('/:id/notice', verifyToken, updateFamilyNotice);
router.post('/:id/member/:memberId/action', verifyToken, manageMember);

// Admin management
router.get('/admin/all', verifyToken, adminManagers, adminGetFamilies);
router.put('/admin/:id', verifyToken, adminManagers, adminUpdateFamily);
router.delete('/admin/:id', verifyToken, adminManagers, adminDeleteFamily);

export default router;
