import express from 'express';
import {
  getVipCatalog,
  getSvipCatalog,
  buyVip,
  buySvip,
  equipVip,
  unequipVip,
  equipSvip,
  unequipSvip,
  getMyVipExperience,
  createVipPackage,
  updateVipPackage,
  deleteVipPackage,
  createSvipTier,
  updateSvipTier,
  deleteSvipTier,
  getAllAdminVip,
  getAllAdminSvip,
  toggleVipStatus,
  toggleSvipStatus,
  grantVipToUser,
} from '../controllers/vip.controller';
import { verifyToken } from '../middlewares/authorize.middleware';

const router = express.Router();

// Public / Mobile Client Catalog
router.get('/catalog', getVipCatalog);
router.get('/svip/catalog', getSvipCatalog);

// User Actions
router.post('/buy', verifyToken, buyVip);
router.post('/svip/buy', verifyToken, buySvip);
router.post('/equip', verifyToken, equipVip);
router.post('/unequip', verifyToken, unequipVip);
router.post('/svip/equip', verifyToken, equipSvip);
router.post('/svip/unequip', verifyToken, unequipSvip);
router.get('/experience', verifyToken, getMyVipExperience);

// Admin Routes - VIP
router.get('/admin/all', verifyToken, getAllAdminVip);
router.post('/admin/create', verifyToken, createVipPackage);
router.put('/admin/:id', verifyToken, updateVipPackage);
router.patch('/admin/:id', verifyToken, updateVipPackage);
router.patch('/admin/:id/toggle', verifyToken, toggleVipStatus);
router.delete('/admin/:id', verifyToken, deleteVipPackage);

// Admin Routes - SVIP
router.get('/admin/svip/all', verifyToken, getAllAdminSvip);
router.post('/admin/svip/create', verifyToken, createSvipTier);
router.put('/admin/svip/:id', verifyToken, updateSvipTier);
router.patch('/admin/svip/:id', verifyToken, updateSvipTier);
router.patch('/admin/svip/:id/toggle', verifyToken, toggleSvipStatus);
router.delete('/admin/svip/:id', verifyToken, deleteSvipTier);

// Admin Direct VIP / SVIP Grant Tool
router.post('/admin/grant', verifyToken, grantVipToUser);

export const vipRouter = router;
export default router;

