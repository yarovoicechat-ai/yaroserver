import crypto from 'crypto';
import redis from '../../configs/redisConfig';
import { GameSession, IGameSessionDocument, SessionStatus } from './game.models/gameSession.model';
import { Game } from './game.models/game.model';
import { User } from '../../models/user.model';
import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export interface ILaunchTicketData {
  ticket: string;
  userId: string;
  userName: string;
  avatar: string;
  diamonds: number;
  gameId: string;
  roomId: string;
  sessionId: string;
  createdAt: number;
  expiresAt: number;
}

// In-memory fallback if Redis is temporarily unavailable
const inMemoryTickets = new Map<string, ILaunchTicketData>();

export class GameSessionService {
  private static TICKET_TTL_SECONDS = 60; // 60 seconds single-use ticket

  /**
   * Create a secure, single-use, short-lived launch ticket for a user entering a game
   */
  public static async createLaunchTicket(params: {
    userId: string | Types.ObjectId;
    gameId: string;
    roomId: string;
    sessionId?: string;
  }): Promise<{ ticket: string; sessionId: string; gameUrl: string; expiresAt: number }> {
    const { userId, gameId, roomId } = params;

    const user = await User.findById(userId).select('name nickName avatar image diamonds').lean();
    if (!user) {
      throw new Error('User not found');
    }

    // Find or create game session for this room
    let session = params.sessionId
      ? await GameSession.findOne({ sessionId: params.sessionId })
      : await GameSession.findOne({ roomId, gameId, status: 'ACTIVE' });

    if (!session) {
      const sessionId = uuidv4();
      session = new GameSession({
        sessionId,
        gameId,
        roomId,
        hostUserId: user._id,
        status: 'ACTIVE',
        roundNumber: 1,
        roundState: 'BETTING',
        players: [
          {
            userId: user._id,
            userName: user.name || (user as any).nickName || 'Host',
            avatar: user.image || (user as any).avatar || '',
            status: 'ACTIVE',
            totalBetInSession: 0,
            totalWonInSession: 0,
          },
        ],
      });
      await session.save();
    }

    // Look up game info for gameUrl
    const game = await Game.findOne({ gameId, isActive: true }).lean();
    const baseGameUrl = game?.gameUrl || `https://games.yaroapp.in/${gameId}/`;

    // Generate random 32-byte cryptographic ticket
    const ticket = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = now + this.TICKET_TTL_SECONDS * 1000;

    const ticketData: ILaunchTicketData = {
      ticket,
      userId: user._id.toString(),
      userName: user.name || (user as any).nickName || 'Player',
      avatar: user.image || (user as any).avatar || '',
      diamonds: Number(user.diamonds || 0),
      gameId,
      roomId,
      sessionId: session.sessionId,
      createdAt: now,
      expiresAt,
    };

    // Store in Redis with TTL
    try {
      await redis.set(`game:ticket:${ticket}`, JSON.stringify(ticketData), 'EX', this.TICKET_TTL_SECONDS);
    } catch (err) {
      // Fallback in-memory
      inMemoryTickets.set(ticket, ticketData);
      setTimeout(() => inMemoryTickets.delete(ticket), this.TICKET_TTL_SECONDS * 1000);
    }

    return {
      ticket,
      sessionId: session.sessionId,
      gameUrl: baseGameUrl,
      expiresAt,
    };
  }

  /**
   * Validate and consume a single-use launch ticket
   */
  public static async consumeLaunchTicket(ticket: string): Promise<ILaunchTicketData | null> {
    if (!ticket || typeof ticket !== 'string') return null;

    let dataStr: string | null = null;
    try {
      // Atomic get and delete
      dataStr = await (redis as any).getdel(`game:ticket:${ticket}`);
      if (!dataStr) {
        dataStr = await redis.get(`game:ticket:${ticket}`);
        if (dataStr) await redis.del(`game:ticket:${ticket}`);
      }
    } catch {
      // Redis error, check fallback
    }

    if (!dataStr && inMemoryTickets.has(ticket)) {
      const data = inMemoryTickets.get(ticket)!;
      inMemoryTickets.delete(ticket);
      if (Date.now() <= data.expiresAt) return data;
      return null;
    }

    if (!dataStr) return null;

    try {
      const parsed: ILaunchTicketData = JSON.parse(dataStr);
      if (Date.now() > parsed.expiresAt) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Join or re-join a game session idempotently
   */
  public static async joinSession(params: {
    sessionId: string;
    userId: string | Types.ObjectId;
    socketId?: string;
  }): Promise<IGameSessionDocument> {
    const { sessionId, userId, socketId } = params;

    const session = await GameSession.findOne({ sessionId });
    if (!session) {
      throw new Error('Game session not found');
    }

    const user = await User.findById(userId).select('name nickName avatar image').lean();
    const existingPlayer = session.players.find(p => p.userId.toString() === userId.toString());

    if (existingPlayer) {
      existingPlayer.status = 'ACTIVE';
      if (socketId) existingPlayer.socketId = socketId;
    } else {
      session.players.push({
        userId: new Types.ObjectId(userId.toString()),
        userName: user?.name || (user as any)?.nickName || 'Player',
        avatar: user?.image || (user as any)?.avatar || '',
        socketId: socketId || '',
        joinedAt: new Date(),
        status: 'ACTIVE',
        totalBetInSession: 0,
        totalWonInSession: 0,
      });
    }

    await session.save();
    return session;
  }

  /**
   * Leave a game session
   */
  public static async leaveSession(params: {
    sessionId: string;
    userId: string | Types.ObjectId;
  }): Promise<IGameSessionDocument | null> {
    const { sessionId, userId } = params;
    const session = await GameSession.findOne({ sessionId });
    if (!session) return null;

    const player = session.players.find(p => p.userId.toString() === userId.toString());
    if (player) {
      player.status = 'LEFT';
    }

    // If host leaves and no active players remain, close session
    const activePlayers = session.players.filter(p => p.status === 'ACTIVE');
    if (activePlayers.length === 0) {
      session.status = 'COMPLETED';
    }

    await session.save();
    return session;
  }

  /**
   * Get active session by ID
   */
  public static async getSession(sessionId: string): Promise<IGameSessionDocument | null> {
    return GameSession.findOne({ sessionId }).populate('players.userId', 'name nickName avatar image diamonds').lean() as any;
  }
}
