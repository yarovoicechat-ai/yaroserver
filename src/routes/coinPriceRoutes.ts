import { Router } from 'express';
import {
  addPricePlan,
  getAllPricePlans,
  getPricePlanById,
  updatePricePlan,
  togglePricePlanStatus,
  deletePricePlan,
  syncDefaultRechargePlans
} from '../controllers/coinPriceController';
import { verifyToken } from '../middlewares/authorize.middleware';

const router = Router();

router.post('/sync-defaults', verifyToken, syncDefaultRechargePlans);
router.post('/', verifyToken, addPricePlan);
router.get('/', getAllPricePlans);
router.get('/:id', getPricePlanById);
router.put('/:id', verifyToken, updatePricePlan);
router.patch('/:id/toggle', verifyToken, togglePricePlanStatus);
router.delete('/:id', verifyToken, deletePricePlan);

export default router;

