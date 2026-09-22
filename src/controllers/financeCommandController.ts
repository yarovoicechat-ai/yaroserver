
































import { Request, Response } from 'express';
import { RechargeHistory } from '../models/RechargeHistory';
import { Withdrawal, WithdrawalStatus } from '../models/withdrawal.model';
import { User } from '../models/user.model';
import { Reconciliation } from '../models/reconciliation.model';
import { ReconciliationService } from '../services/reconciliation.service';
import { AuditLog } from '../models/auditLog.model';
import { RechargeType } from '../constants/user';
import sendResponse from '../utils/reponse';
import { AuthRequest } from '../middlewares/authorize.middleware';

/**
 * Platform financial overview metrics
 */
export const getFinanceOverview = async (req: AuthRequest, res: Response) => {
    try {
        const [rechargeAgg, withdrawalAgg, userBalanceAgg] = await Promise.all([
            RechargeHistory.aggregate([
                { $match: { status: 'COMPLETED' } },
                { $group: { _id: null, totalGross: { $sum: '$amount' }, totalCoins: { $sum: '$coins' } } }
            ]),
            Withdrawal.aggregate([
                { $match: { status: WithdrawalStatus.APPROVED } },
                { $group: { _id: null, totalDisbursed: { $sum: '$amount' } } }
            ]),
            User.aggregate([
                { $match: { isDeleted: false } },
                { $group: { _id: null, totalCirculatingCoins: { $sum: '$coins' }, totalCirculatingDiamonds: { $sum: '$diamonds' } } }
            ])
        ]);

        const grossRevenue = rechargeAgg[0]?.totalGross || 0;
        const totalDisbursed = withdrawalAgg[0]?.totalDisbursed || 0;
        const netMargin = Math.max(0, grossRevenue - totalDisbursed);
        const circulatingCoins = userBalanceAgg[0]?.totalCirculatingCoins || 0;
        const circulatingDiamonds = userBalanceAgg[0]?.totalCirculatingDiamonds || 0;

        const latestRec = await Reconciliation.findOne().sort({ createdAt: -1 });

        return sendResponse(res, 200, true, 'Finance overview retrieved', {
            grossRevenue,
            totalDisbursed,
            netMargin,
            circulatingCoins,
            circulatingDiamonds,
            reconciliationStatus: latestRec?.status || 'MATCHED',
            lastReconciledAt: latestRec?.reconciliationDate || new Date()
        });
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Get latest reconciliation status
 */
export const getReconciliationStatus = async (req: AuthRequest, res: Response) => {
    try {
        let latest: any = await Reconciliation.findOne().sort({ createdAt: -1 });
        if (!latest) {
            // Run baseline 30-day initial check
            const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
            latest = await ReconciliationService.executeReconciliation(thirtyDaysAgo, new Date(), req.user?.id);
        }
        return sendResponse(res, 200, true, 'Reconciliation status', latest);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Trigger manual on-demand reconciliation run
 */
export const runReconciliation = async (req: AuthRequest, res: Response) => {
    try {
        const { periodStart, periodEnd } = req.body;
        const start = periodStart ? new Date(periodStart) : new Date(Date.now() - 30 * 86400000);
        const end = periodEnd ? new Date(periodEnd) : new Date();

        const record = await ReconciliationService.executeReconciliation(start, end, req.user?.id);

        if (req.user?.id) {
            await AuditLog.create({
                adminId: req.user.id,
                action: 'RUN_FINANCIAL_RECONCILIATION',
                target: record.batchId,
                details: `Triggered financial reconciliation for period ${start.toISOString()} to ${end.toISOString()}. Result: ${record.status}`,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'],
                reason: 'On-demand financial audit'
            });
        }

        return sendResponse(res, 200, true, 'Reconciliation completed successfully', record);
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};

/**
 * Audited balance adjustment endpoint with strict RBAC and atomic concurrency protection
 * POST /api/admin/wallet/adjust
 */
export const adjustWalletBalance = async (req: AuthRequest, res: Response) => {
    try {
        // 1. Strict RBAC Enforcement
        const allowedRoles = ['owner', 'superadmin', 'admin'];
        const userRole = (req.user?.role || '').toLowerCase();
        if (!allowedRoles.includes(userRole)) {
            return sendResponse(res, 403, false, `Access Denied: Role '${req.user?.role}' is not authorized to execute financial wallet adjustments.`);
        }

        const { userId, reason, referenceId, reference } = req.body;

        if (!userId) {
            return sendResponse(res, 400, false, 'Target userId is required');
        }

        if (!reason || String(reason).trim().length < 5) {
            return sendResponse(res, 400, false, 'A descriptive reason (minimum 5 characters) is mandatory for financial adjustments');
        }

        // 2. Parse Delta Supporting Both Unified and Legacy Schemas
        let coinChange = 0;
        let diamondChange = 0;

        if (req.body.coinDelta !== undefined || req.body.diamondDelta !== undefined) {
            coinChange = Number(req.body.coinDelta) || 0;
            diamondChange = Number(req.body.diamondDelta) || 0;
        } else if (req.body.amount !== undefined) {
            const val = Math.abs(Number(req.body.amount));
            if (isNaN(val) || val <= 0) {
                return sendResponse(res, 400, false, 'Amount must be a positive number');
            }
            const isCredit = String(req.body.type || 'CREDIT').toUpperCase() === 'CREDIT';
            const delta = isCredit ? val : -val;
            const cur = String(req.body.currency || 'coins').toLowerCase();
            if (cur === 'diamonds') {
                diamondChange = delta;
            } else {
                coinChange = delta;
            }
        }

        if (coinChange === 0 && diamondChange === 0) {
            return sendResponse(res, 400, false, 'Adjustment amount must be non-zero');
        }

        // 3. Idempotency / Duplicate Request Protection
        const refId = referenceId || reference || `ADJ-${Date.now()}`;
        if (referenceId || reference) {
            const existingAudit = await AuditLog.findOne({
                action: 'WALLET_ADJUSTMENT',
                details: { $regex: String(referenceId || reference) }
            });
            if (existingAudit) {
                return sendResponse(res, 409, false, `Duplicate transaction reference '${refId}' has already been processed.`);
            }
        }

        // 4. Locate Target User
        const user = await User.findOne({
            $or: [
                ...(Number.isInteger(Number(userId)) ? [{ userId: Number(userId) }] : []),
                ...(String(userId).match(/^[0-9a-fA-F]{24}$/) ? [{ _id: userId }] : [])
            ]
        });

        if (!user) {
            return sendResponse(res, 404, false, 'Target user account not found');
        }

        const beforeCoins = user.coins || 0;
        const beforeDiamonds = user.diamonds || 0;

        // 5. Construct Atomic Mutation Query with Negative Balance Safeguard
        const updateQuery: any = { _id: user._id };
        const updateOps: any = { $inc: {} };

        if (coinChange < 0) {
            updateQuery.coins = { $gte: Math.abs(coinChange) };
        }
        if (coinChange !== 0) {
            updateOps.$inc.coins = coinChange;
        }

        if (diamondChange < 0) {
            updateQuery.diamonds = { $gte: Math.abs(diamondChange) };
        }
        if (diamondChange !== 0) {
            updateOps.$inc.diamonds = diamondChange;
        }

        // Atomic Execution: Never lost updates, never negative balance under concurrency
        const updatedUser = await User.findOneAndUpdate(updateQuery, updateOps, { new: true });
        if (!updatedUser) {
            return sendResponse(res, 400, false, `Insufficient balance for debit. Current balance: ${beforeCoins} coins, ${beforeDiamonds} diamonds. Transaction rejected to prevent negative float.`);
        }

        // 6. Record Ledger Entry
        await RechargeHistory.create({
            userId: updatedUser.userId,
            type: RechargeType.OFFLINE,
            coins: coinChange,
            diamonds: diamondChange,
            amount: 0,
            date: new Date(),
            sellerId: req.user?.userId || 0,
            status: 'COMPLETED'
        });

        // 7. Mandatory Immutable Audit Log
        let auditLogDoc;
        if (req.user?.id) {
            auditLogDoc = await AuditLog.create({
                adminId: req.user.id,
                action: 'WALLET_ADJUSTMENT',
                target: `User #${updatedUser.userId}`,
                details: `[${refId}] Adjusted wallet for ${updatedUser.name || 'User'} (#${updatedUser.userId}): Coins ${beforeCoins} -> ${updatedUser.coins} (${coinChange >= 0 ? '+' : ''}${coinChange}), Diamonds ${beforeDiamonds} -> ${updatedUser.diamonds} (${diamondChange >= 0 ? '+' : ''}${diamondChange}). Reason: ${String(reason).trim()}`,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'],
                oldValue: { coins: beforeCoins, diamonds: beforeDiamonds },
                newValue: { coins: updatedUser.coins, diamonds: updatedUser.diamonds },
                reason: String(reason).trim()
            });
        }

        return sendResponse(res, 200, true, 'Wallet balance adjusted successfully', {
            userId: updatedUser.userId,
            coins: updatedUser.coins,
            diamonds: updatedUser.diamonds,
            beforeCoins,
            beforeDiamonds,
            coinDelta: coinChange,
            diamondDelta: diamondChange,
            auditId: auditLogDoc?._id,
            referenceId: refId
        });
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};
