import express from 'express';
import { verifyToken } from '../middlewares/authorize.middleware';
import {
    getCampaigns,
    getCampaignById,
    createCampaign,
    dispatchCampaign,
    cancelCampaign
} from '../controllers/campaignController';

const router = express.Router();

router.get('/campaigns', verifyToken, getCampaigns);
router.get('/campaigns/:id', verifyToken, getCampaignById);
router.post('/campaigns', verifyToken, createCampaign);
router.post('/campaigns/dispatch', verifyToken, dispatchCampaign);
router.patch('/campaigns/:id/cancel', verifyToken, cancelCampaign);

export default router;
