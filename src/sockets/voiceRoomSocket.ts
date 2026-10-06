import { Types } from "mongoose";
import { Server } from "socket.io";
import { AuthenticatedSocket } from "../middlewares/auth.socket";
import redis from "../configs/redisConfig";
import { GiftService } from "../gift/gift.service";
import { EntryEffectService } from "../services/entryEffect.service";
import { Room } from "../models/room.model";
import { User } from "../models/user.model";
import { StoreItem } from "../models/storeItem.model";

export interface VoiceRoomSeat {
  seatIndex: number;
  isHost: boolean;
  user: {
    userId: string;
    name: string;
    avatar: string;
    gender?: string;
    level?: number;
    equippedFrame?: any;
    equippedFrameAsset?: any;
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
  themeId?: string | null;
  themeAsset?: any;
  seatSkinId?: string | null;
  seatSkinAsset?: any;
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

const normalizeItemCategory = (value: string = "") => {
  const category = value.toLowerCase().trim();
  if (["theme", "themes"].includes(category)) return "Theme";
  if (["seat skin", "seat skins"].includes(category)) return "Seat Skin";
  return value;
};

const canonicalRoomAsset = (item: any, expiresAt?: Date | null) => {
  const metadata = item?.metadata || {};
  return {
    id: String(item?._id || item?.id || ""),
    itemId: String(item?._id || item?.id || ""),
    name: item?.name || "",
    category: item?.category || "",
    imageUrl: item?.imageUrl || "",
    coverImage: item?.imageUrl || metadata.coverImage || "",
    animationUrl: item?.animationUrl || "",
    previewColor: item?.previewColor || metadata.previewColor || "",
    bgColors: item?.bgColors || metadata.bgColors || [],
    icon: item?.icon || metadata.icon || "",
    borderColor: metadata.borderColor || "",
    bgColor: metadata.bgColor || "",
    seatSkinType: metadata.seatSkinType || "",
    metadata,
    expiresAt: expiresAt || null,
  };
};

const getCanonicalRoomUser = async (socketUser: any, fallback: any = {}) => {
  const targetId = socketUser?.id || socketUser?._id;
  const targetUserId = socketUser?.userId || fallback?.userId;
  const query =
    targetId && Types.ObjectId.isValid(String(targetId))
      ? { _id: targetId }
      : targetUserId && !isNaN(Number(targetUserId))
        ? { userId: Number(targetUserId) }
        : null;

  const dbUser: any = query
    ? await User.findOne(query)
        .select(
          "userId name image avatar gender level equippedFrame equippedFrameAsset equippedEntry equippedEntryAsset equippedEntryEffect equippedEntryTag equippedEntrance equippedEntranceAsset equippedTassel equippedTasselAsset equippedBadge equippedBadges equippedChatBubble equippedChatBubbleAsset equippedVipId equippedSvipId",
        )
        .lean()
    : null;
  const source: any = dbUser || socketUser || {};
  const id = String(source?._id || source?.id || "");
  const avatar =
    source?.image ||
    source?.avatar ||
    fallback?.image ||
    fallback?.avatar ||
    "https://api.yaroapp.in/uploads/avatars/female_default.webp";
  return {
    id,
    _id: id,
    userId: String(source?.userId || fallback?.userId || "guest"),
    numericUserId: Number(source?.userId || fallback?.userId || 0),
    name: String(source?.name || fallback?.name || "Guest"),
    avatar: String(avatar),
    image: String(avatar),
    gender: source?.gender || fallback?.gender || "male",
    level: source?.level || 1,
    equippedFrame: source?.equippedFrameAsset || source?.equippedFrame || null,
    equippedFrameAsset: source?.equippedFrameAsset || null,
    equippedEntry: source?.equippedEntryAsset || source?.equippedEntry || null,
    equippedEntryAsset: source?.equippedEntryAsset || null,
    equippedEntryEffect: source?.equippedEntryEffect || null,
    equippedEntryTag: source?.equippedEntryTag || null,
    equippedEntrance: source?.equippedEntranceAsset || source?.equippedEntrance || null,
    equippedEntranceAsset: source?.equippedEntranceAsset || null,
    equippedTassel: source?.equippedTasselAsset || source?.equippedTassel || null,
    equippedTasselAsset: source?.equippedTasselAsset || null,
    equippedBadge: source?.equippedBadge || null,
    equippedBadges: source?.equippedBadges || [],
    equippedChatBubble: source?.equippedChatBubble || null,
    equippedChatBubbleAsset: source?.equippedChatBubbleAsset || null,
    equippedVipId: source?.equippedVipId || null,
    equippedSvipId: source?.equippedSvipId || null,
  };
};

export const getVoiceRoomState = async (roomId: string, defaultSeatsCount = 8, hostUser: any = null): Promise<VoiceRoomState> => {
  const canonicalId = normalizeRoomId(roomId);
  try {
    const raw = await redis.get(getRoomKey(canonicalId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.seats)) {
        while (parsed.seats.length < 15) {
          parsed.seats.push({
            seatIndex: parsed.seats.length,
            isHost: false,
            user: null,
            isMuted: true,
            isLocked: false,
          });
        }
        return parsed;
      }
    }
  } catch (err) {
    console.warn(`[VoiceRoom] Redis get error for ${canonicalId}:`, err);
  }

  let persistedRoom: any = null;
  try {
    persistedRoom = await Room.findOne({
      $or: [{ channelName: canonicalId }, { channelName: String(roomId) }],
    })
      .select("title channelName themeId themeAsset seatSkinId seatSkinAsset")
      .lean();
  } catch (err) {
    console.warn(`[VoiceRoom] Mongo room read warning for ${canonicalId}:`, err);
  }

  const initial: VoiceRoomState = {
    roomId: canonicalId,
    title: persistedRoom?.title || `Voice Room #${canonicalId}`,
    hostUser: hostUser || null,
    seatCount: defaultSeatsCount,
    seats: buildInitialSeats(defaultSeatsCount, hostUser),
    onlineUsers: {},
    themeId: persistedRoom?.themeId || null,
    themeAsset: persistedRoom?.themeAsset || null,
    seatSkinId: persistedRoom?.seatSkinId || null,
    seatSkinAsset: persistedRoom?.seatSkinAsset || null,
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
      const roomDocument: any = await Room.findOne({
        $or: [{ channelName: roomId }, { channelName: rawRoomId }],
      })
        .select("ownerId")
        .lean();
      const authorizedHost = Boolean(
        roomDocument?.ownerId &&
          String(roomDocument.ownerId) === String((user as any)?.id),
      );
      const userData = await getCanonicalRoomUser(user, data?.user);

      // 24-hour ban check
      try {
        const isBanned24h = await redis.get(`voice_room_ban24h:${roomId}:${userData.userId}`);
        if (isBanned24h) {
          socket.emit("voice_room:error", {
            message: "Aap is room se 24 ghante ke liye banned hain. (You are banned from this room for 24 hours)",
            code: "BANNED_24H"
          });
          socket.emit("voice_room:force_leave", {
            reason: "Banned from room for 24 hours"
          });
          return;
        }
      } catch (banErr) {
        console.warn("[VoiceRoom] Ban check error:", banErr);
      }

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      await socket.join(socketRoomChannel);
      await socket.join(`room:${roomId}`);
      if (rawRoomId !== roomId) {
        await socket.join(`voice_room_channel:${rawRoomId}`);
        await socket.join(`room:${rawRoomId}`);
      }

      (socket as any).voiceRoomId = roomId;
      (socket as any).voiceRawRoomId = rawRoomId;
      (socket as any).voiceUser = userData;

      const state = await getVoiceRoomState(roomId, data.customSeats || 8, authorizedHost ? userData : null);

      if (data.roomTitle) state.title = data.roomTitle;
      if (authorizedHost) {
        state.hostUser = userData;
      }

      if (!state.onlineUsers) state.onlineUsers = {};
      const wasOnline = Boolean(state.onlineUsers[userData.userId]);
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
        themeId: state.themeId || null,
        themeAsset: state.themeAsset || null,
        seatSkinId: state.seatSkinId || null,
        seatSkinAsset: state.seatSkinAsset || null,
      });

