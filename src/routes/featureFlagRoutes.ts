import express from 'express';
import { verifyToken, checkPermission } from '../middlewares/authorize.middleware';
import {
    getAllFeatureFlags,
    getFeatureFlagByKey,
    createFeatureFlag,
    updateFeatureFlag,
    deleteFeatureFlag,
    triggerKillSwitch,
    evaluateClientFlags
} from '../controllers/featureFlagController';

const router = express.Router();

// Admin Management Endpoints
router.get('/feature-flags', verifyToken, getAllFeatureFlags);
router.get('/feature-flags/:keyOrId', verifyToken, getFeatureFlagByKey);
router.post('/feature-flags', verifyToken, createFeatureFlag);
router.put('/feature-flags/:keyOrId', verifyToken, updateFeatureFlag);
router.patch('/feature-flags/:keyOrId', verifyToken, updateFeatureFlag);
router.delete('/feature-flags/:keyOrId', verifyToken, deleteFeatureFlag);
router.post('/feature-flags/:keyOrId/kill-switch', verifyToken, triggerKillSwitch);

// Client evaluation endpoints (Both GET and POST)
router.post('/config/flags/evaluate', evaluateClientFlags);
router.get('/config/flags', evaluateClientFlags);

export default router;
