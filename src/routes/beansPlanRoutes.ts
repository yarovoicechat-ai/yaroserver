import { Router } from 'express';
import {
  getAllBeansPlans,
  getBeansPlanById,
  addBeansPlan,
  updateBeansPlan,
  toggleBeansPlanStatus,
  deleteBeansPlan,
} from '../controllers/beansPlan.controller';
import { verifyToken } from '../middlewares/authorize.middleware';

const router = Router();

router.get('/', getAllBeansPlans);
router.get('/:id', getBeansPlanById);
router.post('/', verifyToken, addBeansPlan);
router.put('/:id', verifyToken, updateBeansPlan);
router.patch('/:id/toggle', verifyToken, toggleBeansPlanStatus);
router.delete('/:id', verifyToken, deleteBeansPlan);

export default router;
