import mongoose, { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../models/user.model';
import { UserInterface } from '../../interfaces/user.interface';
import { InternalWalletTransaction, IInternalWalletTransaction } from './internalWallet.model';
import { CoinsTransaction } from '../../models/spentCoinModel';
import { TransactionType } from '../../constants/user';

export interface InternalWalletOperationParams {
  userId: string | number;
  amount: number;
  idempotencyKey: string;
  referenceId: string;
  reason: string;
  service?: string;
  metadata?: Record<string, any>;
}

export interface InternalWalletResult {
  transactionId: string;
  referenceId: string;
  userId: string;
  numericUserId?: number;
  type: 'DEBIT' | 'CREDIT';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  currency: 'COINS';
  status: 'COMPLETED';
  alreadyProcessed: boolean;
}

export class InternalWalletService {
  /**
   * Helper to resolve user by MongoDB _id or numeric userId.
   */
  public static async resolveUser(identifier: string | number): Promise<UserInterface> {
    if (!identifier && identifier !== 0) {
      throw new Error('INVALID_USER_ID: User identifier is required');
    }

    const strId = String(identifier).trim();
    const isObjectId = Types.ObjectId.isValid(strId) && strId.length === 24;
    const numericId = Number(strId);
    const isNumeric = Number.isInteger(numericId) && numericId > 0;

    let user: UserInterface | null = null;

    if (isObjectId) {
      user = await User.findOne({ _id: new Types.ObjectId(strId), isDeleted: false });
    }

    if (!user && isNumeric) {
      user = await User.findOne({ userId: numericId, isDeleted: false });
    }

    if (!user) {
      throw new Error(`USER_NOT_FOUND: No active user matches identifier "${identifier}"`);
    }

    if (user.isBlocked) {
      throw new Error('USER_BLOCKED: User account is currently blocked by administration');
    }

    return user;
  }

  /**
   * GET authoritative Coins balance for a user.
   * Strictly returns Coins without exposing sensitive personal info or Beans.
   */
  public static async getUserBalance(identifier: string | number): Promise<{
    userId: string;
    numericUserId?: number;
    coins: number;
    currency: 'COINS';
  }> {
    const user = await this.resolveUser(identifier);
    const coins = Number(user.diamonds || 0);

    return {
      userId: String(user._id),
      numericUserId: user.userId,
      coins,
      currency: 'COINS',
    };
  }

  /**
   * Atomic Debit of Coins from user wallet with strict YARO-side idempotency.
   */
  public static async debitCoins(params: InternalWalletOperationParams): Promise<InternalWalletResult> {
    const { userId: identifier, amount, idempotencyKey, referenceId, reason, service = 'greedy-king', metadata = {} } = params;

    // 1. Strict validation of amount
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`INVALID_AMOUNT: Amount must be a positive integer, received ${amount}`);
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      throw new Error('INVALID_IDEMPOTENCY_KEY: Idempotency key is required');
    }

    if (!referenceId || typeof referenceId !== 'string' || referenceId.trim().length === 0) {
      throw new Error('INVALID_REFERENCE_ID: Reference ID is required');
    }

    const cleanIdempotencyKey = idempotencyKey.trim();
    const cleanReferenceId = referenceId.trim();

    // 2. YARO-Side Idempotency Check: Return existing completed transaction if already processed
    const existingTx = await InternalWalletTransaction.findOne({ idempotencyKey: cleanIdempotencyKey }).lean();
    if (existingTx) {
      return {
        transactionId: existingTx.transactionId,
        referenceId: existingTx.referenceId,
        userId: String(existingTx.userId),
        numericUserId: existingTx.numericUserId,
        type: existingTx.type,
        amount: existingTx.amount,
        balanceBefore: existingTx.balanceBefore,
        balanceAfter: existingTx.balanceAfter,
        currency: 'COINS',
        status: 'COMPLETED',
        alreadyProcessed: true,
      };
    }

    // 3. Resolve user
    const user = await this.resolveUser(identifier);

    // 4. Atomic balance decrement with balance check
    // MongoDB single-document update is atomic: { diamonds: { $gte: amount } } guarantees no negative balance.
    let updatedUser: UserInterface | null = null;
    let balanceBefore = Number(user.diamonds || 0);

    if (balanceBefore < amount) {
      throw new Error(`INSUFFICIENT_COINS: Current balance is ${balanceBefore}, required is ${amount}`);
    }

    // Attempt atomic update (with up to 3 retries for concurrent non-duplicate contention)
    for (let attempt = 0; attempt < 3; attempt++) {
      updatedUser = await User.findOneAndUpdate(
        {
          _id: user._id,
          diamonds: { $gte: amount },
          isDeleted: false,
          isBlocked: false,
        },
        {
          $inc: {
            diamonds: -amount,
            wealthExp: amount,
          },
        },
        { new: true }
      );

      if (updatedUser) {
        break;
      }

      // If update returned null, refresh current user state to distinguish between insufficient balance vs race condition
      const freshUser = await User.findById(user._id).select('diamonds isBlocked isDeleted').lean();
      if (!freshUser || freshUser.isDeleted || freshUser.isBlocked) {
        throw new Error('USER_UNAVAILABLE: User account is inactive or blocked');
      }
      balanceBefore = Number(freshUser.diamonds || 0);
      if (balanceBefore < amount) {
        throw new Error(`INSUFFICIENT_COINS: Current balance is ${balanceBefore}, required is ${amount}`);
      }
    }

    if (!updatedUser) {
      throw new Error(`INSUFFICIENT_COINS: Current balance is ${balanceBefore}, required is ${amount}`);
    }

    const balanceAfter = Number(updatedUser.diamonds || 0);
    const transactionId = uuidv4();

    // 5. Save Authoritative Internal Ledger Record
    try {
      const internalTx = new InternalWalletTransaction({
        transactionId,
        idempotencyKey: cleanIdempotencyKey,
        referenceId: cleanReferenceId,
        userId: user._id,
        numericUserId: user.userId,
        type: 'DEBIT',
        amount,
        balanceBefore,
        balanceAfter,
        currency: 'COINS',
        reason,
        service,
        status: 'COMPLETED',
        metadata,
      });

      await internalTx.save();
    } catch (err: any) {
      // In case of concurrent duplicate request racing past step 2:
      if (err.code === 11000 || err.message?.includes('duplicate key')) {
        // Rollback the balance deduction because another concurrent request already claimed this idempotencyKey
        await User.updateOne(
          { _id: user._id },
          { $inc: { diamonds: amount, wealthExp: -amount } }
        );

        const racedTx = await InternalWalletTransaction.findOne({ idempotencyKey: cleanIdempotencyKey }).lean();
        if (racedTx) {
          return {
            transactionId: racedTx.transactionId,
            referenceId: racedTx.referenceId,
            userId: String(racedTx.userId),
            numericUserId: racedTx.numericUserId,
            type: racedTx.type,
            amount: racedTx.amount,
            balanceBefore: racedTx.balanceBefore,
            balanceAfter: racedTx.balanceAfter,
            currency: 'COINS',
            status: 'COMPLETED',
            alreadyProcessed: true,
          };
        }
      }
      throw err;
    }

    // 6. Log to CoinsTransaction for app-wide user expense history & host audit
    try {
      const coinTx = new CoinsTransaction({
        userId: user._id,
        hostId: user._id,
        type: (TransactionType as any).GAME_BET || 'game_bet',
        coinsSpent: amount,
        status: 'completed' as any,
        meta: {
          service,
          referenceId: cleanReferenceId,
          reason,
          transactionId,
          idempotencyKey: cleanIdempotencyKey,
        },
      });
      await coinTx.save();
    } catch {
      // Non-blocking fallback
    }

    // 7. Emit balanceUpdated socket event to notify live client views
    try {
      const { getIO, getUserRoom } = require('../../sockets');
      const io = getIO();
      if (io) {
        io.to(getUserRoom(String(user._id))).emit('balanceUpdated', {
          userId: String(user._id),
          coins: Number(updatedUser.coins || 0),
          diamonds: Number(updatedUser.diamonds || 0),
          totalBalance: Number(updatedUser.diamonds || 0),
        });
      }
    } catch {
      // Sockets optional for service API
    }

    return {
      transactionId,
      referenceId: cleanReferenceId,
      userId: String(user._id),
      numericUserId: user.userId,
      type: 'DEBIT',
      amount,
      balanceBefore,
      balanceAfter,
      currency: 'COINS',
      status: 'COMPLETED',
      alreadyProcessed: false,
    };
  }

  /**
   * Atomic Credit of Coins to user wallet with strict YARO-side idempotency.
   */
  public static async creditCoins(params: InternalWalletOperationParams): Promise<InternalWalletResult> {
    const { userId: identifier, amount, idempotencyKey, referenceId, reason, service = 'greedy-king', metadata = {} } = params;

    // 1. Strict validation of amount
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`INVALID_AMOUNT: Amount must be a positive integer, received ${amount}`);
    }

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
      throw new Error('INVALID_IDEMPOTENCY_KEY: Idempotency key is required');
    }

    if (!referenceId || typeof referenceId !== 'string' || referenceId.trim().length === 0) {
      throw new Error('INVALID_REFERENCE_ID: Reference ID is required');
    }

    const cleanIdempotencyKey = idempotencyKey.trim();
    const cleanReferenceId = referenceId.trim();

    // 2. YARO-Side Idempotency Check: Return existing completed transaction if already processed
    const existingTx = await InternalWalletTransaction.findOne({ idempotencyKey: cleanIdempotencyKey }).lean();
    if (existingTx) {
      return {
        transactionId: existingTx.transactionId,
        referenceId: existingTx.referenceId,
        userId: String(existingTx.userId),
        numericUserId: existingTx.numericUserId,
        type: existingTx.type,
        amount: existingTx.amount,
        balanceBefore: existingTx.balanceBefore,
        balanceAfter: existingTx.balanceAfter,
        currency: 'COINS',
        status: 'COMPLETED',
        alreadyProcessed: true,
      };
    }

    // 3. Resolve user
    const user = await this.resolveUser(identifier);
    const balanceBefore = Number(user.diamonds || 0);

    // 4. Atomic balance increment
    const updatedUser = await User.findOneAndUpdate(
      {
        _id: user._id,
        isDeleted: false,
        isBlocked: false,
      },
      {
        $inc: { diamonds: amount },
      },
      { new: true }
    );

    if (!updatedUser) {
      throw new Error('USER_UNAVAILABLE: User account is inactive or blocked');
    }

    const balanceAfter = Number(updatedUser.diamonds || 0);
    const transactionId = uuidv4();

    // 5. Save Authoritative Internal Ledger Record
    try {
      const internalTx = new InternalWalletTransaction({
        transactionId,
        idempotencyKey: cleanIdempotencyKey,
        referenceId: cleanReferenceId,
        userId: user._id,
        numericUserId: user.userId,
        type: 'CREDIT',
        amount,
        balanceBefore,
        balanceAfter,
        currency: 'COINS',
        reason,
        service,
        status: 'COMPLETED',
        metadata,
      });

      await internalTx.save();
    } catch (err: any) {
      // In case of concurrent duplicate request racing:
      if (err.code === 11000 || err.message?.includes('duplicate key')) {
        // Rollback the balance increment because another request with this idempotencyKey already completed
        await User.updateOne(
          { _id: user._id },
          { $inc: { diamonds: -amount } }
        );

        const racedTx = await InternalWalletTransaction.findOne({ idempotencyKey: cleanIdempotencyKey }).lean();
        if (racedTx) {
          return {
            transactionId: racedTx.transactionId,
            referenceId: racedTx.referenceId,
            userId: String(racedTx.userId),
            numericUserId: racedTx.numericUserId,
            type: racedTx.type,
            amount: racedTx.amount,
            balanceBefore: racedTx.balanceBefore,
            balanceAfter: racedTx.balanceAfter,
            currency: 'COINS',
            status: 'COMPLETED',
            alreadyProcessed: true,
          };
        }
      }
      throw err;
    }

    // 6. Log to CoinsTransaction
    try {
      const coinTx = new CoinsTransaction({
        userId: user._id,
        hostId: user._id,
        type: (TransactionType as any).GAME_WIN || 'game_win',
        hostEarning: amount,
        status: 'completed' as any,
        meta: {
          service,
          referenceId: cleanReferenceId,
          reason,
          transactionId,
          idempotencyKey: cleanIdempotencyKey,
        },
      });
      await coinTx.save();
    } catch {
      // Non-blocking fallback
    }

    // 7. Emit balanceUpdated socket event
    try {
      const { getIO, getUserRoom } = require('../../sockets');
      const io = getIO();
      if (io) {
        io.to(getUserRoom(String(user._id))).emit('balanceUpdated', {
          userId: String(user._id),
          coins: Number(updatedUser.coins || 0),
          diamonds: Number(updatedUser.diamonds || 0),
          totalBalance: Number(updatedUser.diamonds || 0),
        });
      }
    } catch {
      // Sockets optional for service API
    }

    return {
      transactionId,
      referenceId: cleanReferenceId,
      userId: String(user._id),
      numericUserId: user.userId,
      type: 'CREDIT',
      amount,
      balanceBefore,
      balanceAfter,
      currency: 'COINS',
      status: 'COMPLETED',
      alreadyProcessed: false,
    };
  }
}
