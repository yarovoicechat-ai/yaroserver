import mongoose, { Schema, Document, Types } from 'mongoose';

export type GameTransactionType = 'BET' | 'WIN' | 'REFUND';
export type GameTransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';

export interface IGameTransactionDocument extends Document {
  transactionId: string;
  idempotencyKey: string;
  sessionId: string;
  gameId: string;
  userId: Types.ObjectId;
  type: GameTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  roundNumber?: number;
  betTarget?: string;
  multiplier?: number;
  metadata?: Record<string, any>;
  status: GameTransactionStatus;
  createdAt: Date;
}

const GameTransactionSchema = new Schema<IGameTransactionDocument>(
  {
    transactionId: { type: String, required: true, unique: true, index: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    sessionId: { type: String, required: true, index: true },
    gameId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['BET', 'WIN', 'REFUND'],
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 1 },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    roundNumber: { type: Number },
    betTarget: { type: String },
    multiplier: { type: Number },
    metadata: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'ROLLED_BACK'],
      default: 'COMPLETED',
      index: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

GameTransactionSchema.index({ userId: 1, createdAt: -1 });
GameTransactionSchema.index({ sessionId: 1, type: 1 });

export const GameTransaction = mongoose.model<IGameTransactionDocument>(
  'GameTransaction',
  GameTransactionSchema
);
