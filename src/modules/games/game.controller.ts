import { Request, Response } from 'express';
import { AuthRequest } from '../../middlewares/authorize.middleware';
import sendResponse from '../../utils/reponse';
import { GameService } from './game.service';
import { GameSessionService } from './game.session.service';
import { GameWalletService } from './game.wallet.service';
import { GameTransaction } from './game.models/gameTransaction.model';
import { GameValidator } from './game.validator';

export class GameController {
  /**
   * GET /api/games
   * Returns catalog of active Cocos games
   */
  public static async getAllGames(req: AuthRequest, res: Response) {
    try {
      const category = req.query.category as string | undefined;
      const games = await GameService.getAllGames(category);
      return sendResponse(res, 200, true, 'Games fetched successfully', games);
    } catch (err: any) {
      return sendResponse(res, 500, false, err.message || 'Failed to fetch games');
    }
  }

  /**
   * POST /api/games/session
   * Create or join a session and generate a short-lived launch ticket
   */
  public static async createOrJoinSession(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return sendResponse(res, 401, false, 'Unauthorized');
      }

      const { gameId, roomId, sessionId } = req.body;
      if (!gameId || !roomId) {
        return sendResponse(res, 400, false, 'gameId and roomId are required');
      }

      const launchInfo = await GameSessionService.createLaunchTicket({
        userId,
        gameId,
        roomId,
        sessionId,
      });

