import { Router } from 'express';
import { getAppConfig, getPublicAppConfig, updateAppConfig } from '../controllers/systemConfig.controller';
import { verifyToken, requireRoles } from '../middlewares/authorize.middleware';

const router = Router();
const adminManagers = requireRoles('owner', 'superAdmin', 'admin', 'operator');

// Public query for App and Admin
router.get('/', (req, res, next) => {
  if (!req.header('Authorization')) return getPublicAppConfig(req, res);
  return verifyToken(req, res, next);
}, adminManagers, getAppConfig);
router.get('/public', getPublicAppConfig);

// Admin toggle and updates
router.post('/toggle', verifyToken, adminManagers, updateAppConfig);
router.put('/update', verifyToken, adminManagers, updateAppConfig);

export default router;
