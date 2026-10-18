import { Types } from "mongoose";
import { Server } from "socket.io";
import { AuthenticatedSocket } from "../middlewares/auth.socket";
import redis from "../configs/redisConfig";
import { GiftService } from "../gift/gift.service";
import { EntryEffectService } from "../services/entryEffect.service";
import { Room } from "../models/room.model";
import { User } from "../models/user.model";
import { StoreItem } from "../models/storeItem.model";
import { RoomTaskService } from "../services/roomTask.service";

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
  showSeatCharm?: boolean;
  coverImage?: string;
  about?: string;
  isLocked?: boolean;
  mode?: string;
  hasPin?: boolean;
  pendingLiveRequests?: Record<string, any>;
  admins?: string[];
  bannedChatUsers?: string[];
  mutedUsers?: string[];
  updatedAt: number;
}

// Allow a short reconnect window for temporary socket drops before releasing a seat.
// Key: `${roomId}:${userId}`
const disconnectGraceTimers = new Map<string, NodeJS.Timeout>();
const GRACE_PERIOD_MS = 45 * 1000;

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

const getSocketUserIds = (socket: AuthenticatedSocket): string[] => {
  const socketUser: any = socket.user || {};
  return [socketUser.userId, socketUser.id, socketUser._id]
    .filter(Boolean)
    .map((value) => String(value));
};

const isGlobalRoomManagerId = async (userId: string): Promise<boolean> => {
  const identifier = String(userId || '').trim();
  const alternatives: any[] = [];
  if (/^\d+$/.test(identifier) && Number.isSafeInteger(Number(identifier))) {
    alternatives.push({ userId: Number(identifier) });
  }
  if (Types.ObjectId.isValid(identifier)) alternatives.push({ _id: identifier });
  if (!alternatives.length) return false;
  return Boolean(await User.exists({ $or: alternatives, isGlobalRoomManager: true, isDeleted: false }));
};

const isGlobalRoomManagerSocket = async (socket: AuthenticatedSocket): Promise<boolean> => {
  const userId = String((socket.user as any)?.userId || '').trim();
  return isGlobalRoomManagerId(userId);
};

const isRoomOwnerSocket = async (
  socket: AuthenticatedSocket,
  roomId: string,
  rawRoomId: string,
): Promise<boolean> => {
  const socketUser: any = socket.user || {};
  if (socketUser.role === "superAdmin" || socketUser.role === "owner") return true;

  const ownerRoom: any = await Room.findOne({
    $or: [
      { channelName: normalizeRoomId(roomId) },
      { channelName: String(rawRoomId) },
    ],
  }).select("ownerId channelName").lean();

  const authUserDbId = String(socketUser.id || socketUser._id || "").trim();
  const authUserNumId = String(socketUser.userId || "").trim();
  return Boolean(
    (ownerRoom?.ownerId && (
      String(ownerRoom.ownerId) === authUserDbId ||
      (authUserNumId && String(ownerRoom.ownerId) === authUserNumId)
    )) ||
    (ownerRoom?.channelName && (
      normalizeRoomId(String(ownerRoom.channelName)) === normalizeRoomId(authUserNumId) ||
      String(ownerRoom.channelName) === authUserNumId
    )) ||
    (authUserNumId && (
      normalizeRoomId(roomId) === normalizeRoomId(authUserNumId) ||
      normalizeRoomId(rawRoomId) === normalizeRoomId(authUserNumId)
    ))
  );
};

const canModerateRoom = async (
  socket: AuthenticatedSocket,
  state: VoiceRoomState,
  roomId: string,
  rawRoomId: string,
): Promise<boolean> => {
  const socketUser: any = socket.user || {};
  if (socketUser.role === "admin") return true;
  if (await isGlobalRoomManagerSocket(socket)) return true;
  if (await isRoomOwnerSocket(socket, roomId, rawRoomId)) return true;
  const actorIds = getSocketUserIds(socket);
  return (state.admins || []).some((adminId) => actorIds.includes(String(adminId)));
};

const resolveRoomUserId = (state: VoiceRoomState, requestedId: string): string => {
  const cleanRequestedId = String(requestedId || "").trim();
  if (!cleanRequestedId) return "";
  const members: any[] = [
    ...Object.values(state.onlineUsers || {}),
    ...state.seats.map((seat) => seat.user).filter(Boolean),
  ];
  const match = members.find((member) =>
    [member?.userId, member?.id, member?._id].some((candidate) => {
      if (!candidate) return false;
      const cleanCandidate = String(candidate).trim();
      return cleanCandidate === cleanRequestedId || normalizeRoomId(cleanCandidate) === normalizeRoomId(cleanRequestedId);
    }),
  );
  return String(match?.userId || cleanRequestedId);
};

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
          "userId name image avatar gender level equippedFrame equippedFrameAsset equippedEntry equippedEntryAsset equippedEntryEffect equippedEntryTag equippedEntrance equippedEntranceAsset equippedTassel equippedTasselAsset equippedBadge equippedBadges equippedChatBubble equippedChatBubbleAsset equippedVipId equippedSvipId isGlobalRoomManager",
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
    isGlobalRoomManager: Boolean(source?.isGlobalRoomManager),
  };
};

