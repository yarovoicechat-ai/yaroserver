import { Router } from 'express';
import {
  getStoreItems,
  getUniqueIdItemsAdmin,
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
  grantAssetToUser,
  getAssetCatalogAdmin,
  getUserLookupAdmin,
  getAssetGrantHistoryAdmin,
  revokeGrantedAssetAdmin,
} from '../controllers/storeController';
import { AuthRequest, requireRoles, verifyToken } from '../middlewares/authorize.middleware';

const router = Router();
const storeManagers = requireRoles('owner', 'superAdmin', 'admin', 'operator');

// The public store never receives employee-only items. A management panel may
// explicitly request them, but only with a valid store-manager token.
const authorizeStaffCatalog = (req: AuthRequest, res: any, next: any) => {
  if (String(req.query.includeStaff || '') !== 'true') return next();
  return verifyToken(req, res, () => storeManagers(req, res, next));
};

// Public / Mobile app queries
router.get('/items', authorizeStaffCatalog, getStoreItems);
router.get('/levels', getStoreLevels);
router.get('/inventory', verifyToken, getStoreInventory);
router.get('/admin/unique-ids', verifyToken, storeManagers, getUniqueIdItemsAdmin);
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

// Direct Asset Distribution & Reward Grants
router.post('/grant-asset', verifyToken, storeManagers, grantAssetToUser);
router.get('/asset-catalog', verifyToken, storeManagers, getAssetCatalogAdmin);
router.get('/user-lookup', verifyToken, storeManagers, getUserLookupAdmin);
router.get('/grant-history', verifyToken, storeManagers, getAssetGrantHistoryAdmin);
router.delete('/revoke-grant/:userId/:inventoryItemId', verifyToken, storeManagers, revokeGrantedAssetAdmin);

export default router;
