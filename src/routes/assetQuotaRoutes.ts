import { Router } from 'express';
import {
  allocateAssetQuota,
  getAssetQuotas,
  getOperatorAvailableStock,
  grantAssetWithQuota,
  deleteAssetQuota,
} from '../controllers/assetQuotaController';
import { verifyToken } from '../middlewares/authorize.middleware';

const router = Router();

router.post('/allocate', verifyToken, allocateAssetQuota);
router.get('/', verifyToken, getAssetQuotas);
router.get('/available', verifyToken, getOperatorAvailableStock);
router.post('/grant', verifyToken, grantAssetWithQuota);
router.delete('/:id', verifyToken, deleteAssetQuota);

export default router;
