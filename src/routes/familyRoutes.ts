import { Router } from 'express';
import {
  getFamilies,
  getMyFamily,
  getFamilyById,
  createFamily,
  requestJoinFamily,
  handleJoinRequest,
  inviteToFamily,
  respondFamilyInvitation,
  leaveFamily,
  manageMember,
  familyCheckin,
  updateFamilyNotice,
  getSupportRoom,
  adminGetFamilies,
  adminApproveFamily,
  adminRejectFamily,
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
router.get('/support-room', getSupportRoom);
router.get('/:id', getFamilyById);
router.post('/create', verifyToken, createFamily);
router.post('/checkin', verifyToken, familyCheckin);
router.post('/leave', verifyToken, leaveFamily);
router.post('/:id/request', verifyToken, requestJoinFamily);
router.post('/:id/join', verifyToken, requestJoinFamily); // alias
router.post('/:id/requests/:requestId/action', verifyToken, handleJoinRequest);
router.post('/:id/invite', verifyToken, inviteToFamily);
router.post('/invitations/:familyId/:invitationId/respond', verifyToken, respondFamilyInvitation);
router.put('/:id/notice', verifyToken, updateFamilyNotice);
router.post('/:id/member/:memberId/action', verifyToken, manageMember);

// Admin management
router.get('/admin/all', verifyToken, adminManagers, adminGetFamilies);
router.post('/admin/:id/approve', verifyToken, adminManagers, adminApproveFamily);
router.post('/admin/:id/reject', verifyToken, adminManagers, adminRejectFamily);
router.put('/admin/:id', verifyToken, adminManagers, adminUpdateFamily);
router.delete('/admin/:id', verifyToken, adminManagers, adminDeleteFamily);

export default router;
