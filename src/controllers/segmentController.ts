import { Request, Response } from 'express';
import { Segment } from '../models/segment.model';
import { SegmentationService } from '../services/segmentation.service';
import { AuditLog } from '../models/auditLog.model';
import sendResponse from '../utils/reponse';
import { AuthRequest } from '../middlewares/authorize.middleware';

/**
 * List all defined segments
 */
export const getSegments = async (req: AuthRequest, res: Response) => {
    try {
        const segments = await Segment.find()
            .populate('createdBy', 'name email employeeCode')
            .sort({ createdAt: -1 });

        return sendResponse(res, 200, true, 'Segments listed', segments);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Get segment by ID
 */
export const getSegmentById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const segment = await Segment.findById(id).populate('createdBy', 'name email');
        if (!segment) {
            return sendResponse(res, 404, false, 'Segment not found');
        }
        return sendResponse(res, 200, true, 'Segment details', segment);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Create segment
 */
export const createSegment = async (req: AuthRequest, res: Response) => {
    try {
        const { name, description = '', rules = {} } = req.body;

        if (!name || !name.trim()) {
            return sendResponse(res, 400, false, 'Segment name is required');
        }

        const count = await SegmentationService.calculateCount(rules);

        const segment = await Segment.create({
            name: name.trim(),
            description: description.trim(),
            rules,
            cachedCount: count,
            lastCalculatedAt: new Date(),
            createdBy: req.user?.id
        });

        if (req.user?.id) {
            await AuditLog.create({
                adminId: req.user.id,
                action: 'CREATE_SEGMENT',
                target: String(segment._id),
                details: `Created audience segment '${segment.name}' with ${count} matching users`,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'],
                newValue: segment.toObject(),
                reason: 'Audience segment creation'
            });
        }

        return sendResponse(res, 201, true, 'Segment created successfully', segment);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Update segment
 */
export const updateSegment = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { name, description, rules } = req.body;

        const segment = await Segment.findById(id);
        if (!segment) {
            return sendResponse(res, 404, false, 'Segment not found');
        }

        if (name) segment.name = name.trim();
        if (description !== undefined) segment.description = description.trim();
        if (rules) {
            segment.rules = rules;
            segment.cachedCount = await SegmentationService.calculateCount(rules);
            segment.lastCalculatedAt = new Date();
        }

        await segment.save();

        return sendResponse(res, 200, true, 'Segment updated successfully', segment);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Delete segment
 */
export const deleteSegment = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const segment = await Segment.findByIdAndDelete(id);
        if (!segment) {
            return sendResponse(res, 404, false, 'Segment not found');
        }

        return sendResponse(res, 200, true, 'Segment deleted successfully');
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Preview segment count on the fly without saving
 */
export const previewSegmentCount = async (req: Request, res: Response) => {
    try {
        const { rules = {} } = req.body;
        const count = await SegmentationService.calculateCount(rules);
        return sendResponse(res, 200, true, 'Preview count calculated', { count });
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Get paginated users for a segment
 */
export const getSegmentUsersList = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { page = 1, limit = 20 } = req.query;

        const segment = await Segment.findById(id);
        if (!segment) {
            return sendResponse(res, 404, false, 'Segment not found');
        }

        const data = await SegmentationService.getUsers(segment.rules, Number(page), Number(limit));
        return sendResponse(res, 200, true, 'Segment users listed', data);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};
