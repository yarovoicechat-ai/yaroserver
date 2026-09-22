import { RechargeHistory } from '../models/RechargeHistory';
import { CoinsTransaction } from '../models/spentCoinModel';
import { Withdrawal, WithdrawalStatus } from '../models/withdrawal.model';
import { User } from '../models/user.model';
import { Reconciliation, IReconciliation } from '../models/reconciliation.model';
import mongoose from 'mongoose';

export class ReconciliationService {
    /**
     * Compute financial ledger invariants over a date range
     */
    static async executeReconciliation(
        periodStart: Date,
        periodEnd: Date,
        actorId?: mongoose.Types.ObjectId
    ): Promise<IReconciliation> {
        const batchId = `REC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        // 1. Total fiat recharges
        const rechargeAgg = await RechargeHistory.aggregate([
            { $match: { date: { $gte: periodStart, $lte: periodEnd }, status: 'COMPLETED' } },
            { $group: { _id: null, totalINR: { $sum: '$amount' }, totalCoins: { $sum: '$coins' } } }
        ]);
        const totalRechargesINR = rechargeAgg[0]?.totalINR || 0;
        const totalCoinsCredited = rechargeAgg[0]?.totalCoins || 0;

        // 2. Total coins burned in calls/gifts
        const coinBurnAgg = await CoinsTransaction.aggregate([
            { $match: { createdAt: { $gte: periodStart, $lte: periodEnd } } },
            { $group: { _id: null, totalBurned: { $sum: '$coinsSpent' }, totalDiamonds: { $sum: '$hostEarning' } } }
        ]);
        const totalCoinsBurned = coinBurnAgg[0]?.totalBurned || 0;
        const totalDiamondsMinted = coinBurnAgg[0]?.totalDiamonds || 0;

        // 3. Total creator withdrawals disbursed
        const withdrawalAgg = await Withdrawal.aggregate([
            { $match: { updatedAt: { $gte: periodStart, $lte: periodEnd }, status: WithdrawalStatus.APPROVED } },
            { $group: { _id: null, totalPaidINR: { $sum: '$amount' } } }
        ]);
        const totalWithdrawalsINR = withdrawalAgg[0]?.totalPaidINR || 0;

        // 4. Sample audit check for negative user balances
        const negativeUsers = await User.find({
            $or: [{ coins: { $lt: 0 } }, { diamonds: { $lt: 0 } }],
            isDeleted: false
        }).select('userId coins diamonds').limit(50).lean();

        const discrepancies = negativeUsers.map(u => ({
            userId: u.userId,
            expectedBalance: 0,
            actualBalance: (u.coins || 0) < 0 ? (u.coins || 0) : (u.diamonds || 0),
            delta: Math.abs((u.coins || 0) < 0 ? (u.coins || 0) : (u.diamonds || 0)),
            type: 'NEGATIVE_BALANCE_ANOMALY'
        }));

        const status = discrepancies.length === 0 ? 'MATCHED' : 'DISCREPANCY_DETECTED';

        const record = await Reconciliation.create({
            batchId,
            reconciliationDate: new Date(),
            periodStart,
            periodEnd,
            status,
            metrics: {
                totalRechargesINR,
                totalCoinsCredited,
                totalCoinsBurned,
                totalDiamondsMinted,
                totalWithdrawalsINR,
                discrepancyCount: discrepancies.length
            },
            discrepancies,
            executedBy: actorId
        });

        return record;
    }
}
