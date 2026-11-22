import mongoose, { Schema, Document, Types } from 'mongoose';

export type InternalTransactionType = 'DEBIT' | 'CREDIT';
export type InternalTransactionStatus = 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';

export interface IInternalWalletTransaction extends Document {
  transactionId: string;
  idempotencyKey: string;
  referenceId: string;
  userId: Types.ObjectId;
  numericUserId?: number;
  type: InternalTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  currency: 'COINS';
  reason: string;
  service: string;
  status: InternalTransactionStatus;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const InternalWalletTransactionSchema = new Schema<IInternalWalletTransaction>(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    referenceId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    numericUserId: {
      type: Number,
      index: true,
    },
    type: {
      type: String,
      enum: ['DEBIT', 'CREDIT'],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: (v: number) => Number.isInteger(v) && v > 0,
        message: 'Amount must be a positive integer',
      },
    },
    balanceBefore: {
      type: Number,
      required: true,
      min: 0,
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      enum: ['COINS'],
      default: 'COINS',
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    service: {
      type: String,
      default: 'greedy-king',
      index: true,
    },
    status: {
      type: String,
      enum: ['COMPLETED', 'FAILED', 'ROLLED_BACK'],
      default: 'COMPLETED',
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for high-throughput lookup & reconciliation
InternalWalletTransactionSchema.index({ userId: 1, createdAt: -1 });
InternalWalletTransactionSchema.index({ service: 1, referenceId: 1 });
InternalWalletTransactionSchema.index({ type: 1, createdAt: -1 });

export const InternalWalletTransaction =
  (mongoose.models.InternalWalletTransaction as mongoose.Model<IInternalWalletTransaction>) ||
  mongoose.model<IInternalWalletTransaction>(
    'InternalWalletTransaction',
    InternalWalletTransactionSchema
  );
