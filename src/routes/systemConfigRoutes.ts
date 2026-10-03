import { Router } from 'express';
import { getAppConfig, updateAppConfig } from '../controllers/systemConfig.controller';
import { verifyToken, requireRoles } from '../middlewares/authorize.middleware';

const router = Router();
const adminManagers = requireRoles('owner', 'superAdmin', 'admin', 'operator');

// Public query for App and Admin
router.get('/', getAppConfig);
router.get('/public', getAppConfig);

// Admin toggle and updates
router.post('/toggle', verifyToken, adminManagers, updateAppConfig);
router.put('/update', verifyToken, adminManagers, updateAppConfig);

export default router;
