import express from 'express';
import { verifyToken } from '../middlewares/authorize.middleware';
import { GiftController } from './gift.controller';
import {
  validateSendGift,
  validateCreateGift,
  validateCategory,
} from './gift.validation';

export const giftRouter = express.Router();
export const adminGiftRouter = express.Router();

// ========================
// Client / User Routes
// ========================

// 1. Get All Active Gifts (with category, rarity, search filters)
giftRouter.get('/', verifyToken, GiftController.getGifts);
giftRouter.get('/all', verifyToken, GiftController.getGifts); // Backwards-compatible alias

// 2. Dynamic Categories
giftRouter.get('/categories', verifyToken, GiftController.getCategories);

// 3. Send Gift (Atomic Diamonds, Idempotent requestId)
giftRouter.post('/send', verifyToken, validateSendGift, GiftController.sendGift);

// 4. Gift History
giftRouter.get('/history', verifyToken, GiftController.getHistory);
giftRouter.get('/sent', verifyToken, GiftController.getSentGifts);
giftRouter.get('/received', verifyToken, GiftController.getReceivedGifts);

// ========================
// Admin Gift Routes (Mounted on /api/admin/gifts AND /api/gifts/admin)
// ========================

const setupAdminRoutes = (router: express.Router) => {
  // Gift CRUD
  router.get('/', verifyToken, GiftController.getGifts);
  router.get('/all', verifyToken, GiftController.getGifts);
  router.get('/admin-all', verifyToken, (req, res, next) => { req.query.includeInactive = 'true'; next(); }, GiftController.getGifts);
  router.post('/', verifyToken, validateCreateGift, GiftController.adminCreateGift);
  router.post('/create', verifyToken, validateCreateGift, GiftController.adminCreateGift);
  router.put('/:id', verifyToken, GiftController.adminUpdateGift);
  router.patch('/:id', verifyToken, GiftController.adminUpdateGift);
  router.patch('/:id/status', verifyToken, GiftController.adminToggleStatus);
  router.patch('/:id/toggle', verifyToken, GiftController.adminToggleStatus);
  router.delete('/:id', verifyToken, GiftController.adminDeleteGift);

  // Category CRUD
  router.post('/categories', verifyToken, validateCategory, GiftController.adminCreateCategory);
  router.patch('/categories/:id', verifyToken, GiftController.adminUpdateCategory);
  router.delete('/categories/:id', verifyToken, GiftController.adminDeleteCategory);
};

setupAdminRoutes(adminGiftRouter);
setupAdminRoutes(giftRouter); // Allows /api/gifts/admin or direct admin calls

export default giftRouter;
