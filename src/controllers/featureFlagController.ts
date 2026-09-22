import { Request, Response } from 'express';
import crypto from 'crypto';
import { FeatureFlag } from '../models/featureFlag.model';
import { AuditLog } from '../models/auditLog.model';
import sendResponse from '../utils/reponse';
import { AuthRequest } from '../middlewares/authorize.middleware';

/**
 * Deterministic hash bucket (0 - 99) for stable canary rollouts
 */
const getDeterministicBucket = (seed: string): number => {
    const hash = crypto.createHash('md5').update(seed).digest();
    return hash.readUInt32BE(0) % 100;
};

/**
 * List all feature flags for management panel
 */
export const getAllFeatureFlags = async (req: AuthRequest, res: Response) => {
    try {
        const { search, platform } = req.query;
        const filter: any = {};

        if (search) {
            filter.$or = [
                { key: { $regex: String(search), $options: 'i' } },
                { name: { $regex: String(search), $options: 'i' } },
                { description: { $regex: String(search), $options: 'i' } }
            ];
        }

        if (platform && platform !== 'ALL') {
            filter.platform = platform;
        }

        const flags = await FeatureFlag.find(filter)
            .populate('updatedBy', 'name email employeeCode')
            .sort({ updatedAt: -1 });

        // Normalize format for frontend
        const normalized = flags.map(f => ({
            id: f._id,
            flagKey: f.key,
            key: f.key,
            name: f.name || f.title,
            title: f.title || f.name,
            description: f.description,
            enabled: f.isEnabled,
            isEnabled: f.isEnabled,
            platform: f.platform,
            country: f.country,
            language: f.language,
            userSegment: f.userSegment,
            vipSegment: f.vipSegment,
            rolloutPercentage: f.rolloutPercentage,
            startDate: f.startDate,
            endDate: f.endDate,
            isKillSwitchActive: f.isKillSwitchActive,
            killSwitchReason: f.killSwitchReason,
            updatedBy: (f.updatedBy as any)?.name || 'System Administrator',
            updatedAt: f.updatedAt
        }));

        return sendResponse(res, 200, true, 'Feature flags fetched successfully', normalized);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message || 'Failed to retrieve feature flags');
    }
};

/**
 * Retrieve single flag
 */
export const getFeatureFlagByKey = async (req: Request, res: Response) => {
    try {
        const { keyOrId } = req.params;
        const flag = await FeatureFlag.findOne({
            $or: [
                { key: keyOrId },
                ...(keyOrId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: keyOrId }] : [])
            ]
        }).populate('updatedBy', 'name email');

        if (!flag) {
            return sendResponse(res, 404, false, 'Feature flag not found');
        }

        return sendResponse(res, 200, true, 'Feature flag retrieved', flag);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Create new feature flag with audit event
 */
