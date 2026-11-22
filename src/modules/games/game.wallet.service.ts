import mongoose, { Types } from 'mongoose';
import { User } from '../../models/user.model';
import { GameTransaction } from './game.models/gameTransaction.model';
import { CoinsTransaction } from '../../models/spentCoinModel';
import { TransactionType } from '../../constants/user';
import { v4 as uuidv4 } from 'uuid';

export interface DebitBetParams {
  userId: string | Types.ObjectId;
  gameId: string;
  sessionId: string;
  roundNumber?: number;
  betTarget: string;
  amount: number;
  idempotencyKey?: string;
}

export interface CreditWinParams {
  userId: string | Types.ObjectId;
  gameId: string;
  sessionId: string;
  roundNumber?: number;
  betTarget: string;
  multiplier: number;
  winAmount: number;
  idempotencyKey?: string;
  metadata?: Record<string, any>;
}

export interface RefundBetParams {
  userId: string | Types.ObjectId;
  gameId: string;
  sessionId: string;
  roundNumber?: number;
  amount: number;
  reason: string;
  idempotencyKey?: string;
}

export class GameWalletService {
  /**
   * Get user wallet balance safely from DB
   */
  public static async getUserBalance(userId: string | Types.ObjectId): Promise<{ diamonds: number; coins: number; beans: number }> {
    const user = await User.findById(userId).select('diamonds coins beans').lean();
    if (!user) {
      throw new Error('User not found');
    }
    const coins = Number(user.diamonds ?? 0);
    const beans = Number((user as any).beans ?? user.coins ?? 0);
    return {
      coins,
      diamonds: coins,
      beans,
    };
  }

