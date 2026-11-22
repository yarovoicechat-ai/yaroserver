import { Request, Response } from 'express';
import { InternalWalletService } from './internalWallet.service';

export class InternalWalletController {
  /**
   * POST /api/v1/internal/wallet/debit
   * Authoritative internal service debit endpoint.
   */
  public static async debit(req: Request, res: Response): Promise<void> {
    try {
      const { userId, amount, idempotencyKey, referenceId, reason, service, metadata } = req.body;

      if (!userId && userId !== 0) {
        res.status(400).json({ success: false, error: 'INVALID_USER_ID', message: 'userId is required' });
        return;
      }

      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        res.status(400).json({
          success: false,
          error: 'INVALID_AMOUNT',
          message: 'amount must be a positive integer',
        });
        return;
      }

      if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: 'INVALID_IDEMPOTENCY_KEY',
          message: 'idempotencyKey is required and must be a non-empty string',
        });
        return;
      }

      if (!referenceId || typeof referenceId !== 'string' || referenceId.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: 'INVALID_REFERENCE_ID',
          message: 'referenceId is required and must be a non-empty string',
        });
        return;
      }

      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: 'INVALID_REASON',
          message: 'reason is required',
        });
        return;
      }

      const result = await InternalWalletService.debitCoins({
        userId,
        amount,
        idempotencyKey,
        referenceId,
        reason,
        service: service || 'greedy-king',
        metadata,
      });

      res.status(200).json({
        success: true,
        message: result.alreadyProcessed ? 'Transaction already processed' : 'Wallet debited successfully',
        data: result,
      });
    } catch (err: any) {
      const errMsg = err?.message || 'Wallet debit failed';

      if (errMsg.includes('INSUFFICIENT_COINS')) {
        res.status(400).json({ success: false, error: 'INSUFFICIENT_COINS', message: errMsg });
        return;
      }
      if (errMsg.includes('USER_NOT_FOUND')) {
        res.status(404).json({ success: false, error: 'USER_NOT_FOUND', message: errMsg });
        return;
      }
      if (errMsg.includes('USER_BLOCKED') || errMsg.includes('USER_UNAVAILABLE')) {
        res.status(403).json({ success: false, error: 'USER_BLOCKED', message: errMsg });
        return;
      }
      if (errMsg.startsWith('INVALID_')) {
        res.status(400).json({ success: false, error: errMsg.split(':')[0], message: errMsg });
        return;
      }

      console.error('[InternalWalletController] Debit error:', err);
      res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal wallet service error' });
    }
  }

  /**
   * POST /api/v1/internal/wallet/credit
   * Authoritative internal service credit endpoint.
   */
  public static async credit(req: Request, res: Response): Promise<void> {
    try {
      const { userId, amount, idempotencyKey, referenceId, reason, service, metadata } = req.body;

      if (!userId && userId !== 0) {
        res.status(400).json({ success: false, error: 'INVALID_USER_ID', message: 'userId is required' });
        return;
      }

      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
        res.status(400).json({
          success: false,
          error: 'INVALID_AMOUNT',
          message: 'amount must be a positive integer',
        });
        return;
      }

      if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: 'INVALID_IDEMPOTENCY_KEY',
          message: 'idempotencyKey is required and must be a non-empty string',
        });
        return;
      }

      if (!referenceId || typeof referenceId !== 'string' || referenceId.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: 'INVALID_REFERENCE_ID',
          message: 'referenceId is required and must be a non-empty string',
        });
        return;
      }

      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: 'INVALID_REASON',
          message: 'reason is required',
        });
        return;
      }

      const result = await InternalWalletService.creditCoins({
        userId,
        amount,
        idempotencyKey,
        referenceId,
        reason,
        service: service || 'greedy-king',
        metadata,
      });

      res.status(200).json({
        success: true,
        message: result.alreadyProcessed ? 'Transaction already processed' : 'Wallet credited successfully',
        data: result,
      });
    } catch (err: any) {
      const errMsg = err?.message || 'Wallet credit failed';

      if (errMsg.includes('USER_NOT_FOUND')) {
        res.status(404).json({ success: false, error: 'USER_NOT_FOUND', message: errMsg });
        return;
      }
      if (errMsg.includes('USER_BLOCKED') || errMsg.includes('USER_UNAVAILABLE')) {
        res.status(403).json({ success: false, error: 'USER_BLOCKED', message: errMsg });
        return;
      }
      if (errMsg.startsWith('INVALID_')) {
        res.status(400).json({ success: false, error: errMsg.split(':')[0], message: errMsg });
        return;
      }

      console.error('[InternalWalletController] Credit error:', err);
      res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal wallet service error' });
    }
  }

  /**
   * GET /api/v1/internal/wallet/balance/:userId
   * Authoritative internal service balance endpoint.
   */
  public static async getBalance(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req.params;

      if (!userId) {
        res.status(400).json({ success: false, error: 'INVALID_USER_ID', message: 'userId parameter is required' });
        return;
      }

      const result = await InternalWalletService.getUserBalance(userId);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to fetch wallet balance';

      if (errMsg.includes('USER_NOT_FOUND')) {
        res.status(404).json({ success: false, error: 'USER_NOT_FOUND', message: errMsg });
        return;
      }
      if (errMsg.includes('USER_BLOCKED')) {
        res.status(403).json({ success: false, error: 'USER_BLOCKED', message: errMsg });
        return;
      }

      console.error('[InternalWalletController] GetBalance error:', err);
      res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Internal wallet service error' });
    }
  }
}