export const createFeatureFlag = async (req: AuthRequest, res: Response) => {
    try {
        const {
            flagKey,
            key,
            name,
            title,
            description = '',
            enabled = true,
            isEnabled = true,
            platform = 'ALL',
            country = ['*'],
            language = ['*'],
            userSegment = 'ALL',
            vipSegment,
            rolloutPercentage = 100,
            startDate,
            endDate,
            allowedRoles = []
        } = req.body;

        const effectiveKey = (flagKey || key || '').trim();
        const effectiveName = (name || title || '').trim();

        if (!effectiveKey || !effectiveName) {
            return sendResponse(res, 400, false, 'Flag Key and Name are mandatory');
        }

        const existing = await FeatureFlag.findOne({ key: effectiveKey });
        if (existing) {
            return sendResponse(res, 409, false, `Feature flag key '${effectiveKey}' already exists`);
        }

        const newFlag = await FeatureFlag.create({
            key: effectiveKey,
            name: effectiveName,
            title: effectiveName,
            description,
            isEnabled: enabled !== undefined ? enabled : isEnabled,
            platform,
            country: Array.isArray(country) ? country : [country],
            language: Array.isArray(language) ? language : [language],
            userSegment,
            vipSegment,
            rolloutPercentage: Math.max(0, Math.min(100, Number(rolloutPercentage) || 0)),
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            isKillSwitchActive: false,
            allowedRoles,
            updatedBy: req.user?.id
        });

        // Audit Trail
        if (req.user?.id) {
            await AuditLog.create({
                adminId: req.user.id,
                action: 'CREATE_FEATURE_FLAG',
                target: effectiveKey,
                details: `Created feature flag '${effectiveName}' with rollout ${rolloutPercentage}%`,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'],
                newValue: newFlag.toObject(),
                reason: 'Standard feature flag configuration'
            });
        }

        return sendResponse(res, 201, true, 'Feature flag created successfully', newFlag);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Update existing feature flag with audit event
 */
export const updateFeatureFlag = async (req: AuthRequest, res: Response) => {
    try {
        const { keyOrId } = req.params;
        const updates = req.body;

        const flag = await FeatureFlag.findOne({
            $or: [
                { key: keyOrId },
                ...(keyOrId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: keyOrId }] : [])
            ]
        });

        if (!flag) {
            return sendResponse(res, 404, false, 'Feature flag not found');
        }

        const previousState = flag.toObject();

        if (updates.name) flag.name = updates.name;
        if (updates.title) flag.title = updates.title;
        if (updates.description !== undefined) flag.description = updates.description;
        if (updates.enabled !== undefined) flag.isEnabled = updates.enabled;
        if (updates.isEnabled !== undefined) flag.isEnabled = updates.isEnabled;
        if (updates.platform) flag.platform = updates.platform;
        if (updates.country) flag.country = Array.isArray(updates.country) ? updates.country : [updates.country];
        if (updates.language) flag.language = Array.isArray(updates.language) ? updates.language : [updates.language];
        if (updates.userSegment) flag.userSegment = updates.userSegment;
        if (updates.vipSegment !== undefined) flag.vipSegment = updates.vipSegment;
        if (updates.rolloutPercentage !== undefined) {
            flag.rolloutPercentage = Math.max(0, Math.min(100, Number(updates.rolloutPercentage)));
        }
        if (updates.startDate !== undefined) flag.startDate = updates.startDate ? new Date(updates.startDate) : undefined;
        if (updates.endDate !== undefined) flag.endDate = updates.endDate ? new Date(updates.endDate) : undefined;
        if (updates.isKillSwitchActive !== undefined) flag.isKillSwitchActive = updates.isKillSwitchActive;
        if (updates.killSwitchReason !== undefined) flag.killSwitchReason = updates.killSwitchReason;
        if (updates.allowedRoles) flag.allowedRoles = updates.allowedRoles;

        flag.updatedBy = req.user?.id;
        await flag.save();

        // Audit Trail
        if (req.user?.id) {
            await AuditLog.create({
                adminId: req.user.id,
                action: 'UPDATE_FEATURE_FLAG',
                target: flag.key,
                details: `Updated parameters for feature flag '${flag.key}'`,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'],
                oldValue: previousState,
                newValue: flag.toObject(),
                reason: updates.reason || 'Feature flag configuration modification'
            });
        }

        return sendResponse(res, 200, true, 'Feature flag updated successfully', flag);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Delete feature flag
 */
export const deleteFeatureFlag = async (req: AuthRequest, res: Response) => {
    try {
        const { keyOrId } = req.params;
        const flag = await FeatureFlag.findOneAndDelete({
            $or: [
                { key: keyOrId },
                ...(keyOrId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: keyOrId }] : [])
            ]
        });

        if (!flag) {
            return sendResponse(res, 404, false, 'Feature flag not found');
        }

        // Audit Trail
        if (req.user?.id) {
            await AuditLog.create({
                adminId: req.user.id,
                action: 'DELETE_FEATURE_FLAG',
                target: flag.key,
                details: `Deleted feature flag '${flag.key}'`,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'],
                oldValue: flag.toObject(),
                reason: req.body?.reason || 'Decommissioned feature flag'
            });
        }

        return sendResponse(res, 200, true, 'Feature flag deleted successfully');
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Emergency Kill Switch
 */
export const triggerKillSwitch = async (req: AuthRequest, res: Response) => {
    try {
        const { keyOrId } = req.params;
        const { reason } = req.body;

        if (!reason || reason.trim().length < 5) {
            return sendResponse(res, 400, false, 'A descriptive reason (min 5 chars) is mandatory to trigger an emergency kill switch');
        }

        const flag = await FeatureFlag.findOne({
            $or: [
                { key: keyOrId },
                ...(keyOrId.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: keyOrId }] : [])
            ]
        });

        if (!flag) {
            return sendResponse(res, 404, false, 'Feature flag not found');
        }

        const previousState = flag.toObject();
        flag.isKillSwitchActive = true;
        flag.isEnabled = false;
        flag.killSwitchReason = reason.trim();
        flag.updatedBy = req.user?.id;
        await flag.save();

        // High Priority Audit Log
        if (req.user?.id) {
            await AuditLog.create({
                adminId: req.user.id,
                action: 'KILL_SWITCH_TRIGGERED',
                target: flag.key,
                details: `EMERGENCY KILL SWITCH EXECUTED for '${flag.key}': ${reason.trim()}`,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'],
                oldValue: previousState,
                newValue: flag.toObject(),
                reason: reason.trim()
            });
        }

        return sendResponse(res, 200, true, `Emergency kill switch active for ${flag.key}`, flag);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Deterministic Client Evaluation Endpoint for Mobile App
 * POST /api/v1/config/flags/evaluate
 */
export const evaluateClientFlags = async (req: Request, res: Response) => {
    try {
        const {
            userId = 'guest',
            platform = 'ANDROID',
            country = 'IN',
            role = 'user',
            isVIP = false
        } = req.body || {};

        const flags = await FeatureFlag.find({ isKillSwitchActive: false, isEnabled: true });
        const evaluatedFlags: Record<string, boolean> = {};

        const now = new Date();
        const clientPlatform = String(platform).toUpperCase();
        const clientCountry = String(country).toUpperCase();

        for (const flag of flags) {
            // Check Schedule
            if (flag.startDate && flag.startDate > now) {
                evaluatedFlags[flag.key] = false;
                continue;
            }
            if (flag.endDate && flag.endDate < now) {
                evaluatedFlags[flag.key] = false;
                continue;
            }

            // Check Platform
            if (flag.platform !== 'ALL' && flag.platform !== clientPlatform) {
                evaluatedFlags[flag.key] = false;
                continue;
            }

            // Check Country
            if (flag.country && flag.country.length > 0 && !flag.country.includes('*')) {
                if (!flag.country.map(c => c.toUpperCase()).includes(clientCountry)) {
                    evaluatedFlags[flag.key] = false;
                    continue;
                }
            }

            // Check VIP Segment
            if (flag.userSegment === 'VIP_ONLY' && !isVIP) {
                evaluatedFlags[flag.key] = false;
                continue;
            }

            // Check Deterministic Rollout
            if (flag.rolloutPercentage < 100) {
                const bucket = getDeterministicBucket(`${userId}:${flag.key}`);
                if (bucket >= flag.rolloutPercentage) {
                    evaluatedFlags[flag.key] = false;
                    continue;
                }
            }

            evaluatedFlags[flag.key] = true;
        }

        return sendResponse(res, 200, true, 'Feature flags evaluated', evaluatedFlags);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};
