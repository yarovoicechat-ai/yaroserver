import { Router } from 'express';
import {
  submitAvatarRequest,
  getAvatarRequests,
  approveAvatarRequest,
  rejectAvatarRequest,
} from '../controllers/avatarRequestController';
import { verifyToken } from '../middlewares/authorize.middleware';
import { avatarUpload } from '../middlewares/avatarUpload';

const router = Router();

// User / Host avatar update (zero verification required, supports direct multipart image or JSON body)
router.post(
  '/',
  verifyToken,
  avatarUpload.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'profilePic', maxCount: 1 },
  ]),
  submitAvatarRequest
);

// Admin endpoints
router.get('/', verifyToken, getAvatarRequests);
router.put('/:id/approve', verifyToken, approveAvatarRequest);
router.put('/:id/reject', verifyToken, rejectAvatarRequest);

export default router;

