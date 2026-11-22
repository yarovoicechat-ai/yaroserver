import { Game, IGameDocument } from './game.models/game.model';
import { GameSession } from './game.models/gameSession.model';
import { GameWalletService } from './game.wallet.service';
import { Types } from 'mongoose';

export const DEFAULT_COCOS_GAMES = [
  {
    gameId: 'greedy-king',
    title: 'Greedy King',
    subtitle: 'King Fruit Wheel & Royal 50x Multiplier',
    description: 'Cocos Creator HTML5 Greedy King with instant royal coin rewards & multiplayer live wheel!',
    category: 'Wheel',
    icon: 'crown',
    gameUrl: 'https://games.yaroapp.in/greedy-king/',
    minBet: 50,
    maxBet: 50000,
    multipliers: [2, 5, 10, 15, 20, 25, 30, 50],
    isActive: true,
    isMultiplayer: true,
    maxPlayers: 100,
    tag: 'HOT',
    gradient: ['#F59E0B', '#EF4444', '#7C3AED'],
  },
  {
    gameId: 'food-game',
    title: 'Food Game (Fruit Wheel)',
    subtitle: 'Fruit & Food Multipliers up to 50x',
    description: 'Cocos Creator 3.8.x Web Mobile food wheel with server-authoritative payouts!',
    category: 'Wheel',
    icon: 'fruit-cherries',
    gameUrl: 'https://games.yaroapp.in/food-game/',
    minBet: 50,
    maxBet: 50000,
    multipliers: [2, 5, 10, 15, 20, 25, 30, 50],
    isActive: true,
    isMultiplayer: true,
    maxPlayers: 100,
    tag: 'HOT',
    gradient: ['#FF416C', '#FF4B2B'],
  },
  {
    gameId: 'greedy-baby',
    title: 'Greedy Baby',
    subtitle: 'Fruit Wheel 50x Multiplier',
    description: 'Cocos Creator HTML5 fruit wheel with instant coin rewards!',
    category: 'Wheel',
    icon: 'fruit-cherries',
    gameUrl: 'https://games.yaroapp.in/greedy-baby/',
    minBet: 50,
    maxBet: 50000,
    multipliers: [2, 5, 10, 15, 20, 25, 30, 50],
    isActive: true,
    isMultiplayer: true,
    maxPlayers: 100,
    tag: 'COCOS',
    gradient: ['#FF416C', '#FF4B2B'],
  },
  {
    gameId: 'lucky-wheel',
    title: 'Lucky Wheel',
    subtitle: 'Colors & Multipliers',
    description: 'Cocos Creator Web wheel with 36x multipliers & live stats!',
    category: 'Wheel',
    icon: 'tire',
    gameUrl: 'https://games.yaroapp.in/lucky-wheel/',
    minBet: 50,
    maxBet: 25000,
    multipliers: [2, 4, 8, 16, 36],
    isActive: true,
    isMultiplayer: true,
    maxPlayers: 100,
    tag: 'POPULAR',
    gradient: ['#8A2387', '#E94057', '#F27121'],
  },
  {
    gameId: 'teen-patti',
    title: 'Teen Patti Live',
    subtitle: 'Player A vs Player B Cards',
    description: 'Cocos 2D 3-card table round with live predictions & odds!',
    category: 'Casino',
    icon: 'cards-playing-outline',
    gameUrl: 'https://games.yaroapp.in/teen-patti/',
    minBet: 100,
    maxBet: 50000,
    multipliers: [2, 3, 5, 10],
    isActive: true,
    isMultiplayer: true,
    maxPlayers: 50,
    tag: 'COCOS',
    gradient: ['#11998e', '#38ef7d'],
  },
  {
    gameId: 'lucky-7',
    title: 'Lucky 7',
    subtitle: '7 Down · Lucky 7 · 7 Up',
    description: 'Cocos Web dice game! Predict 7 Down, Lucky 7, or 7 Up.',
    category: 'Casual',
    icon: 'dice-6',
    gameUrl: 'https://games.yaroapp.in/lucky-7/',
    minBet: 50,
    maxBet: 20000,
    multipliers: [2, 6, 2],
    isActive: true,
    isMultiplayer: true,
    maxPlayers: 100,
    tag: 'COCOS',
    gradient: ['#1A2980', '#26D0CE'],
  },
  {
    gameId: 'crash',
    title: 'Crash (Rocket)',
    subtitle: 'Cash Out Before Blast!',
    description: 'Cocos Creator rocket crash curve with real-time cashout!',
    category: 'Casual',
    icon: 'rocket-launch',
    gameUrl: 'https://games.yaroapp.in/crash/',
    minBet: 50,
    maxBet: 50000,
    multipliers: [1.1, 2, 5, 10, 50, 100],
    isActive: true,
    isMultiplayer: true,
    maxPlayers: 100,
    tag: 'HOT',
    gradient: ['#FF512F', '#DD2476'],
  },
  {
    gameId: 'ludo',
    title: 'Ludo Party',
    subtitle: 'Quick Dice Board Race',
    description: 'Cocos Creator multiplayer Ludo board game in half screen!',
    category: 'Board',
    icon: 'grid-large',
    gameUrl: 'https://games.yaroapp.in/ludo/',
    minBet: 100,
    maxBet: 10000,
    multipliers: [2, 3, 4],
    isActive: true,
    isMultiplayer: true,
    maxPlayers: 4,
    tag: 'COCOS',
    gradient: ['#654ea3', '#eaafc8'],
  },
];

