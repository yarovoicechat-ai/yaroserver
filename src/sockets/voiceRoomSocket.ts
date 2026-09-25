import { Server } from "socket.io";
import { AuthenticatedSocket } from "../middlewares/auth.socket";
import redis from "../configs/redisConfig";

export interface VoiceRoomSeat {
  seatIndex: number;
  isHost: boolean;
  user: {
    userId: string;
    name: string;
    avatar: string;
    gender?: string;
    level?: number;
  } | null;
  isMuted: boolean;
  isLocked: boolean;
}

export interface VoiceRoomState {
  roomId: string;
  title: string;
  hostUser: any;
  seatCount: number;
  seats: VoiceRoomSeat[];
  onlineUsers: Record<string, { userId: string; name: string; avatar: string; socketId: string }>;
  updatedAt: number;
}

const buildInitialSeats = (count: number, hostUser: any = null): VoiceRoomSeat[] => {
  const seats: VoiceRoomSeat[] = [];
  seats.push({
    seatIndex: 0,
    isHost: true,
    user: hostUser || null,
    isMuted: false,
    isLocked: false,
  });

  for (let i = 1; i < count; i++) {
    seats.push({
      seatIndex: i,
      isHost: false,
      user: null,
      isMuted: true,
      isLocked: false,
    });
  }
  return seats;
};

// Normalize shorthand IDs (e.g. 10000004 -> 1000000004)
const normalizeRoomId = (id: string): string => {
  const clean = String(id || '').trim();
  if (/^10000\d{3}$/.test(clean)) {
    const lastDigits = clean.slice(5);
    return `100000000${lastDigits}`.slice(-10);
  }
  return clean;
};

const getRoomKey = (roomId: string) => `voice_room:${normalizeRoomId(roomId)}`;

