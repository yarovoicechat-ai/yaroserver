import { Router } from 'express';
import {
  addPricePlan,
  getAllPricePlans,
  getPricePlanById,
  updatePricePlan,
  togglePricePlanStatus,
  deletePricePlan,
  getPublicPricePlans,
  syncDefaultRechargePlans
} from '../controllers/coinPriceController';
import { verifyToken, requireRoles } from '../middlewares/authorize.middleware';

const router = Router();
const managers = requireRoles('owner', 'superAdmin', 'admin', 'operator');
router.get('/public', getPublicPricePlans);
router.use((req, res, next) => {
  if (req.method === 'GET' && !req.header('Authorization')) return getPublicPricePlans(req, res);
  return verifyToken(req, res, next);
});
router.use((req, res, next) => {
  const role = (req as any).user?.role;
  if (req.method === 'GET') {
    if (['owner', 'superAdmin', 'admin', 'operator', 'coinSeller'].includes(role)) return next();
    return getPublicPricePlans(req, res);
  }
  return managers(req, res, next);
});

router.post('/sync-defaults', verifyToken, syncDefaultRechargePlans);
router.post('/', verifyToken, addPricePlan);
router.get('/', getAllPricePlans);
router.get('/:id', getPricePlanById);
router.put('/:id', verifyToken, updatePricePlan);
router.patch('/:id/toggle', verifyToken, togglePricePlanStatus);
router.delete('/:id', verifyToken, deletePricePlan);

export default router;

