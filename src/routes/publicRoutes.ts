import express, { Request, Response } from 'express';
import { getCachedSettings } from '../controllers/settingsController';
import sendResponse from '../utils/reponse';
import { Logger } from '../utils/logger';
import { Banner } from '../models/banner.model';
import { createUserFromPublicForm } from '../controllers/formsController';
import { User } from '../models/user.model';
import { generateSecureHash, } from '../utils/passwordHelper';
import { generateUniqueId } from '../utils/generator';
import { submitApplication } from '../controllers/recruitmentController';

const router = express.Router();

router.get('/settings', async (req: Request, res: Response) => {
    try {
        const settings = await getCachedSettings();
        const publicSettings = {
            privacyPolicy: settings.privacyPolicy,
            termsAndConditions: settings.termsAndConditions,
            coinPrice: settings.coinPrice,
            withdrawalPlatformFeePercent: settings.withdrawalPlatformFeePercent,
            callRatePerMinute: settings.callRatePerMinute,
        };
        return sendResponse(res, 200, true, 'Settings fetched successfully', publicSettings);
    } catch (error) {
        await Logger('getPublicSettings', error);
        return sendResponse(res, 500, false, 'Error fetching settings');
    }
});

router.post('/forms/:type', async (req: Request, res: Response) => {
    try {
        const { type } = req.params;
        const payload = req.body || {};
        if (!type) {
            return sendResponse(res, 400, false, 'Form type is required');
        }

        const user = await createUserFromPublicForm(payload, type);
        return sendResponse(res, 201, true, 'Form submitted successfully', {
            userId: user.userId,
            employeeCode: user.employeeCode,
            role: user.role,
            meethiId: user.meethiId,
        });
    } catch (error: any) {
        await Logger('submitPublicForm', error);
        return sendResponse(res, 400, false, error.message || 'Failed to submit form');
    }
});

router.get('/banners', async (_req: Request, res: Response) => {
    try {
        const now = new Date();
        const startOfToday = new Date(now);
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date(now);
        endOfToday.setHours(23, 59, 59, 999);

        const rawBanners = await Banner.find({
            $and: [
                { $or: [{ isActive: true }, { isActive: { $exists: false } }] },
                { $or: [{ startDate: { $exists: false } }, { startDate: null }, { startDate: { $lte: endOfToday } }] },
                { $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: startOfToday } }] }
            ]
        }).select('_id title imageUrl linkUrl targetType targetScreen priority startDate endDate isActive').sort({ priority: -1, createdAt: -1 }).lean();

        const banners = rawBanners.map(b => ({
            ...b,
            image: b.imageUrl || (b as any).image || ''
        }));

        return sendResponse(res, 200, true, 'Active banners fetched successfully', banners);
    } catch (error) {
        await Logger('getPublicBanners', error);
        return sendResponse(res, 500, false, 'Error fetching banners');
    }
});

// ============ Public Application Form ============
// Anyone can submit an application using a referral/employee code link.
const PUBLIC_ALLOWED_ROLES = ['host', 'agency', 'admin', 'superAdmin', 'operator', 'coinSeller'];
const ROLE_CODE_PREFIX: Record<string, string> = {
    host: 'HST',
    agency: 'AGN',
    admin: 'ADM',
    superAdmin: 'SA',
    operator: 'OPR',
    coinSeller: 'CS',
};

router.post('/apply', async (req: Request, res: Response) => {
    const roleAliases: Record<string, string> = {
        superAdmin: 'super-admin',
        coinSeller: 'seller',
        customerSupport: 'customer-service',
    };
    req.body = {
        ...req.body,
        phone: req.body?.phone || req.body?.phoneNumber,
        role: roleAliases[req.body?.role] || req.body?.role,
    };
    return submitApplication(req, res);
});

// ============ Team Leader Application Endpoint ============
router.post('/teamleader/apply', async (req: Request, res: Response) => {
    const body = req.body || {};
    req.body = {
        ...body,
        name: body.fullName || body.name,
        email: body.emailAddress || body.email,
        phone: body.mobileNumber || body.phoneNumber || body.phone,
        role: 'operator',
        documents: [
            body.resumeUrl,
            body.portfolioPdfUrl,
            body.experienceLetterUrl,
            body.addressProofUrl,
            body.governmentIdUrl,
            body.profilePhotoUrl,
        ].filter(Boolean),
    };
    return submitApplication(req, res);
});

