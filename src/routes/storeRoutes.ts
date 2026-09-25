import { Router } from 'express';
import {
  getStoreItems,
  getStoreItemById,
  createStoreItem,
  updateStoreItem,
  deleteStoreItem,
  toggleStoreItem,
  resetStoreCatalog,
  buyStoreItem,
} from '../controllers/storeController';
import { verifyToken } from '../middlewares/authorize.middleware';

const router = Router();

// Public / Mobile app queries
router.get('/items', getStoreItems);
router.get('/items/:id', getStoreItemById);
router.post('/buy', verifyToken, buyStoreItem);

// Admin management endpoints
router.post('/items', createStoreItem);
router.put('/items/:id', updateStoreItem);
router.delete('/items/:id', deleteStoreItem);
router.patch('/items/:id/toggle', toggleStoreItem);
router.post('/reset-catalog', resetStoreCatalog);

export default router;
