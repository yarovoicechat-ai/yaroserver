import express from 'express';
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  testProject,
  activateProject,
  disableProject,
  enableProject,
  rollbackProject,
  getUsageOverview,
  getUsageHistory,
  syncUsage,
  getProviderSyncStatus,
  syncProviderUsage,
  getSwitchHistory,
  updateSwitchPolicy,
  getClientAgoraConfig,
} from '../controllers/agoraManagementController';
import { verifyToken, requireRoles } from '../middlewares/authorize.middleware';

const router = express.Router();

// Public / Authenticated Mobile Client Config Route
router.get('/client-config', getClientAgoraConfig);

// All management endpoints require Admin / SuperAdmin / Owner roles
router.use(verifyToken as any, requireRoles('owner', 'superAdmin', 'admin', 'operator') as any);

// Projects CRUD & Actions
router.get('/projects', listProjects as any);
router.post('/projects', createProject as any);
router.put('/projects/:id', updateProject as any);
router.delete('/projects/:id', deleteProject as any);
router.post('/projects/:id/test', testProject as any);
router.post('/projects/:id/activate', activateProject as any);
router.post('/projects/:id/disable', disableProject as any);
router.post('/projects/:id/enable', enableProject as any);

// Rollback
router.post('/rollback', rollbackProject as any);

// Usage tracking & sync
router.get('/usage', getUsageOverview as any);
router.get('/usage/history', getUsageHistory as any);
router.post('/usage/sync', syncUsage as any);
router.get('/usage/provider-status', getProviderSyncStatus as any);
router.post('/usage/provider-sync', syncProviderUsage as any);

// Switching history & policy
router.get('/switch-history', getSwitchHistory as any);
router.put('/switch-policy', updateSwitchPolicy as any);

export default router;
