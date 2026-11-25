import { Types } from 'mongoose';
import { Room } from '../models/room.model';
import redis from '../configs/redisConfig';

export interface CalculatorParticipant {
  userId: string;
  name: string;
  avatar?: string;
  score: number;
}

export interface RoomCalculatorState {
  roomId: string;
  canonicalRoomId: string;
  theme: string;
  durationMins: number;
  startedAt: number;
  endsAt: number;
  status: 'active' | 'ended';
  startedBy: {
    userId: string;
    name: string;
    avatar?: string;
  };
  totalScore: number;
  totalPeople: number;
  topSupporter: CalculatorParticipant | null;
  topCharming: CalculatorParticipant | null;
  supporterMap: Record<string, CalculatorParticipant>;
  charmingMap: Record<string, CalculatorParticipant>;
}

// In-memory registry for active room calculators and timers
const activeCalculators = new Map<string, RoomCalculatorState>();
const calculatorTimers = new Map<string, NodeJS.Timeout>();

function normalizeId(raw: string): string {
  return String(raw || '').trim();
}

function getRoomChannels(roomId: string, canonicalId?: string): string[] {
  const norm = normalizeId(roomId);
  const canon = canonicalId ? normalizeId(canonicalId) : norm;
  const list = [`voice_room_channel:${norm}`];
  if (canon && canon !== norm) {
    list.push(`voice_room_channel:${canon}`);
  }
  return list;
}

function emitToRoom(io: any, roomId: string, canonicalId: string, event: string, payload: any) {
  if (!io) return;
  const channels = getRoomChannels(roomId, canonicalId);
  for (const ch of channels) {
    io.to(ch).emit(event, payload);
  }
}

