import { Server } from 'socket.io';
import { AuthenticatedSocket } from '../../middlewares/auth.socket';
import { GameSessionService } from './game.session.service';
import { GameWalletService } from './game.wallet.service';
import { GameService } from './game.service';
import { GameValidator } from './game.validator';

export const registerGameSocketHandlers = (io: Server, socket: AuthenticatedSocket) => {
  const userId = socket.user?.id ? socket.user.id.toString() : '';

  /**
   * Authenticate game client using short-lived launch ticket
   */
  socket.on('game:authenticate', async (payload: { ticket: string }, callback?: (res: any) => void) => {
    try {
      const ticketData = await GameSessionService.consumeLaunchTicket(payload?.ticket);
      if (!ticketData) {
        callback?.({ success: false, error: 'Invalid or expired game launch ticket' });
        socket.emit('game:error', { message: 'Invalid or expired ticket' });
        return;
      }

      // Join the game session room
      const sessionRoom = `game_session:${ticketData.sessionId}`;
      socket.join(sessionRoom);

      await GameSessionService.joinSession({
        sessionId: ticketData.sessionId,
        userId: ticketData.userId,
        socketId: socket.id,
      });

      callback?.({
        success: true,
        user: {
          userId: ticketData.userId,
          userName: ticketData.userName,
          diamonds: ticketData.diamonds,
        },
        sessionId: ticketData.sessionId,
        roomId: ticketData.roomId,
        gameId: ticketData.gameId,
      });

      // Broadcast player joined to room
      socket.to(sessionRoom).emit('game:player_joined', {
        userId: ticketData.userId,
        userName: ticketData.userName,
        avatar: ticketData.avatar,
      });
    } catch (err: any) {
      callback?.({ success: false, error: err.message || 'Authentication failed' });
    }
  });

  /**
   * Player bet event
   */
  socket.on('game:place_bet', async (payload: {
    sessionId: string;
    gameId: string;
    roundNumber?: number;
    betTarget: string;
    amount: number;
    idempotencyKey?: string;
  }, callback?: (res: any) => void) => {
    try {
      if (!userId) {
        callback?.({ success: false, error: 'Unauthorized' });
        return;
      }

      const validation = GameValidator.validateBetPlacement({
        amount: payload.amount,
        betTarget: payload.betTarget,
      });
      if (!validation.valid) {
        callback?.({ success: false, error: validation.error });
        return;
      }

      const debitResult = await GameWalletService.debitBet({
        userId,
        gameId: payload.gameId,
        sessionId: payload.sessionId,
        roundNumber: payload.roundNumber,
        betTarget: payload.betTarget,
        amount: payload.amount,
        idempotencyKey: payload.idempotencyKey,
      });

      const sessionRoom = `game_session:${payload.sessionId}`;

      // Notify player with new balance
      callback?.({
        success: true,
        balanceAfter: debitResult.balanceAfter,
        transactionId: debitResult.transactionId,
      });

      // Broadcast bet to other players in session
      socket.to(sessionRoom).emit('game:bet_placed', {
        userId,
        userName: socket.user?.name || 'Player',
        betTarget: payload.betTarget,
        amount: payload.amount,
      });
    } catch (err: any) {
      callback?.({ success: false, error: err.message || 'Failed to place bet' });
    }
  });

  /**
   * Leave game session
   */
  socket.on('game:leave', async (payload: { sessionId: string }) => {
    if (!payload?.sessionId || !userId) return;
    const sessionRoom = `game_session:${payload.sessionId}`;
    socket.leave(sessionRoom);
    await GameSessionService.leaveSession({ sessionId: payload.sessionId, userId });
    socket.to(sessionRoom).emit('game:player_left', { userId });
  });

  /**
   * Disconnect cleanup
   */
  socket.on('disconnect', () => {
    // Rooms are automatically left by Socket.IO
  });
};
