import mongoose, { Schema, Document } from 'mongoose';

export interface IReconciliationDiscrepancy {
    userId: number;
    expectedBalance: number;
    actualBalance: number;
    delta: number;
    type: string;
}

export interface IReconciliation extends Document {
    batchId: string;
    reconciliationDate: Date;
    periodStart: Date;
    periodEnd: Date;
    status: 'MATCHED' | 'DISCREPANCY_DETECTED' | 'IN_PROGRESS';
    metrics: {
        totalRechargesINR: number;
        totalCoinsCredited: number;
        totalCoinsBurned: number;
        totalDiamondsMinted: number;
        totalWithdrawalsINR: number;
        discrepancyCount: number;
    };
    discrepancies: IReconciliationDiscrepancy[];
    executedBy?: mongoose.Types.ObjectId;
    createdAt: Date;
}

const ReconciliationSchema = new Schema<IReconciliation>({
    batchId: { type: String, required: true, unique: true, index: true },
    reconciliationDate: { type: Date, default: Date.now, index: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    status: { 
        type: String, 
        enum: ['MATCHED', 'DISCREPANCY_DETECTED', 'IN_PROGRESS'],
        default: 'IN_PROGRESS' 
    },
    metrics: {
        totalRechargesINR: { type: Number, default: 0 },
        totalCoinsCredited: { type: Number, default: 0 },
        totalCoinsBurned: { type: Number, default: 0 },
        totalDiamondsMinted: { type: Number, default: 0 },
        totalWithdrawalsINR: { type: Number, default: 0 },
        discrepancyCount: { type: Number, default: 0 }
    },
    discrepancies: [{
        userId: Number,
        expectedBalance: Number,
        actualBalance: Number,
        delta: Number,
        type: { type: String }
    }],
    executedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: { createdAt: true, updatedAt: false } });

ReconciliationSchema.index({ createdAt: -1 });

export const Reconciliation = mongoose.model<IReconciliation>('Reconciliation', ReconciliationSchema);
