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

// Admin Routes
router.post('/admin/create', verifyToken, createVipPackage);
router.patch('/admin/:id', verifyToken, updateVipPackage);
router.delete('/admin/:id', verifyToken, deleteVipPackage);

router.post('/admin/svip/create', verifyToken, createSvipTier);
router.patch('/admin/svip/:id', verifyToken, updateSvipTier);
router.delete('/admin/svip/:id', verifyToken, deleteSvipTier);

export const vipRouter = router;
export default router;