function emitSystemChat(io: any, roomId: string, canonicalId: string, text: string) {
  if (!io) return;
  const msg = {
    id: `calc_sys_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    text,
    isSystem: true,
    user: {
      name: 'System',
      isOfficial: true,
    },
    createdAt: new Date().toISOString(),
  };
  emitToRoom(io, roomId, canonicalId, 'voice_room:chat_message', msg);
}

export class RoomCalculatorService {
  /**
   * Start a new calculator session in a voice room
   */
  public static async startCalculator(
    roomId: string,
    user: any,
    theme: string,
    durationMins: number,
    io?: any
  ): Promise<RoomCalculatorState> {
    const rawId = normalizeId(roomId);
    if (!rawId) throw new Error('Invalid Room ID');

    const cleanTheme = String(theme || '').trim();
    if (!cleanTheme || cleanTheme.length > 30) {
      throw new Error('Activity theme must be between 1 and 30 characters');
    }

    const mins = Math.max(1, Math.min(60, Number(durationMins) || 10));

    // Verify room
    const room = await Room.findOne({
      $or: [
        { channelName: rawId },
        { uniqueId: rawId },
        { customDisplayId: rawId },
        ...(Types.ObjectId.isValid(rawId) ? [{ _id: rawId }] : []),
      ],
    }).populate('ownerId', 'userId name image avatar').lean();

    if (!room) throw new Error('Room not found');

    const canonicalRoomId = room.channelName || rawId;

    // Check permissions
    const actorId = String(user?.id || user?._id || user?.userId || '');
    const ownerId = String(room.ownerId?._id || room.ownerId || '');
    const isDirectOwner = ownerId === actorId || String((room.ownerId as any)?.userId || '') === actorId;
    const isSystemAdmin = user?.role === 'admin' || user?.role === 'owner';
    const roomAdmins = Array.isArray((room as any).admins) ? (room as any).admins : [];
    const isRoomAdmin = roomAdmins.some((a: any) => String(a?._id || a) === actorId);

    if (!isDirectOwner && !isSystemAdmin && !isRoomAdmin) {
      throw new Error('Only the room host or authorized admin can start Calculator');
    }

    // Clear previous timer if running
    if (calculatorTimers.has(canonicalRoomId)) {
      clearTimeout(calculatorTimers.get(canonicalRoomId)!);
      calculatorTimers.delete(canonicalRoomId);
    }

    const now = Date.now();
    const endsAt = now + mins * 60 * 1000;

    const state: RoomCalculatorState = {
      roomId: rawId,
      canonicalRoomId,
      theme: cleanTheme,
      durationMins: mins,
      startedAt: now,
      endsAt,
      status: 'active',
      startedBy: {
        userId: actorId,
        name: user?.name || 'Host',
        avatar: user?.avatar || user?.image || '',
      },
      totalScore: 0,
      totalPeople: 0,
      topSupporter: null,
      topCharming: null,
      supporterMap: {},
      charmingMap: {},
    };

    activeCalculators.set(canonicalRoomId, state);
    if (rawId !== canonicalRoomId) {
      activeCalculators.set(rawId, state);
    }

    // Schedule auto end
    const timer = setTimeout(() => {
      RoomCalculatorService.endCalculator(canonicalRoomId, null, io).catch((err) => {
        console.error('[RoomCalculator] Auto-end error:', err);
      });
    }, mins * 60 * 1000);

    calculatorTimers.set(canonicalRoomId, timer);

    // Save state to Redis for durability if available
    try {
      await redis.setex(`room_calc:${canonicalRoomId}`, (mins + 5) * 60, JSON.stringify(state));
    } catch (e) {
      // Redis optional
    }

    // Broadcast started event
    emitToRoom(io, rawId, canonicalRoomId, 'room:calculator:started', state);

    // Room chat announcement
    emitSystemChat(
      io,
      rawId,
      canonicalRoomId,
      `Calculator opened by ${state.startedBy.name}. ⭐777`
    );

    return state;
  }

  /**
   * Get active or cached calculator state for room
   */
  public static async getCalculator(roomId: string): Promise<RoomCalculatorState | null> {
    const rawId = normalizeId(roomId);
    if (activeCalculators.has(rawId)) {
      return activeCalculators.get(rawId)!;
    }

    try {
      const cached = await redis.get(`room_calc:${rawId}`);
      if (cached) {
        const parsed = JSON.parse(cached) as RoomCalculatorState;
        activeCalculators.set(rawId, parsed);
        return parsed;
      }
    } catch {}

    return null;
  }

  /**
   * Record gift sending event to update calculator stats
   */
  public static async recordGift(
    roomId: string,
    sender: any,
    receivers: any[],
    giftDiamonds: number,
    io?: any
  ): Promise<void> {
    const rawId = normalizeId(roomId);
    let state = activeCalculators.get(rawId);

    if (!state) {
      try {
        const cached = await redis.get(`room_calc:${rawId}`);
        if (cached) {
          state = JSON.parse(cached) as RoomCalculatorState;
          activeCalculators.set(rawId, state);
        }
      } catch {}
    }

    if (!state || state.status !== 'active') return;

    if (Date.now() >= state.endsAt) {
      await RoomCalculatorService.endCalculator(state.canonicalRoomId, null, io);
      return;
    }

    const diamonds = Math.max(1, Number(giftDiamonds) || 1);
    state.totalScore += diamonds;

    // Update sender (Supporter)
    const senderId = String(sender?.userId || sender?.id || sender?._id || 'unknown');
    const senderName = sender?.name || 'Supporter';
    const senderAvatar = sender?.avatar || sender?.image || '';

    if (!state.supporterMap[senderId]) {
      state.supporterMap[senderId] = {
        userId: senderId,
        name: senderName,
        avatar: senderAvatar,
        score: 0,
      };
    }
    state.supporterMap[senderId].score += diamonds;
    if (senderAvatar) state.supporterMap[senderId].avatar = senderAvatar;
    if (senderName) state.supporterMap[senderId].name = senderName;

    // Update receivers (Charming)
    const perReceiver = Math.max(1, Math.round(diamonds / (receivers.length || 1)));
    for (const rec of receivers) {
      const recId = String(rec?.userId || rec?.id || rec?._id || 'unknown');
      const recName = rec?.name || 'Charming';
      const recAvatar = rec?.avatar || rec?.image || '';

      if (!state.charmingMap[recId]) {
        state.charmingMap[recId] = {
          userId: recId,
          name: recName,
          avatar: recAvatar,
          score: 0,
        };
      }
      state.charmingMap[recId].score += perReceiver;
      if (recAvatar) state.charmingMap[recId].avatar = recAvatar;
      if (recName) state.charmingMap[recId].name = recName;
    }

    // Determine Top Supporter
    let topSup: CalculatorParticipant | null = null;
    for (const s of Object.values(state.supporterMap)) {
      if (!topSup || s.score > topSup.score) {
        topSup = s;
      }
    }
    state.topSupporter = topSup;

    // Determine Top Charming
    let topCharm: CalculatorParticipant | null = null;
    for (const c of Object.values(state.charmingMap)) {
      if (!topCharm || c.score > topCharm.score) {
        topCharm = c;
      }
    }
    state.topCharming = topCharm;

    // Total unique people
    const uniquePeople = new Set([
      ...Object.keys(state.supporterMap),
      ...Object.keys(state.charmingMap),
    ]);
    state.totalPeople = uniquePeople.size;

    // Persist
    try {
      await redis.setex(`room_calc:${state.canonicalRoomId}`, 3600, JSON.stringify(state));
    } catch {}

    // Broadcast updated event
    emitToRoom(io, state.roomId, state.canonicalRoomId, 'room:calculator:updated', state);
  }

  /**
   * End calculator session (manual or timer expired)
   */
  public static async endCalculator(
    roomId: string,
    user?: any,
    io?: any
  ): Promise<RoomCalculatorState | null> {
    const rawId = normalizeId(roomId);
    let state = activeCalculators.get(rawId);

    if (!state) {
      try {
        const cached = await redis.get(`room_calc:${rawId}`);
        if (cached) {
          state = JSON.parse(cached) as RoomCalculatorState;
        }
      } catch {}
    }

    if (!state) return null;

    if (state.status === 'ended') return state;

    // Clear auto-timer
    if (calculatorTimers.has(state.canonicalRoomId)) {
      clearTimeout(calculatorTimers.get(state.canonicalRoomId)!);
      calculatorTimers.delete(state.canonicalRoomId);
    }

    state.status = 'ended';

    // Persist ended state for 15 minutes so users can view results
    try {
      await redis.setex(`room_calc:${state.canonicalRoomId}`, 900, JSON.stringify(state));
    } catch {}

    // Broadcast ended event
    emitToRoom(io, state.roomId, state.canonicalRoomId, 'room:calculator:ended', state);

    // Chat announcement
    const supName = state.topSupporter?.name || 'None';
    const charmName = state.topCharming?.name || 'None';
    emitSystemChat(
      io,
      state.roomId,
      state.canonicalRoomId,
      `Calculator closed. The top supporter is ${supName}. The top charming is ${charmName}.`
    );

    return state;
  }
}