export const getVoiceRoomState = async (roomId: string, defaultSeatsCount = 8, hostUser: any = null): Promise<VoiceRoomState> => {
  const canonicalId = normalizeRoomId(roomId);
  try {
    const raw = await redis.get(getRoomKey(canonicalId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.seats)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn(`[VoiceRoom] Redis get error for ${canonicalId}:`, err);
  }

  const initial: VoiceRoomState = {
    roomId: canonicalId,
    title: `Voice Room #${canonicalId}`,
    hostUser: hostUser || null,
    seatCount: defaultSeatsCount,
    seats: buildInitialSeats(defaultSeatsCount, hostUser),
    onlineUsers: {},
    updatedAt: Date.now(),
  };

  try {
    await redis.set(getRoomKey(canonicalId), JSON.stringify(initial), "EX", 86400);
  } catch (err) {
    console.warn(`[VoiceRoom] Redis set error for ${canonicalId}:`, err);
  }

  return initial;
};

export const saveVoiceRoomState = async (state: VoiceRoomState): Promise<void> => {
  state.updatedAt = Date.now();
  const canonicalId = normalizeRoomId(state.roomId);
  try {
    await redis.set(getRoomKey(canonicalId), JSON.stringify(state), "EX", 86400);
  } catch (err) {
    console.warn(`[VoiceRoom] Redis save error for ${canonicalId}:`, err);
  }
};

export const registerVoiceRoomHandlers = (io: Server, socket: AuthenticatedSocket) => {
  const user = socket.user;

  // 1. Join Room
  socket.on("voice_room:join", async (data: { roomId: string; user?: any; isHost?: boolean; customSeats?: number; roomTitle?: string }) => {
    try {
      const rawRoomId = String(data?.roomId || "").trim();
      if (!rawRoomId) return;
      const roomId = normalizeRoomId(rawRoomId);

      const userData = {
        userId: String(data?.user?.userId || data?.user?.id || user?.userId || user?.id || "guest"),
        name: String(data?.user?.name || user?.name || "Guest"),
        avatar: String(data?.user?.avatar || data?.user?.image || "https://api.yaroapp.in/uploads/avatars/female_default.webp"),
        gender: data?.user?.gender || "male",
        level: data?.user?.level || 1,
      };

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      await socket.join(socketRoomChannel);
      if (rawRoomId !== roomId) {
        await socket.join(`voice_room_channel:${rawRoomId}`);
      }

      (socket as any).voiceRoomId = roomId;
      (socket as any).voiceRawRoomId = rawRoomId;
      (socket as any).voiceUser = userData;

      const state = await getVoiceRoomState(roomId, data.customSeats || 8, data.isHost ? userData : null);

      if (data.roomTitle) state.title = data.roomTitle;
      if (data.isHost && (!state.seats[0].user || state.seats[0].user.userId === userData.userId)) {
        state.seats[0].user = userData;
        state.hostUser = userData;
      }

      if (!state.onlineUsers) state.onlineUsers = {};
      state.onlineUsers[userData.userId] = {
        ...userData,
        socketId: socket.id,
      };

      await saveVoiceRoomState(state);

      // Send initial state to the joiner
      socket.emit("voice_room:state", {
        success: true,
        roomId: state.roomId,
        title: state.title,
        seats: state.seats,
        onlineCount: Object.keys(state.onlineUsers).length,
        onlineUsers: Object.values(state.onlineUsers),
        hostUser: state.hostUser,
      });

      // Broadcast user join to all sockets in the channel
      io.to(socketRoomChannel).emit("voice_room:user_joined", {
        user: userData,
        onlineCount: Object.keys(state.onlineUsers).length,
      });
      if (rawRoomId !== roomId) {
        io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:user_joined", {
          user: userData,
          onlineCount: Object.keys(state.onlineUsers).length,
        });
      }

      io.to(socketRoomChannel).emit("voice_room:chat_message", {
        id: "sys-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4),
        type: "system",
        text: `📢 ${userData.name} joined the party!`,
        timestamp: Date.now(),
      });

      console.log(`[VoiceRoom] User ${userData.name} (${userData.userId}) joined room ${roomId}`);
    } catch (err: any) {
      console.error("[VoiceRoom] Join error:", err);
      socket.emit("voice_room:error", { message: err?.message || "Failed to join room" });
    }
  });

  // 2. Take Seat
  socket.on("voice_room:take_seat", async (data: { roomId: string; seatIndex: number; user?: any }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      const seatIndex = Number(data?.seatIndex);
      if (!rawRoomId || isNaN(seatIndex) || seatIndex < 0) return;
      const roomId = normalizeRoomId(rawRoomId);

      const userData = {
        userId: String(data?.user?.userId || data?.user?.id || user?.userId || user?.id || "guest"),
        name: String(data?.user?.name || user?.name || "Guest"),
        avatar: String(data?.user?.avatar || data?.user?.image || "https://api.yaroapp.in/uploads/avatars/female_default.webp"),
        gender: data?.user?.gender || "male",
        level: data?.user?.level || 1,
      };

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      await socket.join(socketRoomChannel);

      const state = await getVoiceRoomState(roomId);

      if (seatIndex >= state.seats.length) {
        socket.emit("voice_room:error", { message: "Invalid seat number" });
        return;
      }

      const targetSeat = state.seats[seatIndex];
      if (targetSeat.isLocked) {
        socket.emit("voice_room:error", { message: "This seat is locked by host" });
        return;
      }

      if (targetSeat.user && String(targetSeat.user.userId) !== String(userData.userId)) {
        socket.emit("voice_room:error", { message: "Seat already taken" });
        return;
      }

      // Vacate from any other seat in this room
      state.seats = state.seats.map((s) => {
        if (s.user && String(s.user.userId) === String(userData.userId)) {
          return { ...s, user: null, isMuted: true };
        }
        return s;
      });

      // Place user on requested seat
      state.seats[seatIndex] = {
        ...state.seats[seatIndex],
        user: userData,
        isMuted: seatIndex === 0 ? false : true,
        isLocked: false,
      };

      await saveVoiceRoomState(state);

      const updatePayload = {
        seatIndex,
        user: userData,
        seats: state.seats,
      };

      io.to(socketRoomChannel).emit("voice_room:seat_updated", updatePayload);
      if (rawRoomId !== roomId) {
        io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:seat_updated", updatePayload);
      }

      io.to(socketRoomChannel).emit("voice_room:chat_message", {
        id: "sys-" + Date.now(),
        type: "system",
        text: `💺 ${userData.name} took seat #${seatIndex + 1}`,
        timestamp: Date.now(),
      });

      console.log(`[VoiceRoom] ${userData.name} took seat #${seatIndex + 1} in room ${roomId}`);
    } catch (err: any) {
      console.error("[VoiceRoom] Take seat error:", err);
    }
  });

  // 3. Leave Seat
  socket.on("voice_room:leave_seat", async (data: { roomId: string; seatIndex?: number; user?: any }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId) return;
      const roomId = normalizeRoomId(rawRoomId);

      const targetUserId = String(data?.user?.userId || data?.user?.id || user?.userId || user?.id || "");
      const socketRoomChannel = `voice_room_channel:${roomId}`;
      const state = await getVoiceRoomState(roomId);

      let vacatedIndex = -1;
      let userName = "A user";

      state.seats = state.seats.map((s) => {
        if (
          (data.seatIndex !== undefined && s.seatIndex === Number(data.seatIndex)) ||
          (targetUserId && s.user && String(s.user.userId) === String(targetUserId))
        ) {
          vacatedIndex = s.seatIndex;
          if (s.user?.name) userName = s.user.name;
          return { ...s, user: null, isMuted: true };
        }
        return s;
      });

      if (vacatedIndex >= 0) {
        await saveVoiceRoomState(state);

        const leaveSeatPayload = {
          seatIndex: vacatedIndex,
          user: null,
          seats: state.seats,
        };

        io.to(socketRoomChannel).emit("voice_room:seat_updated", leaveSeatPayload);
        if (rawRoomId !== roomId) {
          io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:seat_updated", leaveSeatPayload);
        }

        io.to(socketRoomChannel).emit("voice_room:chat_message", {
          id: "sys-" + Date.now(),
          type: "system",
          text: `🚶 ${userName} vacated seat #${vacatedIndex + 1}`,
          timestamp: Date.now(),
        });
      }
    } catch (err: any) {
      console.error("[VoiceRoom] Leave seat error:", err);
    }
  });

  // 4. Mute / Unmute Seat
  socket.on("voice_room:mute_seat", async (data: { roomId: string; seatIndex: number; isMuted: boolean }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      const seatIndex = Number(data?.seatIndex);
      if (!rawRoomId || isNaN(seatIndex)) return;
      const roomId = normalizeRoomId(rawRoomId);

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      const state = await getVoiceRoomState(roomId);

      if (state.seats[seatIndex]) {
        state.seats[seatIndex].isMuted = Boolean(data.isMuted);
        await saveVoiceRoomState(state);

        const mutePayload = {
          seatIndex,
          isMuted: Boolean(data.isMuted),
          seats: state.seats,
        };

        io.to(socketRoomChannel).emit("voice_room:seat_muted", mutePayload);
        if (rawRoomId !== roomId) {
          io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:seat_muted", mutePayload);
        }
      }
    } catch (err: any) {
      console.error("[VoiceRoom] Mute seat error:", err);
    }
  });

  // 5. Lock / Unlock Seat
  socket.on("voice_room:lock_seat", async (data: { roomId: string; seatIndex: number; isLocked: boolean }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      const seatIndex = Number(data?.seatIndex);
      if (!rawRoomId || isNaN(seatIndex) || seatIndex === 0) return;
      const roomId = normalizeRoomId(rawRoomId);

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      const state = await getVoiceRoomState(roomId);

      if (state.seats[seatIndex]) {
        const isLocked = Boolean(data.isLocked);
        state.seats[seatIndex].isLocked = isLocked;
        if (isLocked) {
          state.seats[seatIndex].user = null;
        }
        await saveVoiceRoomState(state);

        const lockPayload = {
          seatIndex,
          isLocked,
          seats: state.seats,
        };

        io.to(socketRoomChannel).emit("voice_room:seat_locked", lockPayload);
        if (rawRoomId !== roomId) {
          io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:seat_locked", lockPayload);
        }
      }
    } catch (err: any) {
      console.error("[VoiceRoom] Lock seat error:", err);
    }
  });

  // 6. Send Chat Message
  socket.on("voice_room:send_chat", async (data: { roomId: string; message: any }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId || !data?.message) return;
      const roomId = normalizeRoomId(rawRoomId);

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      const msg = {
        ...data.message,
        id: data.message.id || ("msg-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4)),
        timestamp: Date.now(),
      };

      io.to(socketRoomChannel).emit("voice_room:chat_message", msg);
      if (rawRoomId !== roomId) {
        io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:chat_message", msg);
      }
    } catch (err: any) {
      console.error("[VoiceRoom] Chat message error:", err);
    }
  });

  // 7. Send Gift
  socket.on("voice_room:send_gift", async (data: { roomId: string; gift: any }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId || !data?.gift) return;
      const roomId = normalizeRoomId(rawRoomId);

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      io.to(socketRoomChannel).emit("voice_room:gift_received", data.gift);

      const giftMsg = {
        id: "gift-" + Date.now(),
        type: "gift",
        user: data.gift.senderName || user?.name || "Someone",
        gift: data.gift.giftName || "Gift",
        to: data.gift.receiverName || "Host",
        timestamp: Date.now(),
      };
      io.to(socketRoomChannel).emit("voice_room:chat_message", giftMsg);
      if (rawRoomId !== roomId) {
        io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:gift_received", data.gift);
        io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:chat_message", giftMsg);
      }
    } catch (err: any) {
      console.error("[VoiceRoom] Gift error:", err);
    }
  });

  // 8. Send Reaction
  socket.on("voice_room:reaction", async (data: { roomId: string; emoji: string; user?: string }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId || !data?.emoji) return;
      const roomId = normalizeRoomId(rawRoomId);

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      const payload = {
        id: "react-" + Date.now() + Math.random(),
        emoji: data.emoji,
        user: data.user || user?.name,
      };

      io.to(socketRoomChannel).emit("voice_room:reaction_received", payload);
      if (rawRoomId !== roomId) {
        io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:reaction_received", payload);
      }
    } catch (err: any) {
      console.error("[VoiceRoom] Reaction error:", err);
    }
  });

  // 9. Leave Room
  const handleUserLeave = async (isExplicitLeave: boolean = true) => {
    const rawRoomId = (socket as any).voiceRawRoomId || (socket as any).voiceRoomId;
    const userData = (socket as any).voiceUser;
    if (!rawRoomId || !userData) return;
    const roomId = normalizeRoomId(rawRoomId);

    try {
      const socketRoomChannel = `voice_room_channel:${roomId}`;
      socket.leave(socketRoomChannel);

      delete (socket as any).voiceRoomId;
      delete (socket as any).voiceRawRoomId;
      delete (socket as any).voiceUser;

      const state = await getVoiceRoomState(roomId);
      if (state.onlineUsers) {
        delete state.onlineUsers[userData.userId];
      }

      let freedIndex = -1;
      // Only clear seat if the user explicitly clicked "Leave Room"
      if (isExplicitLeave) {
        state.seats = state.seats.map((s) => {
          if (s.seatIndex > 0 && s.user && String(s.user.userId) === String(userData.userId)) {
            freedIndex = s.seatIndex;
            return { ...s, user: null, isMuted: true };
          }
          return s;
        });
      }

      await saveVoiceRoomState(state);

      const userLeftPayload = {
        user: userData,
        onlineCount: Object.keys(state.onlineUsers || {}).length,
        freedSeatIndex: freedIndex,
        seats: state.seats,
      };

      io.to(socketRoomChannel).emit("voice_room:user_left", userLeftPayload);
      if (rawRoomId !== roomId) {
        io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:user_left", userLeftPayload);
      }

      if (isExplicitLeave) {
        io.to(socketRoomChannel).emit("voice_room:chat_message", {
          id: "sys-" + Date.now(),
          type: "system",
          text: `👋 ${userData.name} left the room.`,
          timestamp: Date.now(),
        });
      }

      console.log(`[VoiceRoom] User ${userData.name} (${userData.userId}) left room ${roomId} (explicit: ${isExplicitLeave})`);
    } catch (err: any) {
      console.error("[VoiceRoom] Leave cleanup error:", err);
    }
  };

  socket.on("voice_room:leave", () => handleUserLeave(true));
  socket.on("disconnect", () => handleUserLeave(false));
};
