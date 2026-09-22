
































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
 * Audited balance adjustment endpoint
 * POST /api/admin/wallet/adjust
 */
export const adjustWalletBalance = async (req: AuthRequest, res: Response) => {
    try {
        const { userId, currency = 'coins', amount, type = 'CREDIT', reason } = req.body;

        if (!userId) {
            return sendResponse(res, 400, false, 'Target userId is required');
        }

        const delta = Math.abs(Number(amount));
        if (isNaN(delta) || delta <= 0) {
            return sendResponse(res, 400, false, 'Amount must be a positive number');
        }

        if (!reason || reason.trim().length < 5) {
            return sendResponse(res, 400, false, 'A descriptive reason (min 5 chars) is mandatory for financial adjustments');
        }

        const user = await User.findOne({
            $or: [
                ...(Number.isInteger(Number(userId)) ? [{ userId: Number(userId) }] : []),
                ...(String(userId).match(/^[0-9a-fA-F]{24}$/) ? [{ _id: userId }] : [])
            ]
        });

        if (!user) {
            return sendResponse(res, 404, false, 'User account not found');
        }

        const currencyKey = currency.toLowerCase() === 'diamonds' ? 'diamonds' : 'coins';
        const beforeValue = user[currencyKey] || 0;

        let afterValue = beforeValue;
        if (type.toUpperCase() === 'CREDIT') {
            afterValue = beforeValue + delta;
        } else if (type.toUpperCase() === 'DEBIT') {
            if (beforeValue < delta) {
                return sendResponse(res, 400, false, `Insufficient balance to debit. Current ${currencyKey}: ${beforeValue}`);
            }
            afterValue = beforeValue - delta;
        } else {
            return sendResponse(res, 400, false, "Adjustment type must be either 'CREDIT' or 'DEBIT'");
        }

        user[currencyKey] = afterValue;
        await user.save();

        // Ledger track in RechargeHistory
        await RechargeHistory.create({
            userId: user.userId,
            type: RechargeType.OFFLINE,
            coins: currencyKey === 'coins' ? (type.toUpperCase() === 'CREDIT' ? delta : -delta) : 0,
            diamonds: currencyKey === 'diamonds' ? (type.toUpperCase() === 'CREDIT' ? delta : -delta) : 0,
            amount: 0,
            date: new Date(),
            sellerId: req.user?.userId || 0,
            status: 'COMPLETED'
        });

        // Mandatory Immutable Audit Log
        let auditLogDoc;
        if (req.user?.id) {
            auditLogDoc = await AuditLog.create({
                adminId: req.user.id,
                action: 'WALLET_ADJUSTMENT',
                target: `User #${user.userId}`,
                details: `${type.toUpperCase()} ${delta} ${currencyKey} to user ${user.name} (#${user.userId}). Before: ${beforeValue}, After: ${afterValue}`,
                ipAddress: req.ip || '127.0.0.1',
                userAgent: req.headers['user-agent'],
                oldValue: { [currencyKey]: beforeValue },
                newValue: { [currencyKey]: afterValue },
                reason: reason.trim()
            });
        }

        return sendResponse(res, 200, true, `Successfully adjusted ${currencyKey} balance`, {
            userId: user.userId,
            currency: currencyKey,
            beforeBalance: beforeValue,
            newBalance: afterValue,
            auditId: auditLogDoc?._id
        });
    } catch (err: any) {
        return sendResponse(res, 500, false, err.message);
    }
};
