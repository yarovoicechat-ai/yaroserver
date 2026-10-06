import { Router } from 'express';
import {
  getStoreItems,
  getStoreItemById,
  getStoreInventory,
  getStoreLevels,
  createStoreItem,
  updateStoreItem,
  deleteStoreItem,
  toggleStoreItem,
  getKingMembers,
  grantKingMembership,
  revokeKingMembership,
  resetStoreCatalog,
  buyStoreItem,
  equipStoreItem,
} from '../controllers/storeController';
import { requireRoles, verifyToken } from '../middlewares/authorize.middleware';

const router = Router();
const storeManagers = requireRoles('owner', 'superAdmin', 'admin', 'operator');

// Public / Mobile app queries
router.get('/items', getStoreItems);
router.get('/levels', getStoreLevels);
router.get('/inventory', verifyToken, getStoreInventory);
router.get('/items/:id', getStoreItemById);
router.post('/buy', verifyToken, buyStoreItem);
router.post('/purchase', verifyToken, buyStoreItem);
router.post('/equip', verifyToken, equipStoreItem);

// Admin management endpoints
router.post('/items', verifyToken, storeManagers, createStoreItem);
router.put('/items/:id', verifyToken, storeManagers, updateStoreItem);
router.delete('/items/:id', verifyToken, storeManagers, deleteStoreItem);
router.patch('/items/:id/toggle', verifyToken, storeManagers, toggleStoreItem);
router.get('/king-members', verifyToken, storeManagers, getKingMembers);
router.post('/king-members/grant', verifyToken, storeManagers, grantKingMembership);
router.delete('/king-members/:userId', verifyToken, storeManagers, revokeKingMembership);
router.post('/reset-catalog', verifyToken, storeManagers, resetStoreCatalog);

export default router;