  /**
   * Atomic debit of bet amount with strict idempotency and balance check
   */
  public static async debitBet(params: DebitBetParams): Promise<{
    success: boolean;
    balanceAfter: number;
    transactionId: string;
    alreadyProcessed?: boolean;
  }> {
    const { userId, gameId, sessionId, roundNumber = 1, betTarget, amount } = params;
    const idempotencyKey = params.idempotencyKey || `bet_${sessionId}_r${roundNumber}_u${userId}_${betTarget}_${amount}`;

    // 1. Check if this exact bet transaction was already processed
    const existing = await GameTransaction.findOne({ idempotencyKey }).lean();
    if (existing) {
      return {
        success: existing.status === 'COMPLETED',
        balanceAfter: existing.balanceAfter,
        transactionId: existing.transactionId,
        alreadyProcessed: true,
      };
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 2. Fetch current balance before debit
      const user = await User.findById(userId).session(session);
      if (!user) {
        await session.abortTransaction();
        throw new Error('User not found');
      }

      const balanceBefore = Number(user.diamonds ?? 0);
      if (balanceBefore < amount) {
        await session.abortTransaction();
        throw new Error(`INSUFFICIENT_COINS: Current balance is ${balanceBefore}, required is ${amount}`);
      }

      // 3. Atomically decrement user's spending balance (diamonds)
      const updatedUser = await User.findOneAndUpdate(
        { _id: user._id, diamonds: { $gte: amount } },
        {
          $inc: {
            diamonds: -amount,
            wealthExp: amount, // count game play towards wealth level progression
          },
        },
        { session, new: true }
      );

      if (!updatedUser) {
        await session.abortTransaction();
        throw new Error('INSUFFICIENT_COINS: Balance insufficient or concurrently modified');
      }

      const balanceAfter = Number(updatedUser.diamonds ?? 0);
      const transactionId = uuidv4();

      // 4. Create GameTransaction record
      const gameTx = new GameTransaction({
        transactionId,
        idempotencyKey,
        sessionId,
        gameId,
        userId: user._id,
        type: 'BET',
        amount,
        balanceBefore,
        balanceAfter,
        roundNumber,
        betTarget,
        status: 'COMPLETED',
      });
      await gameTx.save({ session });

      // 5. Also log to CoinsTransaction for app-wide audit & stats
      try {
        const coinTx = new CoinsTransaction({
          userId: user._id,
          hostId: user._id,
          type: (TransactionType as any).GAME_BET || 'game_bet',
          coinsSpent: amount,
          status: 'completed' as any,
          meta: {
            gameId,
            sessionId,
            roundNumber,
            betTarget,
            transactionId,
          },
        });
        await coinTx.save({ session });
      } catch {
        // Non-blocking fallback for spentCoin schema validation differences
      }

      await session.commitTransaction();

      return {
        success: true,
        balanceAfter,
        transactionId,
      };
    } catch (err: any) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw err;
    } finally {
      session.endSession();
    }
  }

  /**
   * Atomic credit of game win
   */
  public static async creditWin(params: CreditWinParams): Promise<{
    success: boolean;
    balanceAfter: number;
    transactionId: string;
    alreadyProcessed?: boolean;
  }> {
    const { userId, gameId, sessionId, roundNumber = 1, betTarget, multiplier, winAmount, metadata = {} } = params;
    const idempotencyKey = params.idempotencyKey || `win_${sessionId}_r${roundNumber}_u${userId}_${winAmount}`;

    // 1. Idempotency check
    const existing = await GameTransaction.findOne({ idempotencyKey }).lean();
    if (existing) {
      return {
        success: existing.status === 'COMPLETED',
        balanceAfter: existing.balanceAfter,
        transactionId: existing.transactionId,
        alreadyProcessed: true,
      };
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      if (!user) {
        await session.abortTransaction();
        throw new Error('User not found');
      }

      const balanceBefore = Number(user.diamonds ?? 0);

      // 2. Atomically increment user's spending balance (diamonds)
      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        {
          $inc: { diamonds: winAmount },
        },
        { session, new: true }
      );

      if (!updatedUser) {
        await session.abortTransaction();
        throw new Error('Failed to credit winnings to user account');
      }

      const balanceAfter = Number(updatedUser.diamonds ?? 0);
      const transactionId = uuidv4();

      // 3. Record GameTransaction
      const gameTx = new GameTransaction({
        transactionId,
        idempotencyKey,
        sessionId,
        gameId,
        userId: user._id,
        type: 'WIN',
        amount: winAmount,
        balanceBefore,
        balanceAfter,
        roundNumber,
        betTarget,
        multiplier,
        metadata,
        status: 'COMPLETED',
      });
      await gameTx.save({ session });

      // 4. Also log to CoinsTransaction
      try {
        const coinTx = new CoinsTransaction({
          userId: user._id,
          hostId: user._id,
          type: (TransactionType as any).GAME_WIN || 'game_win',
          hostEarning: winAmount,
          status: 'completed' as any,
          meta: {
            gameId,
            sessionId,
            roundNumber,
            betTarget,
            multiplier,
            transactionId,
          },
        });
        await coinTx.save({ session });
      } catch {
        // Non-blocking
      }

      await session.commitTransaction();

      return {
        success: true,
        balanceAfter,
        transactionId,
      };
    } catch (err: any) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw err;
    } finally {
      session.endSession();
    }
  }

  /**
   * Refund bet in case of cancelled game round or server disconnect
   */
  public static async refundBet(params: RefundBetParams): Promise<{
    success: boolean;
    balanceAfter: number;
    transactionId: string;
  }> {
    const { userId, gameId, sessionId, roundNumber, amount, reason } = params;
    const idempotencyKey = params.idempotencyKey || `refund_${sessionId}_r${roundNumber}_u${userId}_${amount}`;

    const existing = await GameTransaction.findOne({ idempotencyKey }).lean();
    if (existing) {
      return {
        success: existing.status === 'COMPLETED',
        balanceAfter: existing.balanceAfter,
        transactionId: existing.transactionId,
      };
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findById(userId).session(session);
      if (!user) {
        await session.abortTransaction();
        throw new Error('User not found');
      }

      const balanceBefore = Number(user.diamonds ?? 0);
      const updatedUser = await User.findByIdAndUpdate(
        user._id,
        { $inc: { diamonds: amount } },
        { session, new: true }
      );

      const balanceAfter = Number(updatedUser?.diamonds ?? balanceBefore + amount);
      const transactionId = uuidv4();

      const gameTx = new GameTransaction({
        transactionId,
        idempotencyKey,
        sessionId,
        gameId,
        userId: user._id,
        type: 'REFUND',
        amount,
        balanceBefore,
        balanceAfter,
        roundNumber,
        metadata: { reason },
        status: 'COMPLETED',
      });
      await gameTx.save({ session });

      await session.commitTransaction();
      return {
        success: true,
        balanceAfter,
        transactionId,
      };
    } catch (err: any) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw err;
    } finally {
      session.endSession();
    }
  }
}