      // Broadcast user join to all sockets in the channel
      if (!wasOnline) {
        io.to(socketRoomChannel).emit("voice_room:user_joined", {
          eventId: `join:${roomId}:${userData.userId}:${Date.now()}`,
          user: userData,
          onlineCount: Object.keys(state.onlineUsers).length,
          announcementSent: true,
        });

        // Broadcast Entry Effect to the voice room
        EntryEffectService.broadcastEntry(roomId, userData).catch((err: any) => {
          console.warn("[VoiceRoom] Entry effect broadcast warning:", err?.message);
        });
      }

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

      const userData =
        (socket as any).voiceUser ||
        (await getCanonicalRoomUser(user, data?.user));

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      await socket.join(socketRoomChannel);

      const state = await getVoiceRoomState(roomId);

      if (seatIndex >= state.seats.length) {
        socket.emit("voice_room:error", { message: "Invalid seat number" });
        return;
      }
      if (seatIndex === 0 && normalizeRoomId(String(user?.userId || '')) !== roomId) {
        socket.emit("voice_room:error", { message: "Only the room host can use the host seat" });
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

      const targetUserId = String(user?.userId || "");
      const socketRoomChannel = `voice_room_channel:${roomId}`;
      const state = await getVoiceRoomState(roomId);

      let vacatedIndex = -1;
      let userName = "A user";

      state.seats = state.seats.map((s) => {
        if (
          targetUserId && s.user && String(s.user.userId) === targetUserId
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
        senderId: data.message.senderId || (socket as any).voiceUser?.userId || user?.userId || "user",
        chatBubble: (socket as any).voiceUser?.equippedChatBubbleAsset || (socket as any).voiceUser?.equippedChatBubble || (user as any)?.equippedChatBubbleAsset || (user as any)?.equippedChatBubble || data.message.chatBubble || null,
        chatBubbleId: (socket as any).voiceUser?.equippedChatBubble || (user as any)?.equippedChatBubble || data.message.chatBubbleId || null,
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

  // 7. Subscribe to Gifts in Voice Room
  socket.on("voice_room:subscribe_gifts", async (data: { roomId: string }) => {
    try {
      const rawRoomId = String(data?.roomId || "").trim();
      if (!rawRoomId) return;
      const roomId = normalizeRoomId(rawRoomId);
      await socket.join(`voice_room_channel:${roomId}`);
      await socket.join(`room:${roomId}`);
      if (rawRoomId !== roomId) {
        await socket.join(`voice_room_channel:${rawRoomId}`);
        await socket.join(`room:${rawRoomId}`);
      }
    } catch (_) {}
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

  // 9. Leave Room (Clean seat release for Owner, Admin, or User)
  const handleUserLeave = async (isExplicitLeave: boolean = true, incomingData?: { roomId?: string; user?: any }) => {
    const rawRoomId = String(incomingData?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
    const leavingUser = incomingData?.user || (socket as any).voiceUser || user;
    if (!rawRoomId) return;
    const roomId = normalizeRoomId(rawRoomId);

    const targetUserId = String(leavingUser?.userId || leavingUser?._id || leavingUser?.id || (socket as any).voiceUser?.userId || user?.userId || "");
    const targetName = String(leavingUser?.name || (socket as any).voiceUser?.name || user?.name || "User");

    try {
      const socketRoomChannel = `voice_room_channel:${roomId}`;
      socket.leave(socketRoomChannel);
      socket.leave(`room:${roomId}`);
      if (rawRoomId !== roomId) {
        socket.leave(`voice_room_channel:${rawRoomId}`);
        socket.leave(`room:${rawRoomId}`);
      }

      delete (socket as any).voiceRoomId;
      delete (socket as any).voiceRawRoomId;
      delete (socket as any).voiceUser;

      const state = await getVoiceRoomState(roomId);

      // Remove from online users
      if (state.onlineUsers) {
        if (targetUserId && state.onlineUsers[targetUserId]) {
          delete state.onlineUsers[targetUserId];
        }
        // Also cleanup by socket ID
        Object.keys(state.onlineUsers).forEach((uid) => {
          if (state.onlineUsers[uid]?.socketId === socket.id || (targetUserId && String(uid) === targetUserId)) {
            delete state.onlineUsers[uid];
          }
        });
      }

      const isMatchingSeatUser = (seatUser: any): boolean => {
        if (!seatUser) return false;
        if (targetUserId) {
          if (seatUser.userId && String(seatUser.userId) === targetUserId) return true;
          if (seatUser._id && String(seatUser._id) === targetUserId) return true;
          if (seatUser.id && String(seatUser.id) === targetUserId) return true;
          if (normalizeRoomId(String(seatUser.userId)) === normalizeRoomId(targetUserId)) return true;
        }
        if (targetName && targetName !== "User" && targetName !== "Guest") {
          if (seatUser.name && String(seatUser.name).trim().toLowerCase() === targetName.trim().toLowerCase()) return true;
        }
        return false;
      };

      const isOwnerLeaving = Boolean(
        (targetUserId && normalizeRoomId(targetUserId) === roomId) ||
        (state.hostUser && isMatchingSeatUser(state.hostUser))
      );

      const vacatedIndices: number[] = [];
      state.seats = state.seats.map((s) => {
        if (isMatchingSeatUser(s.user) || (s.seatIndex === 0 && isOwnerLeaving)) {
          vacatedIndices.push(s.seatIndex);
          return { ...s, user: null, isMuted: true };
        }
        return s;
      });

      if (isOwnerLeaving) {
        state.hostUser = null;
      }

      await saveVoiceRoomState(state);

      // Broadcast vacated seats to everyone in the room
      vacatedIndices.forEach((freedIdx) => {
        const seatPayload = {
          seatIndex: freedIdx,
          user: null,
          seats: state.seats,
        };
        io.to(socketRoomChannel).emit("voice_room:seat_updated", seatPayload);
        if (rawRoomId !== roomId) {
          io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:seat_updated", seatPayload);
        }
      });

      const userLeftPayload = {
        user: { userId: targetUserId, name: targetName },
        onlineCount: Object.keys(state.onlineUsers || {}).length,
        announcementSent: isExplicitLeave,
        freedSeatIndex: vacatedIndices.length > 0 ? vacatedIndices[0] : -1,
        freedSeatIndices: vacatedIndices,
        seats: state.seats,
      };

      io.to(socketRoomChannel).emit("voice_room:user_left", userLeftPayload);
      if (rawRoomId !== roomId) {
        io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:user_left", userLeftPayload);
      }

      if (isExplicitLeave && targetName) {
        io.to(socketRoomChannel).emit("voice_room:chat_message", {
          id: "sys-" + Date.now(),
          type: "system",
          text: `👋 ${targetName} left the room.`,
          timestamp: Date.now(),
        });
      }

      console.log(`[VoiceRoom] ${targetName} (${targetUserId}) left room ${roomId} - seats vacated: ${vacatedIndices.join(",")}`);
    } catch (err: any) {
      console.error("[VoiceRoom] Leave cleanup error:", err);
    }
  };

  socket.on("voice_room:leave", (data?: any) => handleUserLeave(true, data));
  socket.on("disconnect", () => handleUserLeave(false));

  // 9.1 Moderation: Remove User from Seat to Audience (User stays in room & can re-join later)
  socket.on("voice_room:kick_from_seat", async (data: { roomId: string; targetUserId: string; targetName?: string }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      const targetUserId = String(data?.targetUserId || "").trim();
      if (!rawRoomId || !targetUserId) return;
      const roomId = normalizeRoomId(rawRoomId);

      const state = await getVoiceRoomState(roomId);
      let vacatedIdx = -1;
      state.seats = state.seats.map((s) => {
        if (s.user && (
          String(s.user.userId) === targetUserId ||
          String((s.user as any)._id) === targetUserId ||
          String((s.user as any).id) === targetUserId
        )) {
          vacatedIdx = s.seatIndex;
          return { ...s, user: null, isMuted: true };
        }
        return s;
      });

      if (vacatedIdx >= 0) {
        await saveVoiceRoomState(state);
        const socketRoomChannel = `voice_room_channel:${roomId}`;
        const seatPayload = {
          seatIndex: vacatedIdx,
          user: null,
          seats: state.seats,
        };
        io.to(socketRoomChannel).emit("voice_room:seat_updated", seatPayload);
        if (rawRoomId !== roomId) {
          io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:seat_updated", seatPayload);
        }

        io.to(socketRoomChannel).emit("voice_room:moved_to_audience", {
          roomId,
          targetUserId,
          seatIndex: vacatedIdx,
        });

        io.to(socketRoomChannel).emit("voice_room:chat_message", {
          id: "sys-" + Date.now(),
          type: "system",
          text: `💺 ${data?.targetName || "User"} was moved to audience by Host/Admin.`,
          timestamp: Date.now(),
        });
      }
    } catch (err: any) {
      console.error("[VoiceRoom] Remove from seat error:", err);
    }
  });

  // 9.2 Moderation: Kick User from Room with 24 Hours Ban
  socket.on("voice_room:kick_user", async (data: { roomId: string; targetUserId: string; targetName?: string; ban24h?: boolean }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      const targetUserId = String(data?.targetUserId || "").trim();
      if (!rawRoomId || !targetUserId) return;
      const roomId = normalizeRoomId(rawRoomId);

      // Save 24 Hours Ban in Redis (86400 seconds)
      await redis.set(`voice_room_ban24h:${roomId}:${targetUserId}`, Date.now() + 24 * 3600 * 1000, "EX", 86400);

      const state = await getVoiceRoomState(roomId);
      let vacatedIdx = -1;
      state.seats = state.seats.map((s) => {
        if (s.user && (
          String(s.user.userId) === targetUserId ||
          String((s.user as any)._id) === targetUserId ||
          String((s.user as any).id) === targetUserId
        )) {
          vacatedIdx = s.seatIndex;
          return { ...s, user: null, isMuted: true };
        }
        return s;
      });

      if (state.onlineUsers && state.onlineUsers[targetUserId]) {
        delete state.onlineUsers[targetUserId];
      }

      await saveVoiceRoomState(state);
      const socketRoomChannel = `voice_room_channel:${roomId}`;

      if (vacatedIdx >= 0) {
        const seatPayload = {
          seatIndex: vacatedIdx,
          user: null,
          seats: state.seats,
        };
        io.to(socketRoomChannel).emit("voice_room:seat_updated", seatPayload);
        if (rawRoomId !== roomId) {
          io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:seat_updated", seatPayload);
        }
      }

      // Notify room and target user that they are kicked with 24h ban
      io.to(socketRoomChannel).emit("voice_room:user_kicked", {
        roomId,
        targetUserId,
        targetName: data?.targetName || "User",
        ban24h: true,
        onlineCount: Object.keys(state.onlineUsers || {}).length,
        seats: state.seats,
      });

      io.to(socketRoomChannel).emit("voice_room:chat_message", {
        id: "sys-" + Date.now(),
        type: "system",
        text: `🚫 ${data?.targetName || "User"} was kicked out of the room by Admin (24 Hours Ban).`,
        timestamp: Date.now(),
      });

      console.log(`[VoiceRoom] User ${data?.targetName} (${targetUserId}) kicked from room ${roomId} with 24h ban`);
    } catch (err: any) {
      console.error("[VoiceRoom] Kick user 24h ban error:", err);
    }
  });

  // 10. Real-time Gift Send Handler
  socket.on("gift:send", async (data: any, callback?: (res: any) => void) => {
    try {
      const senderId = user?.id || (socket as any).userId;
      if (!senderId) {
        const errPayload = { requestId: data?.requestId, error: "Authentication required", code: "UNAUTHORIZED" };
        socket.emit("gift:failed", errPayload);
        if (typeof callback === "function") callback({ success: false, ...errPayload });
        return;
      }

      const result = await GiftService.sendGift(String(senderId), {
        ...data,
        roomId: data?.roomId || (socket as any).voiceRoomId,
      });

      socket.emit("gift:sent", result);
      if (typeof callback === "function") callback({ success: true, data: result });
    } catch (err: any) {
      const errPayload = {
        requestId: data?.requestId,
        error: err.message || "Failed to send gift",
        code: err.code || "GIFT_SEND_FAILED",
        availableDiamonds: err.availableDiamonds,
        requiredDiamonds: err.requiredDiamonds,
      };
      socket.emit("gift:failed", errPayload);
      if (typeof callback === "function") callback({ success: false, ...errPayload });
    }
  });

  // 11. Update Room Theme (Owner Only)
  socket.on("voice_room:update_theme", async (data: { roomId: string; themeId?: string; themeAsset?: any }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId) return;
      const roomId = normalizeRoomId(rawRoomId);
      const authUserId = String((user as any)?.id || "").trim();
      const roomDocument: any = await Room.findOne({
        $or: [{ channelName: roomId }, { channelName: rawRoomId }],
      });
      const isOwner = Boolean(
        roomDocument &&
          (String(roomDocument.ownerId) === authUserId ||
            (user as any)?.role === "superAdmin" ||
            (user as any)?.role === "admin"),
      );

      if (!isOwner) {
        socket.emit("voice_room:error", {
          message: "Only the room owner is authorized to change the room theme",
          code: "NOT_ROOM_OWNER",
        });
        return;
      }
      const requestedThemeId = String(data.themeId || "").trim();
      const state = await getVoiceRoomState(roomId);
      const socketRoomChannel = `voice_room_channel:${roomId}`;

      if (!requestedThemeId || ["default", "none"].includes(requestedThemeId.toLowerCase())) {
        state.themeId = null;
        state.themeAsset = null;
        await saveVoiceRoomState(state);
        roomDocument.themeId = null;
        roomDocument.themeAsset = null;
        await roomDocument.save();
        io.to(socketRoomChannel).emit("voice_room:theme_updated", {
          themeId: null,
          themeAsset: null,
          updatedBy: authUserId,
        });
        return;
      }

      const account: any = await User.findById(authUserId).select("storeInventory").lean();
      const now = Date.now();
      const owned = (account?.storeInventory || []).find(
        (entry: any) =>
          String(entry.itemId) === requestedThemeId &&
          (!entry.expiresAt || new Date(entry.expiresAt).getTime() > now),
      );
      const item: any = await StoreItem.findOne({
        _id: requestedThemeId,
        isActive: true,
      }).lean();
      if (!item || normalizeItemCategory(item.category) !== "Theme") {
        socket.emit("voice_room:error", {
          message: "Selected theme is unavailable",
          code: "THEME_UNAVAILABLE",
        });
        return;
      }

      const themeLocation = String(item.metadata?.themeLocation || "STORE")
        .trim()
        .toUpperCase()
        .replace(/[ -]+/g, "_");
      const isFreeRoomToolTheme =
        (item.metadata?.isFree === true || Number(item.price || 0) === 0) &&
        ["ROOM_TOOL", "BOTH"].includes(themeLocation);
      if (!owned && !isFreeRoomToolTheme) {
        socket.emit("voice_room:error", {
          message: "Selected theme is neither free in Room Tools nor present in your active inventory",
          code: "THEME_NOT_OWNED",
        });
        return;
      }

      state.themeId = String(item._id);
      state.themeAsset = canonicalRoomAsset(item, owned?.expiresAt || null);
      await saveVoiceRoomState(state);
      roomDocument.themeId = state.themeId;
      roomDocument.themeAsset = state.themeAsset;
      await roomDocument.save();

      const payload = {
        themeId: state.themeId,
        themeAsset: state.themeAsset,
        updatedBy: authUserId,
      };

      io.to(socketRoomChannel).emit("voice_room:theme_updated", payload);
      console.log(`[VoiceRoom] Room ${roomId} theme updated to ${state.themeId} by owner ${authUserId}`);
    } catch (err: any) {
      console.error("[VoiceRoom] Update theme error:", err);
      socket.emit("voice_room:error", { message: err?.message || "Failed to update theme" });
    }
  });

  // 12. Update Seat Skin (Owner Only)
  socket.on("voice_room:update_seat_skin", async (data: { roomId: string; seatSkinId?: string; seatSkinAsset?: any }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId) return;
      const roomId = normalizeRoomId(rawRoomId);
      const authUserId = String((user as any)?.id || "").trim();
      const roomDocument: any = await Room.findOne({
        $or: [{ channelName: roomId }, { channelName: rawRoomId }],
      });
      const isOwner = Boolean(
        roomDocument &&
          (String(roomDocument.ownerId) === authUserId ||
            (user as any)?.role === "superAdmin" ||
            (user as any)?.role === "admin"),
      );

      if (!isOwner) {
        socket.emit("voice_room:error", {
          message: "Only the room owner is authorized to change the seat skin",
          code: "NOT_ROOM_OWNER",
        });
        return;
      }
      const requestedSeatSkinId = String(data.seatSkinId || "").trim();
      const state = await getVoiceRoomState(roomId);
      const socketRoomChannel = `voice_room_channel:${roomId}`;

      if (!requestedSeatSkinId || ["default", "none"].includes(requestedSeatSkinId.toLowerCase())) {
        state.seatSkinId = null;
        state.seatSkinAsset = null;
        await saveVoiceRoomState(state);
        roomDocument.seatSkinId = null;
        roomDocument.seatSkinAsset = null;
        await roomDocument.save();
        io.to(socketRoomChannel).emit("voice_room:seat_skin_updated", {
          seatSkinId: null,
          seatSkinAsset: null,
          updatedBy: authUserId,
        });
        console.log(`[VoiceRoom] Room ${roomId} seat skin reset to default by owner ${authUserId}`);
        return;
      }

      const account: any = await User.findById(authUserId).select("storeInventory").lean();
      const now = Date.now();
      const owned = (account?.storeInventory || []).find(
        (entry: any) =>
          String(entry.itemId) === requestedSeatSkinId &&
          (!entry.expiresAt || new Date(entry.expiresAt).getTime() > now),
      );

      const isValidMongoId = /^[0-9a-fA-F]{24}$/.test(requestedSeatSkinId);
      const item: any = await StoreItem.findOne({
        $or: [
          ...(isValidMongoId ? [{ _id: requestedSeatSkinId }] : []),
          { name: requestedSeatSkinId },
          { "metadata.seatSkinType": requestedSeatSkinId },
        ],
        isActive: true,
      }).lean();

      const isPreset = [
        "preset_default",
        "default",
        "golden_throne",
        "cyber_pod",
        "lotus_throne",
        "phoenix_fire",
        "mermaid_pearl",
      ].includes(requestedSeatSkinId.toLowerCase());

      const isFreeRoomToolSeatSkin =
        item &&
        (item.metadata?.isFree === true ||
          Number(item.price || 0) === 0 ||
          ["ROOM_TOOL", "BOTH"].includes(
            String(item.metadata?.themeLocation || "").toUpperCase()
          ));

      if (!owned && !isPreset && !isFreeRoomToolSeatSkin) {
        socket.emit("voice_room:error", {
          message: "Selected seat skin is not in your active inventory",
          code: "SEAT_SKIN_NOT_OWNED",
        });
        return;
      }

      state.seatSkinId = item ? String(item._id) : requestedSeatSkinId;
      state.seatSkinAsset = item
        ? canonicalRoomAsset(item, owned?.expiresAt || null)
        : data.seatSkinAsset || { id: requestedSeatSkinId, name: requestedSeatSkinId };

      await saveVoiceRoomState(state);
      roomDocument.seatSkinId = state.seatSkinId;
      roomDocument.seatSkinAsset = state.seatSkinAsset;
      await roomDocument.save();

      const payload = {
        seatSkinId: state.seatSkinId,
        seatSkinAsset: state.seatSkinAsset,
        updatedBy: authUserId,
      };

      io.to(socketRoomChannel).emit("voice_room:seat_skin_updated", payload);
      console.log(`[VoiceRoom] Room ${roomId} seat skin updated to ${state.seatSkinId} by owner ${authUserId}`);
    } catch (err: any) {
      console.error("[VoiceRoom] Update seat skin error:", err);
      socket.emit("voice_room:error", { message: err?.message || "Failed to update seat skin" });
    }
  });
};