// ============ Unified Public Search Endpoint ============
router.get('/search', async (req: Request, res: Response) => {
    try {
        const queryStr = String(req.query.q || req.query.search || '').trim();
        const limitNum = Math.min(50, Math.max(1, parseInt(String(req.query.limit || 30), 10)));

        if (!queryStr) {
            return sendResponse(res, 200, true, 'Search query empty', {
                users: [],
                hosts: [],
                rooms: [],
            });
        }

        const escaped = queryStr.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        const regex = new RegExp(escaped, 'i');

        const orConditions: any[] = [
            { name: regex },
            { userName: regex },
            { meethiId: regex },
            { phoneNumber: regex },
            {
                $expr: {
                    $regexMatch: {
                        input: { $toString: "$userId" },
                        regex: escaped,
                        options: "i",
                    },
                },
            },
        ];
        if (!isNaN(Number(queryStr))) {
            orConditions.push({ userId: Number(queryStr) });
        }

        const userFilter: any = {
            isDeleted: false,
            isBlocked: { $ne: true },
            $or: orConditions,
        };

        const matchingUsers = await User.find(userFilter)
            .select('userId meethiId name userName image avatar gender level isOnline role isVerified isActive bio languages audioPrice videoPrice')
            .sort({ isOnline: -1, role: 1, createdAt: -1 })
            .limit(limitNum)
            .lean();

        const usersList: any[] = [];
        const hostsList: any[] = [];

        matchingUsers.forEach((u: any) => {
            const formatted = {
                ...u,
                isHost: u.role === 'host',
            };
            if (u.role === 'host') {
                hostsList.push(formatted);
            }
            usersList.push(formatted);
        });

        // Search active voice rooms
        const matchingOwnerIds = matchingUsers.map(u => u._id);
        const roomFilter: any = {
            isActive: { $ne: false },
            $or: [
                { title: regex },
                { channelName: regex },
                { category: regex },
                { about: regex },
                ...(matchingOwnerIds.length ? [{ ownerId: { $in: matchingOwnerIds } }] : []),
            ],
        };

        const { Room } = await import('../models/room.model');
        const rawRooms = await Room.find(roomFilter)
            .populate('ownerId', 'userId name image avatar gender meethiId')
            .sort({ updatedAt: -1 })
            .limit(limitNum)
            .lean();

        const roomsList = rawRooms.map((r: any) => {
            const owner = r.ownerId || {};
            const hostId = String(owner.userId || owner.meethiId || owner._id || r.channelName);
            return {
                id: r.channelName,
                roomId: r.channelName,
                title: r.title,
                about: r.about || '',
                hostName: owner.name || 'Host',
                hostId,
                ownerId: owner._id,
                coverImage: r.coverImage || owner.image || owner.avatar || '',
                onlineCount: r.members?.length ? String(r.members.length) : '1',
                category: r.category || 'Chat 💬',
                mode: r.mode || 'Public',
                seatCount: r.seatCount || 8,
                isActive: r.isActive,
            };
        });

        return sendResponse(res, 200, true, 'Search results fetched successfully', {
            users: usersList,
            hosts: hostsList,
            rooms: roomsList,
        });
    } catch (error: any) {
        await Logger('publicSearch', error);
        return sendResponse(res, 500, false, error.message || 'Error executing search');
    }
});

// ============ Verify Employee Referral Code ============
router.get('/verify-code/:code', async (req: Request, res: Response) => {
    try {
        const { code } = req.params;
        const senior = await User.findOne({ employeeCode: code, isDeleted: false })
            .select('name role employeeCode');
        if (!senior) {
            return sendResponse(res, 404, false, 'Invalid referral code.');
        }
        return sendResponse(res, 200, true, 'Valid referral code', {
            seniorName: senior.name,
            seniorRole: senior.role,
            employeeCode: senior.employeeCode,
        });
    } catch (error) {
        await Logger('verifyReferralCode', error);
        return sendResponse(res, 500, false, 'Error verifying code');
    }
});

// ============ Public Account Deletion Request (Google Play Compliance) ============
router.post('/delete-account-request', async (req: Request, res: Response) => {
    try {
        const { identifier, idType, userRole, reason, detailedNotes } = req.body || {};
        if (!identifier) {
            return sendResponse(res, 400, false, 'Account identifier is required');
        }

        const cleanId = String(identifier).trim();
        let query: any = {};

        if (idType === 'phone' || cleanId.startsWith('+') || (/^\d{10,13}$/.test(cleanId) && cleanId.length >= 10)) {
            const phoneDigits = cleanId.replace(/\D/g, '');
            query = {
                $or: [
                    { phoneNumber: cleanId },
                    { phoneNumber: { $regex: phoneDigits.slice(-10) } }
                ]
            };
        } else {
            query = {
                $or: [
                    { userId: cleanId },
                    { meethiId: cleanId }
                ]
            };
        }

        const user = await User.findOne(query);
        const DeletionRequest = (await import('../models/deletionRequest.model')).default;
        const fullReason = [reason, detailedNotes].filter(Boolean).join(' - ');
        const generatedTicket = `YARO-DEL-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

        if (user) {
            await DeletionRequest.create({
                userId: user._id,
                yaroId: String(user.userId || cleanId),
                meethiId: String(user.meethiId || user.userId || cleanId),
                name: user.name || 'Yaro User',
                role: user.role || userRole || 'user',
                phoneNumber: user.phoneNumber || cleanId,
                reason: fullReason || 'Website self-service deletion request',
                status: 'pending'
            });
        }

        return sendResponse(res, 200, true, 'Account deletion request queued successfully', {
            ticketId: generatedTicket,
            timestamp: new Date().toISOString(),
            accountFound: !!user
        });
    } catch (error: any) {
        await Logger('publicDeleteAccountRequest', error);
        return sendResponse(res, 500, false, error.message || 'Error processing deletion request');
    }
});

export default router;
