import { Request, Response } from 'express';
import { Campaign } from '../models/campaign.model';
import { CampaignWorkerService } from '../services/campaignWorker.service';
import { AuditLog } from '../models/auditLog.model';
import sendResponse from '../utils/reponse';
import { AuthRequest } from '../middlewares/authorize.middleware';

/**
 * List all campaigns
 */
export const getCampaigns = async (req: AuthRequest, res: Response) => {
    try {
        const { channel, status, search } = req.query;
        const filter: any = {};

        if (channel && channel !== 'ALL') filter.channel = channel;
        if (status && status !== 'ALL') filter.status = status;
        if (search) {
            filter.$or = [
                { title: { $regex: String(search), $options: 'i' } },
                { message: { $regex: String(search), $options: 'i' } }
            ];
        }

        const campaigns = await Campaign.find(filter)
            .populate('createdBy', 'name email employeeCode')
            .sort({ createdAt: -1 });

        return sendResponse(res, 200, true, 'Campaigns retrieved successfully', campaigns);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Get campaign by ID
 */
export const getCampaignById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const campaign = await Campaign.findById(id).populate('createdBy', 'name email');
        if (!campaign) {
            return sendResponse(res, 404, false, 'Campaign not found');
        }
        return sendResponse(res, 200, true, 'Campaign details', campaign);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Create or draft campaign
 */
export const createCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const { title, message, channel = 'PUSH_FCM', targeting = {}, schedule = {} } = req.body;

        if (!title || !message) {
            return sendResponse(res, 400, false, 'Title and Message are mandatory');
        }

        const isScheduled = schedule.type === 'SCHEDULED' && schedule.scheduledAt;
        const status = isScheduled ? 'SCHEDULED' : 'DRAFT';

        const campaign = await Campaign.create({
            title: title.trim(),
            message: message.trim(),
            channel,
            targeting,
            schedule,
            status,
            createdBy: req.user?.id
        });

        if (req.user?.id) {
            await AuditLog.create({
                adminId: req.user.id,
                action: 'CREATE_CAMPAIGN',
                target: String(campaign._id),
                details: `Created notification campaign: '${campaign.title}' via ${campaign.channel}`,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'],
                newValue: campaign.toObject(),
                reason: 'Campaign creation'
            });
        }

        return sendResponse(res, 201, true, 'Campaign created successfully', campaign);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Dispatch campaign immediately (async queue)
 */
export const dispatchCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const { id, title, message, channel = 'PUSH_FCM', targeting = {}, reason } = req.body;

        let campaign;
        if (id) {
            campaign = await Campaign.findById(id);
            if (!campaign) {
                return sendResponse(res, 404, false, 'Campaign not found');
            }
        } else {
            if (!title || !message) {
                return sendResponse(res, 400, false, 'Title and message are required');
            }
            campaign = await Campaign.create({
                title: title.trim(),
                message: message.trim(),
                channel,
                targeting,
                schedule: { type: 'IMMEDIATE' },
                status: 'DRAFT',
                createdBy: req.user?.id
            });
        }

        // Trigger asynchronous background worker
        setImmediate(() => {
            CampaignWorkerService.processCampaign(String(campaign._id)).catch(err => {
                console.error(`Failed to process campaign ${campaign._id}:`, err);
            });
        });

        if (req.user?.id) {
            await AuditLog.create({
                adminId: req.user.id,
                action: 'DISPATCH_CAMPAIGN',
                target: String(campaign._id),
                details: `Dispatched campaign broadcast '${campaign.title}' to audience`,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'],
                reason: reason || 'Operational broadcast dispatch'
            });
        }

        return sendResponse(res, 200, true, 'Campaign broadcast queued for asynchronous transmission', {
            campaignId: campaign._id,
            status: 'RUNNING'
        });
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Cancel running/scheduled campaign
 */
export const cancelCampaign = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const campaign = await Campaign.findById(id);
        if (!campaign) {
            return sendResponse(res, 404, false, 'Campaign not found');
        }

        campaign.status = 'CANCELLED';
        await campaign.save();

        if (req.user?.id) {
            await AuditLog.create({
                adminId: req.user.id,
                action: 'CANCEL_CAMPAIGN',
                target: String(campaign._id),
                details: `Cancelled campaign '${campaign.title}'`,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'],
                reason: req.body?.reason || 'Broadcast cancelled by operator'
            });
        }

        return sendResponse(res, 200, true, 'Campaign cancelled successfully', campaign);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};