export const getVoiceRoomState = async (roomId: string, defaultSeatsCount = 8, hostUser: any = null): Promise<VoiceRoomState> => {
  const canonicalId = normalizeRoomId(roomId);
  try {
    const raw = await redis.get(getRoomKey(canonicalId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.seats)) {
        const needsStateUpgrade =
          !parsed.onlineUsers ||
          !Array.isArray(parsed.admins) ||
          !Array.isArray(parsed.bannedChatUsers) ||
          !Array.isArray(parsed.mutedUsers);
        const needsRoomMetadata =
          parsed.coverImage === undefined ||
          parsed.about === undefined ||
          parsed.isLocked === undefined ||
          parsed.mode === undefined ||
          parsed.hasPin === undefined;

        parsed.onlineUsers = parsed.onlineUsers || {};
        parsed.admins = Array.isArray(parsed.admins) ? parsed.admins.map(String) : [];
        parsed.bannedChatUsers = Array.isArray(parsed.bannedChatUsers) ? parsed.bannedChatUsers.map(String) : [];
        parsed.mutedUsers = Array.isArray(parsed.mutedUsers) ? parsed.mutedUsers.map(String) : [];

        while (parsed.seats.length < 15) {
          parsed.seats.push({
            seatIndex: parsed.seats.length,
            isHost: false,
            user: null,
            isMuted: true,
            isLocked: false,
          });
        }
        if (needsRoomMetadata) {
          try {
            const mRoom: any = await Room.findOne({
              $or: [{ channelName: canonicalId }, { channelName: String(roomId) }],
            }).select("coverImage about title isLocked mode +pinHash").lean();
            if (parsed.coverImage === undefined) parsed.coverImage = mRoom?.coverImage || "";
            if (parsed.about === undefined) parsed.about = mRoom?.about || "";
            if (!parsed.title && mRoom?.title) parsed.title = mRoom.title;
            if (mRoom) {
              if (parsed.isLocked === undefined) {
                parsed.isLocked = Boolean(mRoom.isLocked || /private\s*\(pin\)/i.test(String(mRoom.mode || '')));
              }
              if (parsed.mode === undefined) parsed.mode = mRoom.mode || (parsed.isLocked ? 'Private (PIN)' : 'Public');
              if (parsed.hasPin === undefined) parsed.hasPin = Boolean(mRoom.pinHash);
            }
          } catch (_) {}
        }
        parsed.coverImage = parsed.coverImage || "";
        parsed.about = parsed.about || "";
        if (needsStateUpgrade || needsRoomMetadata) {
          try {
            await redis.set(getRoomKey(canonicalId), JSON.stringify(parsed), "EX", 86400);
          } catch (_) {}
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
      .select("title channelName coverImage about themeId themeAsset seatSkinId seatSkinAsset showSeatCharm isLocked mode +pinHash")
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
    showSeatCharm: persistedRoom?.showSeatCharm || false,
    coverImage: persistedRoom?.coverImage || '',
    about: persistedRoom?.about || '',
    isLocked: Boolean(persistedRoom?.isLocked || /private\s*\(pin\)/i.test(String(persistedRoom?.mode || ''))),
    mode: persistedRoom?.mode || 'Public',
    hasPin: Boolean(persistedRoom?.pinHash),
    pendingLiveRequests: {},
    admins: [],
    bannedChatUsers: [],
    mutedUsers: [],
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
      const [roomDocument, userData] = await Promise.all([
        Room.findOne({
          $or: [
            { channelName: roomId },
            { channelName: rawRoomId },
            { channelName: String(roomId) },
            { channelName: String(rawRoomId) },
          ],
        })
          .select("ownerId channelName isLocked")
          .lean(),
        getCanonicalRoomUser(user, data?.user),
      ]);

      const authUserDbId = String((user as any)?.id || (user as any)?._id || "").trim();
      const authUserNumId = String(user?.userId || "").trim();
      const isGlobalManager = await isGlobalRoomManagerSocket(socket);
      const isSuperAdminOrOwnerRole = (user as any)?.role === "superAdmin" || (user as any)?.role === "owner";

      const authorizedHost = Boolean(
        isSuperAdminOrOwnerRole ||
        (roomDocument?.ownerId && (
          String(roomDocument.ownerId) === authUserDbId ||
          (authUserNumId && String(roomDocument.ownerId) === authUserNumId)
        )) ||
        (roomDocument?.channelName && (
          normalizeRoomId(String(roomDocument.channelName)) === normalizeRoomId(authUserNumId) ||
          String(roomDocument.channelName) === authUserNumId
        )) ||
        (authUserNumId && (
          normalizeRoomId(roomId) === normalizeRoomId(authUserNumId) ||
          normalizeRoomId(rawRoomId) === normalizeRoomId(authUserNumId)
        ))
      );
      // 24-hour ban check
      try {
        const isBanned24h = await redis.get(`voice_room_ban24h:${roomId}:${userData.userId}`);
        if (isBanned24h && !isGlobalManager) {
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
      if (!state.onlineUsers) state.onlineUsers = {};
      const timerKey = `${roomId}:${userData.userId}`;
      const reconnectingDuringGrace = disconnectGraceTimers.has(timerKey);
      const previousPresence = state.onlineUsers[userData.userId];
      const wasOnline = Boolean(
        previousPresence &&
        (previousPresence.socketId === socket.id || reconnectingDuringGrace),
      );
      // Rebind the reconnecting user's presence before stale presence cleanup.
      // This keeps their occupied seat when they return during the grace window.
      state.onlineUsers[userData.userId] = { ...userData, socketId: socket.id };
      if (reconnectingDuringGrace) {
        clearTimeout(disconnectGraceTimers.get(timerKey)!);
        disconnectGraceTimers.delete(timerKey);
        console.log(`[VoiceRoom] Reconnected user ${userData.userId} in room ${roomId}. Grace timer cleared.`);
      }

      // Remove abandoned Redis presence entries left behind by a server restart
      // or an interrupted cleanup. Keep users whose disconnect grace timer is live.
      try {
        const roomSockets = await io.in(socketRoomChannel).fetchSockets();
        const connectedSocketIds = new Set(roomSockets.map((roomSocket) => roomSocket.id));
        Object.entries(state.onlineUsers || {}).forEach(([onlineUserId, onlineUser]) => {
          const onlineTimerKey = `${roomId}:${onlineUserId}`;
          if (!connectedSocketIds.has(String((onlineUser as any).socketId || "")) && !disconnectGraceTimers.has(onlineTimerKey)) {
            delete state.onlineUsers[onlineUserId];
            state.seats = state.seats.map((seat) =>
              String(seat.user?.userId || "") === String(onlineUserId)
                ? { ...seat, user: null, isMuted: true }
                : seat,
            );
          }
        });
        // Clear seats only when their user has neither a live socket nor an
        // active reconnect grace period. An empty/temporarily stale onlineUsers
        // map alone must not erase the live seat layout during room entry.
        state.seats = state.seats.map((seat) => {
          const seatUserId = String(seat.user?.userId || "");
          if (!seatUserId) return seat;
          const presence = state.onlineUsers[seatUserId];
          // When Redis has no presence record for a seat at all, there is not
          // enough information to call it stale. Preserve it until a known
          // disconnect/leave event can clear it.
          if (!presence) return seat;
          const isConnected = Boolean(
            presence && connectedSocketIds.has(String((presence as any).socketId || "")),
          );
          const hasGrace = disconnectGraceTimers.has(`${roomId}:${seatUserId}`);
          return isConnected || hasGrace ? seat : { ...seat, user: null, isMuted: true };
        });
        if (!state.seats[0]?.user) state.hostUser = null;
      } catch (presenceErr) {
        console.warn("[VoiceRoom] Presence reconciliation warning:", presenceErr);
      }

      if (data.roomTitle) state.title = data.roomTitle;
      let ownerSeatUpdated = false;
      if (authorizedHost) {
        state.hostUser = userData;
        // BUG #1: Ensure Room Owner automatically occupies mic seat 0
        state.seats[0] = {
          ...state.seats[0],
          seatIndex: 0,
          isHost: true,
          user: userData,
          isMuted: false,
          isLocked: false,
        };
        // Vacate owner from any other seat in this room to prevent duplicates
        for (let i = 1; i < state.seats.length; i++) {
          if (state.seats[i].user && String(state.seats[i].user?.userId) === String(userData.userId)) {
            state.seats[i] = {
              ...state.seats[i],
              user: null,
              isMuted: true,
            };
          }
        }
        ownerSeatUpdated = true;
      }

      if (!state.onlineUsers) state.onlineUsers = {};
      if (!Array.isArray(state.admins)) state.admins = [];
      if (!Array.isArray(state.bannedChatUsers)) state.bannedChatUsers = [];
      if (!Array.isArray(state.mutedUsers)) state.mutedUsers = [];
      let shouldBroadcastJoin = !wasOnline;
      if (!wasOnline && userData.userId) {
        try {
          const firstJoinForUser = await redis.set(
            `voice_room_join_event:${roomId}:${userData.userId}`,
            String(Date.now()),
            "EX",
            4,
            "NX",
          );
          shouldBroadcastJoin = firstJoinForUser === "OK";
        } catch (joinLockErr) {
          console.warn("[VoiceRoom] Join deduplication warning:", joinLockErr);
        }
      }
      state.onlineUsers[userData.userId] = {
        ...userData,
        socketId: socket.id,
      };

      if (isGlobalManager) {
        state.bannedChatUsers = (state.bannedChatUsers || []).filter((id) => String(id) !== String(userData.userId));
        state.mutedUsers = (state.mutedUsers || []).filter((id) => String(id) !== String(userData.userId));
        state.seats = state.seats.map((seat) =>
          String(seat.user?.userId || '') === String(userData.userId)
            ? { ...seat, isMuted: false, isLocked: false }
            : seat,
        );
      }

      await saveVoiceRoomState(state);

      if (shouldBroadcastJoin && userData.userId) {
        RoomTaskService.recordVisitor(roomId, String(userData.userId)).catch((err) => {
          console.warn("[VoiceRoom] Record visitor warning:", err);
        });
      }

      if (ownerSeatUpdated) {
        const updatePayload = {
        roomId,
          seatIndex: 0,
          user: userData,
          seats: state.seats,
        };
        io.to(socketRoomChannel).emit("voice_room:seat_updated", updatePayload);
        if (rawRoomId !== roomId) {
          io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:seat_updated", updatePayload);
        }
      }

      // Send initial state to the joiner
      socket.emit("voice_room:state", {
        success: true,
        roomId: state.roomId,
        title: state.title,
        seats: state.seats,
        onlineCount: Object.keys(state.onlineUsers).length,
        onlineUsers: Object.values(state.onlineUsers),
        hostUser: state.hostUser,
        coverImage: state.coverImage || '',
        about: state.about || '',
        themeId: state.themeId || null,
        themeAsset: state.themeAsset || null,
        seatSkinId: state.seatSkinId || null,
        seatSkinAsset: state.seatSkinAsset || null,
        showSeatCharm: Boolean(state.showSeatCharm),
        mode: state.mode || 'Public',
        hasPin: Boolean(state.hasPin),
        isHost: authorizedHost,
        isOwner: authorizedHost,
        isGlobalRoomManager: isGlobalManager,
        isLocked: Boolean(state.isLocked || roomDocument?.isLocked),
        admins: state.admins,
        bannedChatUsers: state.bannedChatUsers,
        mutedUsers: state.mutedUsers,
      });

      // Broadcast user join to all sockets in the channel
      if (shouldBroadcastJoin) {
        io.to(socketRoomChannel).emit("voice_room:user_joined", {
          roomId,
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
        roomId,
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

      const targetUserId = String((socket as any).voiceUser?.userId || user?.userId || "");
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
          roomId,
          seatIndex: vacatedIndex,
          user: null,
          seats: state.seats,
        };

        io.to(socketRoomChannel).emit("voice_room:seat_updated", leaveSeatPayload);
        if (rawRoomId !== roomId) {
          io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:seat_updated", leaveSeatPayload);
        }
        io.to(socketRoomChannel).emit("voice_room:force_mute", { roomId, targetUserId, isMuted: true });

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
      const targetSeat = state.seats[seatIndex];
      const actorIds = getSocketUserIds(socket);
      const isOwnSeat = Boolean(targetSeat?.user && actorIds.some((id) =>
        id === String(targetSeat.user?.userId) ||
        id === String((targetSeat.user as any)?._id) ||
        id === String((targetSeat.user as any)?.id)
      ));
      const isModerator = await canModerateRoom(socket, state, roomId, rawRoomId);
      if (!targetSeat || (!isOwnSeat && !isModerator)) {
        socket.emit("voice_room:error", { message: "You cannot change this seat's microphone state" });
        return;
      }

      const targetUserId = String(targetSeat.user?.userId || "");
      const isProtectedManager = targetUserId ? await isGlobalRoomManagerId(targetUserId) : false;
      if (isProtectedManager && !isOwnSeat && Boolean(data.isMuted)) {
        socket.emit("voice_room:error", { message: "Global room managers cannot be muted by other room users" });
        return;
      }
      const isForceMuted = Boolean(!isProtectedManager && targetUserId && state.mutedUsers?.includes(targetUserId));
      const nextMuted = isForceMuted ? true : Boolean(data.isMuted);

      state.seats[seatIndex].isMuted = nextMuted;
      if (isProtectedManager && isOwnSeat && !nextMuted) {
        state.mutedUsers = (state.mutedUsers || []).filter((id) => String(id) !== targetUserId);
        state.bannedChatUsers = (state.bannedChatUsers || []).filter((id) => String(id) !== targetUserId);
      }
      await saveVoiceRoomState(state);

      const mutePayload = {
        roomId,
        seatIndex,
        isMuted: nextMuted,
        seats: state.seats,
      };

      io.to(socketRoomChannel).emit("voice_room:seat_muted", mutePayload);
      if (isProtectedManager && isOwnSeat && !nextMuted) {
        io.to(socketRoomChannel).emit("voice_room:moderation_state", {
          roomId,
          admins: state.admins || [],
          bannedChatUsers: state.bannedChatUsers || [],
          mutedUsers: state.mutedUsers || [],
        });
      }
      if (rawRoomId !== roomId) {
        io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:seat_muted", mutePayload);
      }
    } catch (err: any) {
      console.error("[VoiceRoom] Mute seat error:", err);
    }
  });

  // 5. Lock / Unlock Seat (Owner / Admin Only)
  socket.on("voice_room:lock_seat", async (data: { roomId: string; seatIndex: number; isLocked: boolean }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      const seatIndex = Number(data?.seatIndex);
      if (!rawRoomId || isNaN(seatIndex) || seatIndex === 0) return;
      const roomId = normalizeRoomId(rawRoomId);

      const state = await getVoiceRoomState(roomId);
      if (!(await canModerateRoom(socket, state, roomId, rawRoomId))) {
        socket.emit("voice_room:error", {
          message: "Only the room owner is authorized to lock/unlock seats",
          code: "UNAUTHORIZED_LOCK",
        });
        return;
      }

      const socketRoomChannel = `voice_room_channel:${roomId}`;

      if (state.seats[seatIndex]) {
        const isLocked = Boolean(data.isLocked);
        const seatedUserId = String(state.seats[seatIndex].user?.userId || '');
        if (isLocked && seatedUserId && (await isGlobalRoomManagerId(seatedUserId))) {
          socket.emit("voice_room:error", { message: "Global room managers cannot be removed or locked out of a seat" });
          return;
        }
        const removedUserId = isLocked ? String(state.seats[seatIndex].user?.userId || "") : "";
        state.seats[seatIndex].isLocked = isLocked;
        if (isLocked) {
          state.seats[seatIndex].user = null;
          state.seats[seatIndex].isMuted = true;
        }
        await saveVoiceRoomState(state);

        const lockPayload = {
          roomId,
          seatIndex,
          isLocked,
          seats: state.seats,
        };

        io.to(socketRoomChannel).emit("voice_room:seat_locked", lockPayload);
        if (rawRoomId !== roomId) {
          io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:seat_locked", lockPayload);
        }
        if (removedUserId) {
          io.to(socketRoomChannel).emit("voice_room:moved_to_audience", {
            roomId,
            targetUserId: removedUserId,
            seatIndex,
          });
          io.to(socketRoomChannel).emit("voice_room:force_mute", { roomId, targetUserId: removedUserId, isMuted: true });
        }
      }
    } catch (err: any) {
      console.error("[VoiceRoom] Lock seat error:", err);
    }
  });

  // 5.1 Lock / Unlock All Guest Seats (Owner / Admin Only)
  socket.on("voice_room:lock_all_seats", async (data: { roomId: string; isLocked: boolean }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId) return;
      const roomId = normalizeRoomId(rawRoomId);

      const authUserDbId = String((user as any)?.id || (user as any)?._id || "").trim();
      const authUserNumId = String(user?.userId || "").trim();
      const state = await getVoiceRoomState(roomId);
      if (!(await canModerateRoom(socket, state, roomId, rawRoomId))) {
        socket.emit("voice_room:error", {
          message: "Only the room owner is authorized to lock/unlock all seats",
          code: "UNAUTHORIZED_LOCK",
        });
        return;
      }

      const isLocked = Boolean(data.isLocked);
      const socketRoomChannel = `voice_room_channel:${roomId}`;
      const occupiedGuestSeats = state.seats.filter((seat) => seat.seatIndex !== 0 && seat.user?.userId);
      const protectedManagerIds = new Set(
        (await Promise.all(occupiedGuestSeats.map(async (seat) =>
          (await isGlobalRoomManagerId(String(seat.user!.userId))) ? String(seat.user!.userId) : ''
        ))).filter(Boolean),
      );
      const removedUsers = isLocked
        ? occupiedGuestSeats
            .filter((seat) => !protectedManagerIds.has(String(seat.user!.userId)))
            .map((seat) => ({ userId: String(seat.user!.userId), seatIndex: seat.seatIndex }))
        : [];

      state.seats = state.seats.map((s) => {
        if (s.seatIndex === 0) return s; // Seat 0 is host seat
        if (s.user?.userId && protectedManagerIds.has(String(s.user.userId))) return { ...s, isLocked: false };
        return {
          ...s,
          isLocked,
          user: isLocked ? null : s.user,
          isMuted: isLocked ? true : s.isMuted,
        };
      });

      await saveVoiceRoomState(state);
      await Room.findOneAndUpdate(
        { $or: [{ channelName: roomId }, { channelName: rawRoomId }] },
        { isLocked }
      ).catch(() => {});

      const allLockPayload = {
        roomId,
        isLocked,
        seats: state.seats,
      };

      io.to(socketRoomChannel).emit("voice_room:all_seats_locked", allLockPayload);
      if (rawRoomId !== roomId) {
        io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:all_seats_locked", allLockPayload);
      }
      removedUsers.forEach(({ userId, seatIndex }) => {
        io.to(socketRoomChannel).emit("voice_room:moved_to_audience", { roomId, targetUserId: userId, seatIndex });
        io.to(socketRoomChannel).emit("voice_room:force_mute", { roomId, targetUserId: userId, isMuted: true });
      });
      console.log(`[VoiceRoom] Room ${roomId} all seats locked=${isLocked} by ${authUserNumId || authUserDbId}`);
    } catch (err: any) {
      console.error("[VoiceRoom] Lock all seats error:", err);
    }
  });

  // 5.2 Co-Host / Live Seat Apply (Requester -> Server -> Owner)
  socket.on("voice_room:apply_live_seat", async (data: { roomId: string; seatIndex?: number; user?: any }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId) return;
      const roomId = normalizeRoomId(rawRoomId);
      const requestedSeatIndex = data?.seatIndex !== undefined ? Number(data.seatIndex) : 1;

      const userData =
        (socket as any).voiceUser ||
        (await getCanonicalRoomUser(user, data?.user));

      const state = await getVoiceRoomState(roomId);
      if (requestedSeatIndex >= state.seats.length) {
        socket.emit("voice_room:error", { message: "Invalid seat number" });
        return;
      }

      const targetSeat = state.seats[requestedSeatIndex];
      if (targetSeat.isLocked) {
        socket.emit("voice_room:error", { message: "This seat is locked by host" });
        return;
      }
      if (targetSeat.user && String(targetSeat.user.userId) !== String(userData.userId)) {
        socket.emit("voice_room:error", { message: "Seat is already occupied" });
        return;
      }

      const requestId = `req_${roomId}_${userData.userId}_${Date.now()}`;
      const requestPayload = {
        requestId,
        roomId,
        seatIndex: requestedSeatIndex,
        requester: userData,
        createdAt: Date.now(),
      };

      if (!state.pendingLiveRequests) state.pendingLiveRequests = {};
      state.pendingLiveRequests[requestId] = requestPayload;
      await saveVoiceRoomState(state);

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      io.to(socketRoomChannel).emit("voice_room:live_seat_request", requestPayload);
      if (rawRoomId !== roomId) {
        io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:live_seat_request", requestPayload);
      }

      socket.emit("voice_room:live_request_submitted", {
        success: true,
        requestId,
        message: "Application sent to Host! Waiting for approval.",
      });

      console.log(`[VoiceRoom] ${userData.name} applied for live seat #${requestedSeatIndex + 1} in room ${roomId}`);
    } catch (err: any) {
      console.error("[VoiceRoom] Apply live seat error:", err);
    }
  });

  // 5.3 Owner Decision on Live Request (Accept / Reject)
  socket.on("voice_room:respond_live_request", async (data: { roomId: string; requestId: string; approved: boolean; targetUserId: string; seatIndex: number }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId || !data?.requestId) return;
      const roomId = normalizeRoomId(rawRoomId);

      const authUserDbId = String((user as any)?.id || (user as any)?._id || "").trim();
      const authUserNumId = String(user?.userId || "").trim();
      const isSuperAdminOrOwnerRole = (user as any)?.role === "superAdmin" || (user as any)?.role === "owner";
      const isAdminRole = (user as any)?.role === "admin";

      const roomDocument: any = await Room.findOne({
        $or: [{ channelName: roomId }, { channelName: rawRoomId }],
      }).select("ownerId channelName").lean();

      const isOwner = Boolean(
        isSuperAdminOrOwnerRole ||
        (roomDocument?.ownerId && (
          String(roomDocument.ownerId) === authUserDbId ||
          (authUserNumId && String(roomDocument.ownerId) === authUserNumId)
        )) ||
        (roomDocument?.channelName && (
          normalizeRoomId(String(roomDocument.channelName)) === normalizeRoomId(authUserNumId) ||
          String(roomDocument.channelName) === authUserNumId
        )) ||
        (authUserNumId && (
          normalizeRoomId(roomId) === normalizeRoomId(authUserNumId) ||
          normalizeRoomId(rawRoomId) === normalizeRoomId(authUserNumId)
        ))
      );

      if (!isOwner && !isAdminRole && !(await isGlobalRoomManagerSocket(socket))) {
        socket.emit("voice_room:error", {
          message: "Only the room owner is authorized to accept or reject live requests",
          code: "UNAUTHORIZED_DECISION",
        });
        return;
      }

      const state = await getVoiceRoomState(roomId);
      const request = state.pendingLiveRequests?.[data.requestId];

      const requesterData = request?.requester || (await getCanonicalRoomUser({ userId: data.targetUserId }, null));
      const seatIndex = data.seatIndex !== undefined ? Number(data.seatIndex) : (request?.seatIndex || 1);
      const socketRoomChannel = `voice_room_channel:${roomId}`;

      if (data.approved) {
        const targetSeat = state.seats[seatIndex];
        if (targetSeat && targetSeat.user && String(targetSeat.user.userId) !== String(requesterData.userId)) {
          socket.emit("voice_room:error", { message: "Seat already taken by another user" });
          return;
        }

        // Vacate requester from any other seat in this room
        state.seats = state.seats.map((s) => {
          if (s.user && String(s.user.userId) === String(requesterData.userId)) {
            return { ...s, user: null, isMuted: true };
          }
          return s;
        });

        // Assign approved seat
        state.seats[seatIndex] = {
          ...state.seats[seatIndex],
          user: requesterData,
          isMuted: false,
          isLocked: false,
        };

        if (state.pendingLiveRequests) {
          delete state.pendingLiveRequests[data.requestId];
        }
        await saveVoiceRoomState(state);

        const updatePayload = {
          roomId,
          seatIndex,
          user: requesterData,
          seats: state.seats,
        };

        io.to(socketRoomChannel).emit("voice_room:seat_updated", updatePayload);
        if (rawRoomId !== roomId) {
          io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:seat_updated", updatePayload);
        }

        io.to(socketRoomChannel).emit("voice_room:live_request_approved", {
          requestId: data.requestId,
          roomId,
          seatIndex,
          targetUserId: requesterData.userId,
        });

        io.to(socketRoomChannel).emit("voice_room:chat_message", {
          id: "sys-" + Date.now(),
          type: "system",
          text: `🎉 ${requesterData.name} was approved for Live seat #${seatIndex + 1}!`,
          timestamp: Date.now(),
        });

        console.log(`[VoiceRoom] Owner approved ${requesterData.name} for seat #${seatIndex + 1} in room ${roomId}`);
      } else {
        if (state.pendingLiveRequests) {
          delete state.pendingLiveRequests[data.requestId];
        }
        await saveVoiceRoomState(state);

        io.to(socketRoomChannel).emit("voice_room:live_request_rejected", {
          requestId: data.requestId,
          roomId,
          targetUserId: requesterData.userId,
          message: "Your application was declined by the room host.",
        });

        console.log(`[VoiceRoom] Owner rejected live request for ${requesterData.name} in room ${roomId}`);
      }
    } catch (err: any) {
      console.error("[VoiceRoom] Respond live request error:", err);
    }
  });

  // Room-level owner/admin controls are persisted in the room's Redis state.
  socket.on("voice_room:toggle_admin", async (data: { roomId: string; targetUserId: string }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      const requestedTargetUserId = String(data?.targetUserId || "").trim();
      if (!rawRoomId || !requestedTargetUserId) return;
      const roomId = normalizeRoomId(rawRoomId);
      const state = await getVoiceRoomState(roomId);
      const targetUserId = resolveRoomUserId(state, requestedTargetUserId);
      const canAssignAdmins = (await isRoomOwnerSocket(socket, roomId, rawRoomId)) || (await isGlobalRoomManagerSocket(socket));
      if (!canAssignAdmins) {
        socket.emit("voice_room:error", { message: "Only the room owner can assign room admins" });
        return;
      }
      if (await isGlobalRoomManagerId(targetUserId)) {
        socket.emit("voice_room:error", { message: "Global room manager access cannot be changed from a room" });
        return;
      }
      if (targetUserId === String(state.seats[0]?.user?.userId || "") || normalizeRoomId(targetUserId) === roomId) {
        socket.emit("voice_room:error", { message: "The room owner cannot be changed as an admin" });
        return;
      }

      const currentAdmins = new Set((state.admins || []).map(String));
      if (currentAdmins.has(targetUserId)) currentAdmins.delete(targetUserId);
      else currentAdmins.add(targetUserId);
      state.admins = Array.from(currentAdmins);
      await saveVoiceRoomState(state);
      io.to(`voice_room_channel:${roomId}`).emit("voice_room:moderation_state", {
        roomId,
        admins: state.admins,
        bannedChatUsers: state.bannedChatUsers || [],
        mutedUsers: state.mutedUsers || [],
      });
    } catch (err: any) {
      console.error("[VoiceRoom] Admin assignment error:", err);
      socket.emit("voice_room:error", { message: "Could not update room admin" });
    }
  });

  socket.on("voice_room:toggle_chat_ban", async (data: { roomId: string; targetUserId: string }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      const requestedTargetUserId = String(data?.targetUserId || "").trim();
      if (!rawRoomId || !requestedTargetUserId) return;
      const roomId = normalizeRoomId(rawRoomId);
      const state = await getVoiceRoomState(roomId);
      const targetUserId = resolveRoomUserId(state, requestedTargetUserId);
      if (!(await canModerateRoom(socket, state, roomId, rawRoomId))) {
        socket.emit("voice_room:error", { message: "Only room admins can manage chat access" });
        return;
      }
      if (targetUserId === String(state.seats[0]?.user?.userId || "") || normalizeRoomId(targetUserId) === roomId) {
        socket.emit("voice_room:error", { message: "The room owner cannot be banned from chat" });
        return;
      }
      if (await isGlobalRoomManagerId(targetUserId)) {
        socket.emit("voice_room:error", { message: "Global room managers cannot be banned from chat" });
        return;
      }

      const banned = new Set((state.bannedChatUsers || []).map(String));
      if (banned.has(targetUserId)) banned.delete(targetUserId);
      else banned.add(targetUserId);
      state.bannedChatUsers = Array.from(banned);
      await saveVoiceRoomState(state);
      io.to(`voice_room_channel:${roomId}`).emit("voice_room:moderation_state", {
        roomId,
        admins: state.admins || [],
        bannedChatUsers: state.bannedChatUsers,
        mutedUsers: state.mutedUsers || [],
      });
    } catch (err: any) {
      console.error("[VoiceRoom] Chat moderation error:", err);
      socket.emit("voice_room:error", { message: "Could not update chat access" });
    }
  });

  socket.on("voice_room:toggle_user_mute", async (data: { roomId: string; targetUserId: string }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      const requestedTargetUserId = String(data?.targetUserId || "").trim();
      if (!rawRoomId || !requestedTargetUserId) return;
      const roomId = normalizeRoomId(rawRoomId);
      const state = await getVoiceRoomState(roomId);
      const targetUserId = resolveRoomUserId(state, requestedTargetUserId);
      if (!(await canModerateRoom(socket, state, roomId, rawRoomId))) {
        socket.emit("voice_room:error", { message: "Only room admins can mute a user's microphone" });
        return;
      }
      if (targetUserId === String(state.seats[0]?.user?.userId || "") || normalizeRoomId(targetUserId) === roomId) {
        socket.emit("voice_room:error", { message: "The room owner cannot be muted by room moderation" });
        return;
      }
      if (await isGlobalRoomManagerId(targetUserId)) {
        socket.emit("voice_room:error", { message: "Global room managers cannot be muted" });
        return;
      }

      const muted = new Set((state.mutedUsers || []).map(String));
      const isMuted = !muted.has(targetUserId);
      if (isMuted) muted.add(targetUserId);
      else muted.delete(targetUserId);
      state.mutedUsers = Array.from(muted);
      const targetSeat = state.seats.find((seat) => String(seat.user?.userId || "") === targetUserId);
      if (targetSeat) targetSeat.isMuted = isMuted;
      await saveVoiceRoomState(state);

      const roomChannel = `voice_room_channel:${roomId}`;
      io.to(roomChannel).emit("voice_room:moderation_state", {
        roomId,
        admins: state.admins || [],
        bannedChatUsers: state.bannedChatUsers || [],
        mutedUsers: state.mutedUsers,
      });
      if (targetSeat) {
        io.to(roomChannel).emit("voice_room:seat_muted", {
          roomId,
          seatIndex: targetSeat.seatIndex,
          isMuted,
          seats: state.seats,
        });
      }
      io.to(roomChannel).emit("voice_room:force_mute", { roomId, targetUserId, isMuted });
    } catch (err: any) {
      console.error("[VoiceRoom] User microphone moderation error:", err);
      socket.emit("voice_room:error", { message: "Could not update the user's microphone" });
    }
  });

  // 6. Send Chat Message
  socket.on("voice_room:send_chat", async (data: { roomId: string; message: any }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId || !data?.message) return;
      const roomId = normalizeRoomId(rawRoomId);

      const senderId = String((socket as any).voiceUser?.userId || user?.userId || "");
      const state = await getVoiceRoomState(roomId);
      if (state.bannedChatUsers?.includes(senderId) && !(await isGlobalRoomManagerSocket(socket))) {
        socket.emit("voice_room:error", {
          message: "You are currently muted from chat in this room.",
          code: "ROOM_CHAT_BANNED",
        });
        return;
      }

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      const msg = {
        ...data.message,
        id: data.message.id || ("msg-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4)),
        senderId,
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
      if (isExplicitLeave && targetUserId) {
        await redis.del(`voice_room_join_event:${roomId}:${targetUserId}`);
      }
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
        if (!targetUserId && targetName && targetName !== "User" && targetName !== "Guest") {
          if (seatUser.name && String(seatUser.name).trim().toLowerCase() === targetName.trim().toLowerCase()) return true;
        }
        return false;
      };

      const userSeat = state.seats.find((s) => isMatchingSeatUser(s.user));

      if (!isExplicitLeave && userSeat) {
        // BUG #2 & BUG #4: App background / screen lock / momentary network drop grace period
        // Keep the user in their seat! Do NOT drop mic/seat immediately!
        console.log(`[VoiceRoom] User ${targetName} (${targetUserId}) disconnected unexpectedly while on seat #${userSeat.seatIndex + 1}. Starting 45s grace timer...`);
        const timerKey = `${roomId}:${targetUserId}`;
        if (disconnectGraceTimers.has(timerKey)) {
          clearTimeout(disconnectGraceTimers.get(timerKey)!);
        }
        const timer = setTimeout(async () => {
          console.log(`[VoiceRoom] Grace period expired for ${targetName} (${targetUserId}) in room ${roomId}. Checking current presence.`);
          try {
            const currentState = await getVoiceRoomState(roomId);
            if (disconnectGraceTimers.get(timerKey) !== timer) {
              // A fast reconnect followed by another brief disconnect started
              // a newer grace period, or the user reconnected while this timer
              // callback was loading state.
              return;
            }
            const currentPresence = currentState.onlineUsers?.[targetUserId];
            if (currentPresence?.socketId) {
              const connectedSockets = await io.in(socketRoomChannel).fetchSockets();
              if (connectedSockets.some((roomSocket) => roomSocket.id === String(currentPresence.socketId))) {
                // A reconnect can race the timer callback after it has fired.
                // Keep the seat when that user is already back in the room.
                disconnectGraceTimers.delete(timerKey);
                return;
              }
            }
            if (disconnectGraceTimers.get(timerKey) !== timer) return;
            console.log(`[VoiceRoom] Grace period confirmed for ${targetName} (${targetUserId}) in room ${roomId}. Vacating seat.`);
            const vacated: number[] = [];
            currentState.seats = currentState.seats.map((s) => {
              if (isMatchingSeatUser(s.user)) {
                vacated.push(s.seatIndex);
                return { ...s, user: null, isMuted: true };
              }
              return s;
            });
            if (targetUserId && currentState.onlineUsers?.[targetUserId]) {
              delete currentState.onlineUsers[targetUserId];
            }
            if (vacated.includes(0)) currentState.hostUser = null;
            await saveVoiceRoomState(currentState);
            if (disconnectGraceTimers.get(timerKey) === timer) {
              disconnectGraceTimers.delete(timerKey);
            }
            if (vacated.length > 0) {
              vacated.forEach((freedIdx) => {
                const seatPayload = {
                  roomId,
                  seatIndex: freedIdx,
                  user: null,
                  seats: currentState.seats,
                };
                io.to(socketRoomChannel).emit("voice_room:seat_updated", seatPayload);
                if (rawRoomId !== roomId) {
                  io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:seat_updated", seatPayload);
                }
              });
            }
            const uPayload = {
              roomId,
              user: { userId: targetUserId, name: targetName },
              onlineCount: Object.keys(currentState.onlineUsers || {}).length,
              freedSeatIndices: vacated,
              seats: currentState.seats,
            };
            io.to(socketRoomChannel).emit("voice_room:user_left", uPayload);
            if (rawRoomId !== roomId) {
              io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:user_left", uPayload);
            }
          } catch (err) {
            if (disconnectGraceTimers.get(timerKey) === timer) {
              disconnectGraceTimers.delete(timerKey);
            }
            console.error("[VoiceRoom] Grace timer expiration error:", err);
          }
        }, GRACE_PERIOD_MS);
        disconnectGraceTimers.set(timerKey, timer);
        return;
      }

      // Explicit leave (or unseated user) -> clear grace timer and vacate immediately
      const timerKey = `${roomId}:${targetUserId}`;
      if (disconnectGraceTimers.has(timerKey)) {
        clearTimeout(disconnectGraceTimers.get(timerKey)!);
        disconnectGraceTimers.delete(timerKey);
      }

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
          roomId,
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
        roomId,
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
      if (!(await canModerateRoom(socket, state, roomId, rawRoomId))) {
        socket.emit("voice_room:error", { message: "Only room admins can remove users from seats" });
        return;
      }
      if (await isGlobalRoomManagerId(targetUserId)) {
        socket.emit("voice_room:error", { message: "Global room managers cannot be removed from seats" });
        return;
      }
      if (targetUserId === String(state.seats[0]?.user?.userId || "") || normalizeRoomId(targetUserId) === roomId) {
        socket.emit("voice_room:error", { message: "The room owner cannot be removed from the seat" });
        return;
      }
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
          roomId,
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
        io.to(socketRoomChannel).emit("voice_room:force_mute", { roomId, targetUserId, isMuted: true });

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

      const state = await getVoiceRoomState(roomId);
      if (!(await canModerateRoom(socket, state, roomId, rawRoomId))) {
        socket.emit("voice_room:error", { message: "Only room admins can kick users" });
        return;
      }
      if (await isGlobalRoomManagerId(targetUserId)) {
        socket.emit("voice_room:error", { message: "Global room managers cannot be kicked from rooms" });
        return;
      }
      if (targetUserId === String(state.seats[0]?.user?.userId || "") || normalizeRoomId(targetUserId) === roomId) {
        socket.emit("voice_room:error", { message: "The room owner cannot be kicked" });
        return;
      }

      // Save 24 Hours Ban in Redis (86400 seconds)
      await redis.set(`voice_room_ban24h:${roomId}:${targetUserId}`, Date.now() + 24 * 3600 * 1000, "EX", 86400);

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
          roomId,
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
      io.to(socketRoomChannel).emit("voice_room:user_left", {
        roomId,
        user: { userId: targetUserId, name: data?.targetName || "User" },
        onlineCount: Object.keys(state.onlineUsers || {}).length,
        freedSeatIndex: vacatedIdx,
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
      const isGlobalManager = await isGlobalRoomManagerSocket(socket);
      const roomDocument: any = await Room.findOne({
        $or: [{ channelName: roomId }, { channelName: rawRoomId }],
      });
      const isOwner = Boolean(
        roomDocument &&
          (isGlobalManager || String(roomDocument.ownerId) === authUserId ||
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
      if (!owned && !isFreeRoomToolTheme && !isGlobalManager) {
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
      const isGlobalManager = await isGlobalRoomManagerSocket(socket);
      const roomDocument: any = await Room.findOne({
        $or: [{ channelName: roomId }, { channelName: rawRoomId }],
      });
      const isOwner = Boolean(
        roomDocument &&
          (isGlobalManager || String(roomDocument.ownerId) === authUserId ||
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
            String(
              item.metadata?.seatSkinLocation ||
              item.metadata?.themeLocation ||
              item.metadata?.location ||
              ""
            ).toUpperCase()
          ));

      if (!owned && !isPreset && !isFreeRoomToolSeatSkin && !isGlobalManager) {
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

  // 16. Update / Toggle Seat Charm (Flower 🌸) Visibility from Room Tools
  socket.on("voice_room:update_seat_charm", async (data: { roomId: string; showSeatCharm: boolean }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId) return;

      const canonicalId = normalizeRoomId(rawRoomId);
      const authUserId = (socket as any).userId || (socket as any).user?.id || (socket as any).user?._id;
      const socketRoomChannel = `room_${canonicalId}`;

      const state = await getVoiceRoomState(canonicalId);
      state.showSeatCharm = Boolean(data.showSeatCharm);
      await saveVoiceRoomState(state);

      try {
        await Room.updateOne(
          { $or: [{ channelName: canonicalId }, { channelName: rawRoomId }] },
          { showSeatCharm: state.showSeatCharm }
        );
      } catch (dbErr) {
        console.warn(`[VoiceRoom] Room ${rawRoomId} showSeatCharm Mongo update warning:`, dbErr);
      }

      const payload = {
        showSeatCharm: state.showSeatCharm,
        updatedBy: authUserId,
      };

      io.to(socketRoomChannel).emit("voice_room:seat_charm_updated", payload);
      console.log(`[VoiceRoom] Room ${rawRoomId} seat charm toggled to ${state.showSeatCharm} by ${authUserId}`);
    } catch (err: any) {
      console.error("[VoiceRoom] Update seat charm error:", err);
      socket.emit("voice_room:error", { message: err?.message || "Failed to update seat charm" });
    }
  });

  // 17. Update Room Details (DP / Title / About) (Owner Only)
  socket.on("voice_room:update_details", async (data: { roomId: string; coverImage?: string; title?: string; about?: string; seatCount?: number; isLocked?: boolean; mode?: string; hasPin?: boolean }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId) return;
      const roomId = normalizeRoomId(rawRoomId);

      let roomDocument: any = await Room.findOne({
        $or: [{ channelName: roomId }, { channelName: rawRoomId }],
      });

      const authUserDbId = String((user as any)?.id || (user as any)?._id || "").trim();
      const authUserNumId = String(user?.userId || "").trim();
      const isSuperAdminOrOwnerRole = (user as any)?.role === "superAdmin" || (user as any)?.role === "owner" || (user as any)?.role === "admin";
      const isGlobalManager = await isGlobalRoomManagerSocket(socket);

      const isOwner = Boolean(
        isSuperAdminOrOwnerRole || isGlobalManager ||
        (roomDocument?.ownerId && (
          String(roomDocument.ownerId) === authUserDbId ||
          (authUserNumId && String(roomDocument.ownerId) === authUserNumId)
        )) ||
        (roomDocument?.channelName && (
          normalizeRoomId(String(roomDocument.channelName)) === normalizeRoomId(authUserNumId) ||
          String(roomDocument.channelName) === authUserNumId
        )) ||
        (authUserNumId && (
          normalizeRoomId(roomId) === normalizeRoomId(authUserNumId) ||
          normalizeRoomId(rawRoomId) === normalizeRoomId(authUserNumId)
        ))
      );

      if (!isOwner) {
        socket.emit("voice_room:error", {
          message: "Only the room owner is authorized to update room details",
          code: "NOT_ROOM_OWNER",
        });
        return;
      }

      if (!roomDocument) {
        try {
          roomDocument = await Room.create({
            title: data.title || `Voice Room #${roomId}`,
            channelName: roomId,
            ownerId: (user as any)?.id || (user as any)?._id,
            coverImage: data.coverImage || "",
            about: data.about || "",
            seatCount: data.seatCount || 8,
            isActive: true,
          });
        } catch (createErr) {
          console.warn("[VoiceRoom] Auto-create roomDocument warning:", createErr);
        }
      }

      const state = await getVoiceRoomState(roomId);
      if (data.coverImage) {
        state.coverImage = data.coverImage;
        if (roomDocument) roomDocument.coverImage = data.coverImage;
      }
      if (data.title) {
        state.title = data.title;
        if (roomDocument) roomDocument.title = data.title;
      }
      if (typeof data.about === "string") {
        state.about = data.about;
        if (roomDocument) (roomDocument as any).about = data.about;
      }
      if (data.seatCount) {
        state.seatCount = data.seatCount;
        if (roomDocument) (roomDocument as any).seatCount = data.seatCount;
      }
      if (typeof data.isLocked === "boolean") {
        state.isLocked = data.isLocked;
        if (roomDocument) (roomDocument as any).isLocked = data.isLocked;
      }
      if (data.mode) {
        state.mode = data.mode;
        if (roomDocument) (roomDocument as any).mode = data.mode;
      }
      if (typeof data.hasPin === "boolean") state.hasPin = data.hasPin;

      await saveVoiceRoomState(state);
      if (roomDocument) await roomDocument.save();

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      const payload = {
        roomId,
        coverImage: state.coverImage,
        title: state.title,
        about: state.about,
        seatCount: state.seatCount,
        isLocked: Boolean(state.isLocked),
        mode: state.mode || (state.isLocked ? "Private (PIN)" : "Public"),
        hasPin: Boolean(state.hasPin),
        updatedBy: authUserDbId,
      };

      io.to(socketRoomChannel).emit("voice_room:details_updated", payload);
      if (rawRoomId !== roomId) {
        io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:details_updated", payload);
      }

      console.log(`[VoiceRoom] Room ${roomId} details updated (coverImage=${Boolean(data.coverImage)}) by owner ${authUserDbId}`);
    } catch (err: any) {
      console.error("[VoiceRoom] Update room details error:", err);
      socket.emit("voice_room:error", { message: err?.message || "Failed to update room details" });
    }
  });

  // 18. Mic Heartbeat for On-Mic Tasks
  socket.on("voice_room:mic_heartbeat", async (data: { roomId: string; minutes?: number }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId) return;
      const roomId = normalizeRoomId(rawRoomId);
      const authUserId = String((user as any)?.id || (user as any)?._id || (socket as any).userId || "").trim();
      if (!authUserId) return;

      const mins = Math.max(1, Math.min(60, Number(data?.minutes) || 1));
      await RoomTaskService.recordMicDuration(roomId, authUserId, mins);
    } catch (err) {
      console.warn("[VoiceRoom] Mic heartbeat error:", err);
    }
  });

  // 19. Task Claim Socket Handler
  socket.on("voice_room:task_claim", async (data: { roomId: string; taskId: string }, callback?: (res: any) => void) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      const taskId = String(data?.taskId || "").trim();
      const authUserId = String((user as any)?.id || (user as any)?._id || (socket as any).userId || "").trim();

      if (!rawRoomId || !taskId || !authUserId) {
        if (typeof callback === "function") callback({ success: false, message: "Missing required parameters" });
        return;
      }

      const roomId = normalizeRoomId(rawRoomId);
      const result = await RoomTaskService.claimTaskReward(roomId, authUserId, taskId);

      socket.emit("voice_room:task_claimed", {
        roomId,
        ...result,
      });

      if (typeof callback === "function") callback({ success: true, data: result });
    } catch (err: any) {
      console.error("[VoiceRoom] Task claim error:", err);
      if (typeof callback === "function") callback({ success: false, message: err?.message || "Failed to claim task reward" });
      socket.emit("voice_room:error", { message: err?.message || "Failed to claim task reward" });
    }
  });
};