export class GameService {
  /**
   * Seed default games if not present
   */
  public static async seedGamesIfEmpty(): Promise<void> {
    try {
      for (const game of DEFAULT_COCOS_GAMES) {
        await Game.findOneAndUpdate(
          { gameId: game.gameId },
          { $setOnInsert: game },
          { upsert: true, new: true }
        );
      }
    } catch {
      // Ignore seed error
    }
  }

  /**
   * Get all active games (excluding hidden games for client catalog)
   */
  public static async getAllGames(category?: string): Promise<IGameDocument[]> {
    await this.seedGamesIfEmpty();
    const query: any = { isActive: true, isHidden: { $ne: true } };
    if (category && category !== 'All' && category !== 'Hot') {
      query.category = category;
    }
    return Game.find(query).sort({ createdAt: 1 }).lean();
  }

  /**
   * Get all games for Admin Management Panel
   */
  public static async getAdminGames(): Promise<IGameDocument[]> {
    await this.seedGamesIfEmpty();
    return Game.find().sort({ createdAt: 1 }).lean();
  }

  /**
   * Update game status / visibility from Management Panel
   */
  public static async updateGameStatus(
    gameId: string,
    updateData: {
      isActive?: boolean;
      isHidden?: boolean;
      showInVoiceRoom?: boolean;
      showInLiveRoom?: boolean;
      showFloatingBanner?: boolean;
    }
  ): Promise<IGameDocument | null> {
    await this.seedGamesIfEmpty();
    return Game.findOneAndUpdate(
      { gameId },
      { $set: updateData },
      { new: true }
    ).lean();
  }

  /**
   * Get game visibility config for client apps
   */
  public static async getGameConfig(): Promise<any> {
    await this.seedGamesIfEmpty();
    const games = await Game.find({ gameId: 'greedy-king' }).lean();
    const gk = games[0];
    return {
      greedyKing: {
        gameId: 'greedy-king',
        title: gk?.title || 'Greedy King',
        isActive: gk ? gk.isActive !== false : true,
        isHidden: gk ? Boolean(gk.isHidden) : false,
        showInVoiceRoom: gk ? gk.showInVoiceRoom !== false : true,
        showInLiveRoom: gk ? gk.showInLiveRoom !== false : true,
        showFloatingBanner: gk ? gk.showFloatingBanner !== false : true,
      },
    };
  }

  /**
   * Settle round on server (Server-Authoritative outcome calculation)
   */
  public static async settleRound(params: {
    sessionId: string;
    winningTarget?: string;
    winningMultiplier?: number;
  }): Promise<{
    sessionId: string;
    roundNumber: number;
    winningTarget: string;
    multiplier: number;
    totalBets: number;
    totalPayout: number;
    winners: { userId: string; winAmount: number }[];
  }> {
    const { sessionId } = params;
    const session = await GameSession.findOne({ sessionId });
    if (!session) {
      throw new Error('Session not found');
    }

    const currentBets = session.currentRoundBets || [];
    const totalBets = currentBets.reduce((acc, b) => acc + (b.amount || 0), 0);

    // Fruit wheel items definition
    const targets = [
      { id: 'apple', mult: 2 },
      { id: 'orange', mult: 5 },
      { id: 'mango', mult: 10 },
      { id: 'melon', mult: 15 },
      { id: 'banana', mult: 20 },
      { id: 'berry', mult: 25 },
      { id: 'cherry', mult: 30 },
      { id: 'grape', mult: 50 },
    ];

    // Pick winning target if not supplied
    let winner = targets.find(t => t.id === params.winningTarget);
    if (!winner) {
      const randomIdx = Math.floor(Math.random() * targets.length);
      winner = targets[randomIdx];
    }

    const winningTarget = winner.id;
    const multiplier = params.winningMultiplier || winner.mult;

    const winners: { userId: string; winAmount: number }[] = [];
    let totalPayout = 0;

    // Credit each player who bet on the winning target
    for (const bet of currentBets) {
      if (bet.betTarget === winningTarget && bet.amount > 0) {
        const winAmount = bet.amount * multiplier;
        totalPayout += winAmount;
        winners.push({ userId: bet.userId.toString(), winAmount });

        await GameWalletService.creditWin({
          userId: bet.userId,
          gameId: session.gameId,
          sessionId: session.sessionId,
          roundNumber: session.roundNumber,
          betTarget: winningTarget,
          multiplier,
          winAmount,
          idempotencyKey: `win_${session.sessionId}_r${session.roundNumber}_u${bet.userId}_${winningTarget}`,
        });
      }
    }

    // Update session state
    session.lastResult = {
      winningTarget,
      multiplier,
      totalBets,
      totalPayout,
      settledAt: new Date(),
    };
    session.roundState = 'WAITING';
    session.roundNumber += 1;
    session.currentRoundBets = [];
    await session.save();

    return {
      sessionId: session.sessionId,
      roundNumber: session.roundNumber - 1,
      winningTarget,
      multiplier,
      totalBets,
      totalPayout,
      winners,
    };
  }
}