      return sendResponse(res, 200, true, 'Game launch ticket created', {
        sessionId: launchInfo.sessionId,
        ticket: launchInfo.ticket,
        gameUrl: launchInfo.gameUrl,
        expiresAt: launchInfo.expiresAt,
      });
    } catch (err: any) {
      return sendResponse(res, 500, false, err.message || 'Failed to create game session');
    }
  }

  /**
   * POST /api/games/session/:id/join
   * Join an active multiplayer session
   */
  public static async joinSession(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return sendResponse(res, 401, false, 'Unauthorized');
      }

      const sessionId = req.params.id;
      const { socketId } = req.body;

      const session = await GameSessionService.joinSession({
        sessionId,
        userId,
        socketId,
      });

      return sendResponse(res, 200, true, 'Joined game session', session);
    } catch (err: any) {
      return sendResponse(res, 500, false, err.message || 'Failed to join session');
    }
  }

  /**
   * POST /api/games/session/:id/leave
   * Leave a game session
   */
  public static async leaveSession(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return sendResponse(res, 401, false, 'Unauthorized');
      }

      const sessionId = req.params.id;
      const session = await GameSessionService.leaveSession({
        sessionId,
        userId,
      });

      return sendResponse(res, 200, true, 'Left game session', { sessionId });
    } catch (err: any) {
      return sendResponse(res, 500, false, err.message || 'Failed to leave session');
    }
  }

  /**
   * GET /api/games/session/:id
   * Get session status and presence
   */
  public static async getSession(req: AuthRequest, res: Response) {
    try {
      const sessionId = req.params.id;
      const session = await GameSessionService.getSession(sessionId);
      if (!session) {
        return sendResponse(res, 404, false, 'Game session not found');
      }
      return sendResponse(res, 200, true, 'Session details', session);
    } catch (err: any) {
      return sendResponse(res, 500, false, err.message || 'Failed to get session');
    }
  }

  /**
   * POST /api/games/session/:id/bet
   * Place bet in an active game session
   */
  public static async placeBet(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return sendResponse(res, 401, false, 'Unauthorized');
      }

      const sessionId = req.params.id;
      const { gameId, amount, betTarget, roundNumber = 1, idempotencyKey } = req.body;

      const validation = GameValidator.validateBetPlacement({ amount, betTarget });
      if (!validation.valid) {
        return sendResponse(res, 400, false, validation.error!);
      }

      const result = await GameWalletService.debitBet({
        userId,
        gameId: gameId || 'food-game',
        sessionId,
        roundNumber,
        betTarget,
        amount,
        idempotencyKey,
      });

      return sendResponse(res, 200, true, 'Bet placed successfully', result);
    } catch (err: any) {
      const status = err.message?.includes('INSUFFICIENT_DIAMONDS') ? 400 : 500;
      return sendResponse(res, status, false, err.message || 'Failed to place bet');
    }
  }

  /**
   * POST /api/games/session/:id/payout
   * Claim authoritative winning payout for a completed round
   */
  public static async claimPayout(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return sendResponse(res, 401, false, 'Unauthorized');
      }

      const sessionId = req.params.id;
      const {
        gameId = 'greedy-king',
        roundNumber = 1,
        betTarget,
        multiplier = 1,
        winAmount,
        idempotencyKey,
      } = req.body;

      if (!winAmount || Number(winAmount) <= 0) {
        return sendResponse(res, 400, false, 'Invalid winAmount');
      }

      const amountToCredit = Number(winAmount);
      const mult = Number(multiplier);

      // Validate allowed multipliers (2x - 50x)
      if (mult < 1 || mult > 100) {
        return sendResponse(res, 400, false, 'Invalid multiplier');
      }

      const result = await GameWalletService.creditWin({
        userId,
        gameId,
        sessionId,
        roundNumber,
        betTarget: betTarget || 'winner',
        multiplier: mult,
        winAmount: amountToCredit,
        idempotencyKey: idempotencyKey || `payout_${sessionId}_r${roundNumber}_u${userId}_${amountToCredit}`,
      });

      return sendResponse(res, 200, true, 'Payout credited successfully', {
        ...result,
        status: 'SUCCESS',
      });
    } catch (err: any) {
      return sendResponse(res, 500, false, err.message || 'Failed to claim payout');
    }
  }

  /**
   * POST /api/games/session/:id/result
   * Settle round and distribute winnings
   */
  public static async settleRound(req: AuthRequest, res: Response) {
    try {
      const sessionId = req.params.id;
      const { winningTarget, multiplier } = req.body;

      const result = await GameService.settleRound({
        sessionId,
        winningTarget,
        winningMultiplier: multiplier,
      });

      return sendResponse(res, 200, true, 'Round settled successfully', result);
    } catch (err: any) {
      return sendResponse(res, 500, false, err.message || 'Failed to settle round');
    }
  }

  /**
   * GET /api/games/wallet
   * Get user balance and transaction history
   */
  public static async getWallet(req: AuthRequest, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return sendResponse(res, 401, false, 'Unauthorized');
      }

      const balance = await GameWalletService.getUserBalance(userId);
      const recentTransactions = await GameTransaction.find({ userId })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();

      return sendResponse(res, 200, true, 'Game wallet fetched successfully', {
        diamonds: balance.diamonds,
        coins: balance.coins,
        history: recentTransactions,
      });
    } catch (err: any) {
      return sendResponse(res, 500, false, err.message || 'Failed to fetch wallet');
    }
  }

  /**
   * GET /api/games/config
   * Returns client game visibility configuration (public/auth)
   */
  public static async getGameConfig(req: Request, res: Response) {
    try {
      const config = await GameService.getGameConfig();
      return sendResponse(res, 200, true, 'Game config fetched', config);
    } catch (err: any) {
      return sendResponse(res, 500, false, err.message || 'Failed to fetch game config');
    }
  }

  /**
   * GET /api/games/admin/all
   * Admin endpoint to get all games with visibility settings
   */
  public static async getAdminGames(req: AuthRequest, res: Response) {
    try {
      const games = await GameService.getAdminGames();
      return sendResponse(res, 200, true, 'Admin games fetched', games);
    } catch (err: any) {
      return sendResponse(res, 500, false, err.message || 'Failed to fetch admin games');
    }
  }

  /**
   * PATCH /api/games/:gameId/status
   * Admin endpoint to toggle active, hidden, and room visibility
   */
  public static async updateGameStatus(req: AuthRequest, res: Response) {
    try {
      const { gameId } = req.params;
      const { isActive, isHidden, showInVoiceRoom, showInLiveRoom, showFloatingBanner } = req.body;
      const updated = await GameService.updateGameStatus(gameId, {
        isActive,
        isHidden,
        showInVoiceRoom,
        showInLiveRoom,
        showFloatingBanner,
      });
      if (!updated) {
        return sendResponse(res, 404, false, 'Game not found');
      }
      return sendResponse(res, 200, true, 'Game status updated successfully', updated);
    } catch (err: any) {
      return sendResponse(res, 500, false, err.message || 'Failed to update game status');
    }
  }
}
