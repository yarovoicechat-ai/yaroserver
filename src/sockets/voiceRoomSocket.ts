import { HostingObserver, recordObservedHostingMinute, attendanceEconomy } from '../economy/attendance';
import { IdentityResolverService } from '../services/identityResolver.service';
import mongoose, { Types } from "mongoose";
import { Server } from "socket.io";
import { AuthenticatedSocket } from "../middlewares/auth.socket";
import redis from "../configs/redisConfig";
import { GiftService } from "../gift/gift.service";
import { EntryEffectService } from "../services/entryEffect.service";
import { Room } from "../models/room.model";
import { User } from "../models/user.model";
import { StoreItem } from "../models/storeItem.model";
import { RoomTaskService } from "../services/roomTask.service";
import { withDistributedLock } from "../utils/distributedLock";
import { allocateRoomSeat } from "../utils/roomSeatRules";
import { isProtectedTeamAccount } from "../utils/roomModerationRules";
import { isRoomOwner } from "../utils/roomVoiceAuthorization";

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
  uniqueId?: string;
  displayRoomId?: string;
  badgeUrl?: string;
  uniqueIdBadge?: any;
  title: string;
  hostUser: any;
  seatCount: number;
  seats: VoiceRoomSeat[];
  onlineUsers: Record<string, { userId: string; name: string; avatar: string; socketId: string; membershipId?: string }>;
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
const getVoiceRoomChannels = (roomId: string, rawRoomId: string) => Array.from(new Set([
  `voice_room_channel:${normalizeRoomId(roomId)}`,
  ...(rawRoomId && rawRoomId !== normalizeRoomId(roomId) ? [`voice_room_channel:${rawRoomId}`] : []),
]));

const getSocketUserIds = (socket: AuthenticatedSocket): string[] => {
  const socketUser: any = socket.user || {};
  return [socketUser.userId, socketUser.id, socketUser._id]
    .filter(Boolean)
    .map((value) => String(value));
};

export const getUserOfficialPowers = async (userId: string) => {
  const identifier = String(userId || '').trim();
  const alternatives: any[] = [];
  if (/^\d+$/.test(identifier) && Number.isSafeInteger(Number(identifier))) {
    alternatives.push({ userId: Number(identifier) });
  }
  if (Types.ObjectId.isValid(identifier)) alternatives.push({ _id: identifier });
  if (!alternatives.length) return null;
  const dbUser: any = await User.findOne({ $or: alternatives, isDeleted: false })
    .select('officialPowers isGlobalRoomManager role name userName')
    .lean();
  const isProtectedRole = ['owner', 'superAdmin', 'admin', 'operator', 'bdLeader', 'bd'].includes(String(dbUser?.role || ''));
  const isRudransh = /rudransh/i.test(String(dbUser?.name || '')) || /rudransh/i.test(String(dbUser?.userName || ''));
  const isManager = Boolean(dbUser?.isGlobalRoomManager || dbUser?.officialPowers?.isGlobalRoomManager || isProtectedRole || isRudransh);
  return {
    isGlobalRoomManager: isManager,
    canBanRoom: Boolean(dbUser?.officialPowers?.canBanRoom || isManager),
    canBanUser: Boolean(dbUser?.officialPowers?.canBanUser || isManager),
    canGhostEntry: Boolean(dbUser?.officialPowers?.canGhostEntry || isManager),
    canKickAnyUser: Boolean(dbUser?.officialPowers?.canKickAnyUser || isManager),
    canMuteAnyUser: Boolean(dbUser?.officialPowers?.canMuteAnyUser || isManager),
    canLockAnySeat: Boolean(dbUser?.officialPowers?.canLockAnySeat || isManager),
  };
};

const isGlobalRoomManagerId = async (userId: string): Promise<boolean> => {
  const identifier = String(userId || '').trim();
  const alternatives: any[] = [];
  if (/^\d+$/.test(identifier) && Number.isSafeInteger(Number(identifier))) {
    alternatives.push({ userId: Number(identifier) });
  }
  if (Types.ObjectId.isValid(identifier)) alternatives.push({ _id: identifier });
  if (!alternatives.length) return false;
  const account: any = await User.findOne({
    $or: alternatives,
    isDeleted: false,
  }).select('role isGlobalRoomManager officialPowers name userName').lean();
  if (/rudransh/i.test(String(account?.name || '')) || /rudransh/i.test(String(account?.userName || ''))) return true;
  return isProtectedTeamAccount(account);
};

const isGlobalRoomManagerSocket = async (socket: AuthenticatedSocket): Promise<boolean> => {
  const userId = String((socket.user as any)?.userId || (socket.user as any)?._id || (socket.user as any)?.id || '').trim();
  return isGlobalRoomManagerId(userId);
};

const isRoomOwnerSocket = async (
  socket: AuthenticatedSocket,
  roomId: string,
  rawRoomId: string,
): Promise<boolean> => {
  const allowedChannels = getVoiceRoomChannels(roomId, rawRoomId);
  if (!allowedChannels.some((channel) => socket.rooms.has(channel))) return false;
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
  if (['admin', 'superAdmin', 'owner'].includes(socketUser.role)) return true;
  if (await isGlobalRoomManagerSocket(socket)) return true;
  const userPowers = await getUserOfficialPowers(String(socketUser.userId || socketUser._id || socketUser.id || ''));
  if (userPowers && (userPowers.canKickAnyUser || userPowers.canMuteAnyUser || userPowers.isGlobalRoomManager || userPowers.canBanRoom)) {
    return true;
  }
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
  const targetId = socketUser?._id || socketUser?.id;
  const targetUserId = socketUser?.userId || fallback?.userId;
  const numUserId = Number(targetUserId);
  const query =
    targetId && Types.ObjectId.isValid(String(targetId)) && String(targetId).length === 24
      ? { _id: targetId }
      : !isNaN(numUserId) && numUserId > 0
        ? { userId: numUserId }
        : null;

  const dbUser: any = query
    ? await User.findOne(query)
        .select(
          "userId name image avatar gender level wealthLevel wealthExp charmLevel charmExp customDisplayId uniqueId storeInventory equippedVehicle equippedVehicleAsset equippedFrame equippedFrameAsset equippedEntry equippedEntryAsset equippedEntryEffect equippedEntryTag equippedEntrance equippedEntranceAsset equippedTassel equippedTasselAsset equippedBadge equippedBadges equippedChatBubble equippedChatBubbleAsset equippedVipId equippedSvipId isGlobalRoomManager officialPowers",
        )
        .lean()
    : null;
  const source: any = dbUser || socketUser || {};
  const identity = await IdentityResolverService.resolveEffectiveIdentity(source);
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
    // Identity comes from the authenticated socket or its matching database
    // record. Client room payloads may only enrich display fields.
    userId: String(source?.userId || socketUser?.userId || "guest"),
    numericUserId: Number(source?.userId || fallback?.userId || 0),
    name: String(source?.name || fallback?.name || "Guest"),
    nameEffect: identity?.nameEffect || null,
    avatar: String(avatar),
    image: String(avatar),
    gender: source?.gender || fallback?.gender || "male",
    level: source?.level || 1,
    wealthLevel: source?.wealthLevel || source?.level || 1,
    customDisplayId: source?.customDisplayId || source?.uniqueId || null,
    uniqueId: source?.uniqueId || source?.customDisplayId || null,
    storeInventory: source?.storeInventory || [],
    equippedFrame: source?.equippedFrameAsset || source?.equippedFrame || null,
    equippedFrameAsset: source?.equippedFrameAsset || null,
    equippedEntry: source?.equippedEntryAsset || source?.equippedEntry || null,
    equippedEntryAsset: source?.equippedEntryAsset || null,
    equippedEntryEffect: source?.equippedEntryEffect || null,
    equippedEntryTag: source?.equippedEntryTag || null,
    equippedEntrance: source?.equippedEntranceAsset || source?.equippedEntrance || null,
    equippedEntranceAsset: source?.equippedEntranceAsset || null,
    equippedVehicle: source?.equippedVehicleAsset || source?.equippedVehicle || null,
    equippedVehicleAsset: source?.equippedVehicleAsset || null,
    equippedTassel: source?.equippedTasselAsset || source?.equippedTassel || null,
    equippedTasselAsset: source?.equippedTasselAsset || null,
    equippedBadge: source?.equippedBadge || null,
    equippedBadges: source?.equippedBadges || [],
    equippedChatBubble: source?.equippedChatBubble || null,
    equippedChatBubbleAsset: source?.equippedChatBubbleAsset || null,
    equippedVipId: source?.equippedVipId || null,
    equippedSvipId: source?.equippedSvipId || null,
    isGlobalRoomManager: Boolean(source?.isGlobalRoomManager || source?.officialPowers?.isGlobalRoomManager),
    officialPowers: source?.officialPowers || null,
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
        if (needsRoomMetadata || !parsed.displayRoomId) {
          try {
            const mRoom: any = await Room.findOne({
              $or: [{ channelName: canonicalId }, { channelName: String(roomId) }],
            })
              .select("coverImage about title isLocked mode +pinHash ownerId uniqueId customDisplayId badgeUrl badgeIconUrl uniqueIdBadge")
              .populate("ownerId", "userId uniqueId customDisplayId displayId storeInventory equippedCustomId")
              .lean();
            if (parsed.coverImage === undefined) parsed.coverImage = mRoom?.coverImage || "";
            if (parsed.about === undefined) parsed.about = mRoom?.about || "";
            if (!parsed.title && mRoom?.title) parsed.title = mRoom.title;
            const ownerDoc = mRoom?.ownerId as any;
            const resolvedUnique = String(ownerDoc?.uniqueId || ownerDoc?.customDisplayId || ownerDoc?.displayId || mRoom?.uniqueId || "").trim();
            if (!parsed.uniqueId && resolvedUnique) parsed.uniqueId = resolvedUnique;
            if (!parsed.displayRoomId) parsed.displayRoomId = resolvedUnique || canonicalId;

            let resolvedBadgeUrl = String(mRoom?.badgeUrl || mRoom?.badgeIconUrl || "").trim();
            if (/frame/i.test(resolvedBadgeUrl)) resolvedBadgeUrl = "";
            let resolvedUniqueBadge = mRoom?.uniqueIdBadge || null;
            if (resolvedUniqueBadge?.badgeIconUrl && /frame/i.test(resolvedUniqueBadge.badgeIconUrl)) {
              resolvedUniqueBadge = null;
            }
            if (!resolvedBadgeUrl && ownerDoc) {
              const inv = Array.isArray(ownerDoc.storeInventory) ? ownerDoc.storeInventory : [];
              const targetId = String(ownerDoc.customDisplayId || ownerDoc.equippedCustomId || resolvedUnique || "").trim();
              const uInv = inv.find((it: any) => {
                const cat = String(it.category || it.type || "").toLowerCase().trim();
                if (/frame|theme|bubble|tassel|wave|skin|entry|vehicle/i.test(cat)) return false;
                const isBadgeCategory = ['unique id', 'unique_id', 'custom id', 'custom_id', 'badge', 'id'].includes(cat);
                const itemDisplayId = String(it.metadata?.uniqueDisplayId || it.metadata?.displayId || it.uniqueId || "").trim();
                const matchesId = Boolean(targetId && itemDisplayId && targetId === itemDisplayId);
                return isBadgeCategory || matchesId;
              });
              const candidateBadgeUrl = String(uInv?.metadata?.badgeIconUrl || uInv?.metadata?.badgeUrl || (['unique id', 'unique_id', 'badge', 'custom id'].includes(String(uInv?.category || '').toLowerCase()) ? (uInv?.animationUrl || uInv?.imageUrl) : "") || "").trim();
              if (candidateBadgeUrl && !/frame/i.test(candidateBadgeUrl)) {
                resolvedBadgeUrl = candidateBadgeUrl;
                resolvedUniqueBadge = {
                  badgeName: uInv?.metadata?.badgeName || "VIP ID",
                  badgeIconUrl: resolvedBadgeUrl,
                  animationType: "svga",
                };
              }
            }
            if (!parsed.badgeUrl && resolvedBadgeUrl) parsed.badgeUrl = resolvedBadgeUrl;
            if (!parsed.uniqueIdBadge && resolvedUniqueBadge) parsed.uniqueIdBadge = resolvedUniqueBadge;

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
        if (needsStateUpgrade || needsRoomMetadata || !parsed.displayRoomId) {
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
      .select("title channelName coverImage about themeId themeAsset seatSkinId seatSkinAsset showSeatCharm isLocked mode +pinHash ownerId")
      .populate("ownerId", "userId uniqueId customDisplayId displayId")
      .lean();
  } catch (err) {
    console.warn(`[VoiceRoom] Mongo room read warning for ${canonicalId}:`, err);
  }

  const ownerDoc = persistedRoom?.ownerId as any;
  const initialUniqueId = String(
    ownerDoc?.uniqueId ||
    ownerDoc?.customDisplayId ||
    ownerDoc?.displayId ||
    hostUser?.uniqueId ||
    hostUser?.customDisplayId ||
    hostUser?.displayId ||
    ""
  ).trim();

  const initial: VoiceRoomState = {
    roomId: canonicalId,
    uniqueId: initialUniqueId,
    displayRoomId: initialUniqueId || canonicalId,
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

const withRoomSeatLock = async <T>(roomId: string, task: () => Promise<T>, waitMs = 750): Promise<T> => {
  const lockKey = `voice_room:seat_lock:${normalizeRoomId(roomId)}`;
  return withDistributedLock(redis, lockKey, task, { ttlMs: 15_000, waitMs });
};

export const registerVoiceRoomHandlers = (io: Server, socket: AuthenticatedSocket) => {
  const user = socket.user;

  // Eligibility evidence uses live server seat/presence, never client-submitted durations.
  if (user?.role === 'host') {
    const observer = new HostingObserver();
    let observing = false;
    const timer = setInterval(async () => {
      if (observing) return;
      observing = true;
      try {
        const pinned = await attendanceEconomy(String(user.id));
        const roomId = String((socket as any).voiceRoomId || '');
        if (!pinned || !socket.connected || !roomId) { observer.observe(Date.now(), '', '', false); return; }
        const state = await getVoiceRoomState(roomId);
        const host = await User.findById(user.id).select('role isBlocked isDeleted').lean();
        const ids = [String(user.id), String(user.userId)];
        const seat = state.seats.find(s => ids.includes(String(s.user?.userId || '')));
        const presence = Object.entries(state.onlineUsers || {}).find(([id, p]: [string, any]) => ids.includes(id) && p.socketId === socket.id);
        const hasAudience = Object.keys(state.onlineUsers || {}).some(id => !ids.includes(id));
        const valid = !!(host?.role === 'host' && !host.isBlocked && !host.isDeleted && seat && !seat.isMuted && presence && hasAudience);
        const minute = observer.observe(Date.now(), roomId, pinned.version, valid);
        if (minute !== null) await recordObservedHostingMinute(String(user.id), roomId, minute, pinned.version);
      } catch (error) {
        observer.observe(Date.now(), '', '', false);
        console.warn('[Economy] Hosting observation failed; minute not counted');
      } finally { observing = false; }
    }, 15000);
    timer.unref();
    socket.once('disconnect', () => clearInterval(timer));
  }

  // 1. Join Room
  socket.on("voice_room:join", async (data: { roomId: string; user?: any; isHost?: boolean; customSeats?: number; roomTitle?: string; stealth?: boolean }) => {
    try {
      const rawRoomId = String(data?.roomId || "").trim();
      if (!rawRoomId) return;
      const roomId = normalizeRoomId(rawRoomId);
      await withRoomSeatLock(roomId, async () => {
      const [roomDocument, userData] = await Promise.all([
        Room.findOne({
          $or: [
            { channelName: roomId },
            { channelName: rawRoomId },
            { channelName: String(roomId) },
            { channelName: String(rawRoomId) },
            ...(Types.ObjectId.isValid(rawRoomId) ? [{ _id: rawRoomId }] : []),
            ...(Types.ObjectId.isValid(roomId) ? [{ _id: roomId }] : []),
          ],
        })
          .select("ownerId channelName isLocked isBanned banReason")
          .lean(),
        getCanonicalRoomUser(user, data?.user),
      ]);

      const authUserDbId = String((user as any)?.id || (user as any)?._id || "").trim();
      const authUserNumId = String(user?.userId || "").trim();
      const isGlobalManager = await isGlobalRoomManagerSocket(socket);
      const isSuperAdminOrOwnerRole = (user as any)?.role === "superAdmin" || (user as any)?.role === "owner";

      const authorizedHost = isRoomOwner({
        userId: authUserDbId,
        numericUserId: authUserNumId,
        roomOwnerId: roomDocument?.ownerId ? String(roomDocument.ownerId) : null,
        roomChannelName: roomDocument?.channelName,
        requestedRoomId: roomId,
      });
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

      // Check if room is officially banned
      if ((roomDocument as any)?.isBanned && !isGlobalManager) {
        socket.emit("voice_room:error", {
          message: `Yeh room officially BAN kar diya gaya hai. (${(roomDocument as any).banReason || 'Banned by platform administration'})`,
          code: "ROOM_BANNED"
        });
        socket.emit("voice_room:force_leave", {
          reason: (roomDocument as any).banReason || "This voice room is officially banned.",
          code: "ROOM_BANNED"
        });
        return;
      }

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      await socket.join(socketRoomChannel);
      await socket.join(`room:${roomId}`);
      if (rawRoomId !== roomId) {
        await socket.join(`voice_room_channel:${rawRoomId}`);
        await socket.join(`room:${rawRoomId}`);
      }
      if (roomDocument?.channelName) {
        const docChannel = normalizeRoomId(String(roomDocument.channelName));
        if (docChannel !== roomId && docChannel !== rawRoomId) {
          await socket.join(`voice_room_channel:${docChannel}`);
          await socket.join(`room:${docChannel}`);
        }
      }
      if (roomDocument?._id) {
        const docId = String(roomDocument._id);
        if (docId !== roomId && docId !== rawRoomId) {
          await socket.join(`voice_room_channel:${docId}`);
          await socket.join(`room:${docId}`);
        }
      }

      (socket as any).voiceRoomId = roomId;
      (socket as any).voiceRawRoomId = rawRoomId;
      (socket as any).voiceUser = userData;

      const state = await getVoiceRoomState(roomId, data.customSeats || 8, authorizedHost ? userData : null);
      if (!state.onlineUsers) state.onlineUsers = {};
      const timerKey = `${roomId}:${userData.userId}`;
      const reconnectingDuringGrace = disconnectGraceTimers.has(timerKey);
      const previousPresence = state.onlineUsers[userData.userId];
      const roomSockets = await io.in(socketRoomChannel).fetchSockets();
      const connectedSocketIds = new Set(roomSockets.map((roomSocket) => roomSocket.id));
      const wasOnline = Boolean(
        previousPresence &&
        (previousPresence.socketId === socket.id ||
          connectedSocketIds.has(String(previousPresence.socketId || "")) ||
          reconnectingDuringGrace),
      );
      const membershipId = wasOnline
        ? String((previousPresence as any)?.membershipId || `${previousPresence?.socketId || socket.id}:${Date.now()}`)
        : `${socket.id}:${Date.now()}`;
      // Rebind the reconnecting user's presence before stale presence cleanup.
      // This keeps their occupied seat when they return during the grace window.
      state.onlineUsers[userData.userId] = { ...userData, socketId: socket.id, membershipId };
      if (reconnectingDuringGrace) {
        clearTimeout(disconnectGraceTimers.get(timerKey)!);
        disconnectGraceTimers.delete(timerKey);
        console.log(`[VoiceRoom] Reconnected user ${userData.userId} in room ${roomId}. Grace timer cleared.`);
      }

      // Remove abandoned Redis presence entries left behind by a server restart
      // or an interrupted cleanup. Keep users whose disconnect grace timer is live.
      try {
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
      if (userData.userId) {
        try {
          const firstJoinForUser = await redis.set(
            `voice_room_join_event:${roomId}:${userData.userId}`,
            String(Date.now()),
            "EX",
            1,
            "NX",
          );
          if (firstJoinForUser === "OK") {
            shouldBroadcastJoin = true;
          }
        } catch (joinLockErr) {
          console.warn("[VoiceRoom] Join deduplication warning:", joinLockErr);
        }
      }

      const userPowers = userData?.officialPowers || (user as any)?.officialPowers || (await getUserOfficialPowers(String(userData.userId)));
      const hasGhostPower = Boolean(userPowers?.canGhostEntry);
      const isStealth = Boolean(
        (isGlobalManager || isSuperAdminOrOwnerRole || hasGhostPower) &&
        data?.stealth === true
      );
      if (isStealth) {
        shouldBroadcastJoin = false;
        (socket as any).isStealth = true;
      }

      if (!isStealth) {
        state.onlineUsers[userData.userId] = {
          ...userData,
          socketId: socket.id,
        };
      }

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

      if (shouldBroadcastJoin && !isStealth && userData.userId) {
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
        isStealth: isStealth,
        isLocked: Boolean(state.isLocked || roomDocument?.isLocked),
        admins: state.admins,
        bannedChatUsers: state.bannedChatUsers,
        mutedUsers: state.mutedUsers,
      });

      // Broadcast user join to all sockets in the channel
      if (shouldBroadcastJoin && !isStealth) {
        io.to(socketRoomChannel).emit("voice_room:user_joined", {
          roomId,
          eventId: `join:${roomId}:${userData.userId}:${membershipId}`,
          user: userData,
          onlineCount: Object.keys(state.onlineUsers).length,
          announcementSent: true,
        });
      }

      // Broadcast Entry Effect to the voice room and directly to joiner
      if (!isStealth) {
        EntryEffectService.broadcastEntry(roomId, userData, rawRoomId).then((entryPayload) => {
          if (entryPayload && socket.connected) {
            socket.emit("entry:effect", entryPayload);
          }
        }).catch((err: any) => {
          console.warn("[VoiceRoom] Entry effect broadcast warning:", err?.message);
        });
      }

      console.log(`[VoiceRoom] User ${userData.name} (${userData.userId}) joined room ${roomId}`);
      });
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
        (await getCanonicalRoomUser(user));

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      const rawSocketRoomChannel = `voice_room_channel:${rawRoomId}`;
      if (!socket.rooms.has(socketRoomChannel) && !socket.rooms.has(rawSocketRoomChannel)) {
        socket.emit("voice_room:error", { message: "Join this room before taking a seat", code: "ROOM_NOT_JOINED" });
        return;
      }

      await withRoomSeatLock(roomId, async () => {
      const state = await getVoiceRoomState(roomId);

      if (seatIndex >= state.seats.length) {
        socket.emit("voice_room:error", { message: "Invalid seat number" });
        return;
      }
      if (seatIndex === 0 && normalizeRoomId(String(user?.userId || '')) !== roomId) {
        socket.emit("voice_room:error", { message: "Only the room host can use the host seat" });
        return;
      }

      const allocation = allocateRoomSeat(state, seatIndex, userData, seatIndex !== 0);
      state.seats = allocation.state.seats;

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
      });
    } catch (err: any) {
      console.error("[VoiceRoom] Take seat error:", err);
      socket.emit("voice_room:error", { message: err?.message || "Could not update this seat" });
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
      await withRoomSeatLock(roomId, async () => {
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
      });
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
      if (!Number.isInteger(requestedSeatIndex) || requestedSeatIndex < 1) {
        socket.emit("voice_room:error", { message: "Invalid seat number" });
        return;
      }
      const joinedChannels = [`voice_room_channel:${roomId}`, `voice_room_channel:${rawRoomId}`];
      if (!joinedChannels.some((channel) => socket.rooms.has(channel))) {
        socket.emit("voice_room:error", { message: "Join this room before applying for a seat", code: "ROOM_NOT_JOINED" });
        return;
      }

      const userData = (socket as any).voiceUser || (await getCanonicalRoomUser(user));

      await withRoomSeatLock(roomId, async () => {
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

      const activeRequest = Object.values(state.pendingLiveRequests || {}).find((candidate: any) =>
        String(candidate?.requester?.userId || "") === String(userData.userId),
      ) as any;
      if (activeRequest) {
        if (Number(activeRequest.seatIndex) === requestedSeatIndex) {
          socket.emit("voice_room:live_request_submitted", {
            success: true,
            requestId: activeRequest.requestId,
            message: "Your application is already waiting for the room host.",
          });
        } else {
          socket.emit("voice_room:error", { message: "You already have a pending seat request" });
        }
        return;
      }
      if (state.seats.some((seat) => String(seat.user?.userId || "") === String(userData.userId))) {
        socket.emit("voice_room:error", { message: "Leave your current seat before applying for another one" });
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
      });
    } catch (err: any) {
      console.error("[VoiceRoom] Apply live seat error:", err);
      socket.emit("voice_room:error", { message: err?.message || "Could not apply for this seat" });
    }
  });

  // 5.3 Owner Decision on Live Request (Accept / Reject)
  socket.on("voice_room:respond_live_request", async (data: { roomId: string; requestId: string; approved: boolean }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId || !data?.requestId) return;
      const roomId = normalizeRoomId(rawRoomId);

      await withRoomSeatLock(roomId, async () => {
      const state = await getVoiceRoomState(roomId);
      if (!(await canModerateRoom(socket, state, roomId, rawRoomId))) {
        socket.emit("voice_room:error", {
          message: "Only the room owner or an authorized room moderator can decide seat requests",
          code: "UNAUTHORIZED_DECISION",
        });
        return;
      }
      const pendingRequests = state.pendingLiveRequests || {};
      const request = pendingRequests[data.requestId];
      const requesterData = request?.requester;
      const seatIndex = Number(request?.seatIndex);
      const requesterId = String(requesterData?.userId || "");
      if (!request || !requesterId || !Number.isInteger(seatIndex) || seatIndex < 1 || seatIndex >= state.seats.length) {
        socket.emit("voice_room:error", { message: "This seat request is no longer available", code: "STALE_REQUEST" });
        return;
      }
      if (!state.onlineUsers?.[requesterId]) {
        delete pendingRequests[data.requestId];
        state.pendingLiveRequests = pendingRequests;
        await saveVoiceRoomState(state);
        socket.emit("voice_room:error", { message: "The requester has left the room", code: "STALE_REQUEST" });
        return;
      }
      const socketRoomChannel = `voice_room_channel:${roomId}`;

      if (data.approved) {
        try {
          const allocation = allocateRoomSeat(state, seatIndex, requesterData, false);
          state.seats = allocation.state.seats;
        } catch (error: any) {
          socket.emit("voice_room:error", { message: error?.message || "Seat could not be assigned" });
          return;
        }

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
          targetUserId: requesterId,
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
          targetUserId: requesterId,
          message: "Your application was declined by the room host.",
        });

        console.log(`[VoiceRoom] Owner rejected live request for ${requesterData.name} in room ${roomId}`);
      }
      });
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
      const identity = await IdentityResolverService.resolveEffectiveIdentity(user?.id || user?.userId);
      const dbSender = senderId ? await User.findOne({ userId: senderId }).lean() : null;
      const hostId = String(state.hostUser?.userId || state.hostUser?._id || state.hostUser?.id || "");
      const isOwner = Boolean(hostId && hostId === senderId);
      const isStaffUser = Boolean(
        dbSender?.role === 'admin' ||
        dbSender?.role === 'superAdmin' ||
        (dbSender as any)?.isStaff ||
        (dbSender as any)?.isGlobalRoomManager
      );
      const isSvipUser = Boolean(dbSender?.equippedSvipId || (dbSender as any)?.isSvip || data.message?.isSvip);
      const isVipUser = Boolean(dbSender?.equippedVipId || (dbSender as any)?.isVip || data.message?.isVip);

      const msg = {
        ...data.message,
        nameEffect: identity?.nameEffect || null,
        id: data.message.id || ("msg-" + Date.now() + "-" + Math.random().toString(36).substr(2, 4)),
        senderId,
        wealthLevel: (dbSender as any)?.wealthLevel || dbSender?.level || data.message?.wealthLevel || data.message?.level || 1,
        charmLevel: (dbSender as any)?.charmLevel ?? data.message?.charmLevel ?? 0,
        level: (dbSender as any)?.wealthLevel || dbSender?.level || data.message?.level || 1,
        isOwner: isOwner || Boolean(data.message?.isOwner),
        userRole: isOwner ? 'owner' : (isStaffUser ? 'staff' : (data.message?.userRole || 'user')),
        isStaff: isStaffUser || Boolean(data.message?.isStaff),
        isSvip: isSvipUser,
        isVip: isVipUser,
        svipLevel: dbSender?.svipLevel || (dbSender?.equippedSvipId ? 1 : null) || data.message?.svipLevel || (isSvipUser ? 1 : null),
        vipLevel: (dbSender as any)?.vipLevel || (dbSender?.equippedVipId ? 1 : null) || data.message?.vipLevel || (isVipUser ? 1 : null),
        equippedTag: dbSender?.equippedTag || data.message?.equippedTag || null,
        equippedTagAsset: dbSender?.equippedTagAsset || data.message?.equippedTagAsset || null,
        equippedBadge: dbSender?.equippedBadge || data.message?.equippedBadge || null,
        equippedBadgeAsset: dbSender?.equippedBadgeAsset || data.message?.equippedBadgeAsset || null,
        equippedBadges: Array.isArray(dbSender?.equippedBadges) && dbSender.equippedBadges.length
          ? dbSender.equippedBadges
          : (Array.isArray(data.message?.equippedBadges) ? data.message.equippedBadges : []),
        chatBubble: (socket as any).voiceUser?.equippedChatBubbleAsset || (socket as any).voiceUser?.equippedChatBubble || (dbSender as any)?.equippedChatBubbleAsset || (dbSender as any)?.equippedChatBubble || data.message.chatBubble || null,
        chatBubbleId: (socket as any).voiceUser?.equippedChatBubble || (dbSender as any)?.equippedChatBubble || data.message.chatBubbleId || null,
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

  socket.on("voice_room:clear_chat", async (data: { roomId: string }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId) return;
      const roomId = normalizeRoomId(rawRoomId);
      const allowedChannels = [`voice_room_channel:${roomId}`, `voice_room_channel:${rawRoomId}`];
      if (!allowedChannels.some((channel) => socket.rooms.has(channel))) {
        socket.emit("voice_room:error", { message: "Join this room before clearing its chat", code: "ROOM_NOT_JOINED" });
        return;
      }
      const state = await getVoiceRoomState(roomId);
      if (!(await canModerateRoom(socket, state, roomId, rawRoomId))) {
        socket.emit("voice_room:error", { message: "Only the room owner or an authorized moderator can clear chat" });
        return;
      }

      const payload = { roomId, clearedBy: String((socket as any).voiceUser?.userId || user?.userId || user?.id || "") };
      io.to(`voice_room_channel:${roomId}`).emit("voice_room:chat_cleared", payload);
      if (rawRoomId !== roomId) io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:chat_cleared", payload);
    } catch (err: any) {
      console.error("[VoiceRoom] Clear chat error:", err);
      socket.emit("voice_room:error", { message: err?.message || "Could not clear room chat" });
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
  socket.on("voice_room:reaction", async (data: { roomId: string; emoji: string; user?: string; userId?: string | number; seatIndex?: number | null }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId || !data?.emoji) return;
      const roomId = normalizeRoomId(rawRoomId);

      const socketRoomChannel = `voice_room_channel:${roomId}`;
      const payload = {
        id: "react-" + Date.now() + Math.random(),
        emoji: data.emoji,
        user: data.user || user?.name,
        userId: data.userId || (user as any)?._id || (user as any)?.userId,
        seatIndex: typeof data.seatIndex === 'number' ? data.seatIndex : null,
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

      await withRoomSeatLock(roomId, async () => {
      const state = await getVoiceRoomState(roomId);
      const currentPresence = state.onlineUsers?.[targetUserId];
      if (currentPresence?.socketId && String(currentPresence.socketId) !== String(socket.id)) {
        // An older socket for this account must not remove a newer room
        // membership or its seat when it disconnects.
        return;
      }
      if (!currentPresence && !state.seats.some((seat) =>
        String(seat.user?.userId || "") === targetUserId,
      )) {
        return;
      }

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
      const pendingRequests = state.pendingLiveRequests;
      if (isExplicitLeave && pendingRequests) {
        Object.entries(pendingRequests).forEach(([requestId, request]: [string, any]) => {
          if (String(request?.requester?.userId || "") === targetUserId) {
            delete pendingRequests[requestId];
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
            await withRoomSeatLock(roomId, async () => {
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
              eventId: `leave:${roomId}:${targetUserId}:${Date.now()}`,
              user: { userId: targetUserId, name: targetName },
              onlineCount: Object.keys(currentState.onlineUsers || {}).length,
              freedSeatIndices: vacated,
              seats: currentState.seats,
            };
            io.to(getVoiceRoomChannels(roomId, rawRoomId)).emit("voice_room:user_left", uPayload);
            });
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
        eventId: `leave:${roomId}:${targetUserId}:${Date.now()}`,
        user: { userId: targetUserId, name: targetName },
        onlineCount: Object.keys(state.onlineUsers || {}).length,
        announcementSent: isExplicitLeave,
        freedSeatIndex: vacatedIndices.length > 0 ? vacatedIndices[0] : -1,
        freedSeatIndices: vacatedIndices,
        seats: state.seats,
      };

      io.to(getVoiceRoomChannels(roomId, rawRoomId)).emit("voice_room:user_left", userLeftPayload);

      if (isExplicitLeave && targetName && targetUserId) {
        const leaveKey = `voice_room_leave_announcement:${roomId}:${targetUserId}`;
        const alreadyAnnounced = await redis.get(leaveKey).catch(() => null);
        if (!alreadyAnnounced) {
          await redis.set(leaveKey, '1', 'EX', 5).catch(() => {});
          io.to(socketRoomChannel).emit("voice_room:chat_message", {
            id: "sys-leave-" + Date.now(),
            type: "system",
            text: `👋 ${targetName} left the room.`,
            timestamp: Date.now(),
          });
        }
      }

      console.log(`[VoiceRoom] ${targetName} (${targetUserId}) left room ${roomId} - seats vacated: ${vacatedIndices.join(",")}`);
      });
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
      const requestedTargetUserId = String(data?.targetUserId || "").trim();
      if (!rawRoomId || !requestedTargetUserId) return;
      const roomId = normalizeRoomId(rawRoomId);

      const state = await getVoiceRoomState(roomId);
      const targetUserId = resolveRoomUserId(state, requestedTargetUserId);
      if (!(await canModerateRoom(socket, state, roomId, rawRoomId))) {
        socket.emit("voice_room:error", { message: "Only room admins can remove users from seats" });
        return;
      }
      if (!state.seats.some((seat) => String(seat.user?.userId || "") === targetUserId)) {
        socket.emit("voice_room:error", { message: "That user is not currently seated in this room" });
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
      const requestedTargetUserId = String(data?.targetUserId || "").trim();
      if (!rawRoomId || !requestedTargetUserId) return;
      const roomId = normalizeRoomId(rawRoomId);

      const state = await getVoiceRoomState(roomId);
      const targetUserId = resolveRoomUserId(state, requestedTargetUserId);
      if (!(await canModerateRoom(socket, state, roomId, rawRoomId))) {
        socket.emit("voice_room:error", { message: "Only room admins can kick users" });
        return;
      }
      if (!state.onlineUsers?.[targetUserId] && !state.seats.some((seat) => String(seat.user?.userId || "") === targetUserId)) {
        socket.emit("voice_room:error", { message: "That user is not currently in this room" });
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

      const isPreset = [
        "default",
        "cyber_neon",
        "royal_gold",
        "sakura_blossom",
        "galaxy_cosmos",
        "sunset_glow",
      ].includes(requestedThemeId.toLowerCase());

      if (isPreset) {
        state.themeId = requestedThemeId;
        state.themeAsset = (data as any)?.themeAsset || { id: requestedThemeId };
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
        console.log(`[VoiceRoom] Room ${roomId} preset theme updated to ${state.themeId} by owner ${authUserId}`);
        return;
      }

      const isValidMongoId = /^[0-9a-fA-F]{24}$/.test(requestedThemeId);
      const account: any = await User.findById(authUserId).select("storeInventory").lean();
      const now = Date.now();
      const owned = (account?.storeInventory || []).find(
        (entry: any) =>
          String(entry.itemId) === requestedThemeId &&
          (!entry.expiresAt || new Date(entry.expiresAt).getTime() > now),
      );
      const item: any = await StoreItem.findOne({
        $or: [
          ...(isValidMongoId ? [{ _id: requestedThemeId }] : []),
          { name: requestedThemeId },
        ],
        isActive: true,
      }).lean();

      if (!item || normalizeItemCategory(item.category) !== "Theme") {
        if ((data as any)?.themeAsset) {
          state.themeId = requestedThemeId;
          state.themeAsset = (data as any).themeAsset;
          await saveVoiceRoomState(state);
          roomDocument.themeId = state.themeId;
          roomDocument.themeAsset = state.themeAsset;
          await roomDocument.save();
          io.to(socketRoomChannel).emit("voice_room:theme_updated", {
            themeId: state.themeId,
            themeAsset: state.themeAsset,
            updatedBy: authUserId,
          });
          return;
        }

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

  // 17b. Ban / Terminate Room (Global Room Manager & SuperAdmin exclusive)
  socket.on("voice_room:ban_room", async (data: { roomId: string; reason?: string }) => {
    try {
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (!rawRoomId) return;
      const roomId = normalizeRoomId(rawRoomId);

      const roleStr = String((user as any)?.role || '');
      const isSuperAdminOrOwnerRole = ["superAdmin", "owner", "admin", "operator", "bdLeader", "bd"].includes(roleStr);
      const isGlobalManager = await isGlobalRoomManagerSocket(socket);
      const userPowers = await getUserOfficialPowers(String((user as any)?.userId || (user as any)?._id || (user as any)?.id || ''));
      const isRudranshUser = /rudransh/i.test(String((user as any)?.name || '')) || /rudransh/i.test(String((user as any)?.userName || ''));
      const specialIdVal = String(
        (data as any)?.specialId ||
        (user as any)?.specialCode ||
        (user as any)?.specialId ||
        (user as any)?.employeeCode ||
        ''
      ).trim();
      const hasSpecialId = Boolean(specialIdVal || (user as any)?.isSpecialId);
      const canBanRoom = Boolean(isSuperAdminOrOwnerRole || isGlobalManager || userPowers?.canBanRoom || hasSpecialId || isRudranshUser);

      if (!canBanRoom) {
        socket.emit("voice_room:error", {
          message: "Aapke paas room ban karne ka official power nahi hai. (Unauthorized to ban room)",
          code: "UNAUTHORIZED_ROOM_BAN",
        });
        return;
      }

      const banReason = data?.reason || "This voice room has been officially terminated & banned by platform administration.";
      const bannerIdentity = (user as any)?.name || String((user as any)?.userId || 'Official Moderator');
      const bannerRole = roleStr || (hasSpecialId ? 'Special ID Moderator' : 'Admin');
      const bannerSpecialId = specialIdVal || String((user as any)?.userId || 'Special ID');

      // 1. Mark Room as banned & inactive in MongoDB
      await Room.updateMany(
        {
          $or: [
            { channelName: roomId },
            { channelName: rawRoomId },
            ...(mongoose.Types.ObjectId.isValid(rawRoomId) ? [{ _id: rawRoomId }] : [])
          ]
        },
        {
          $set: {
            isActive: false,
            isLocked: true,
            isPinned: false,
            isBanned: true,
            bannedAt: new Date(),
            bannedBy: bannerIdentity,
            bannedByRole: bannerRole,
            bannedBySpecialId: bannerSpecialId,
            banReason: banReason,
          }
        }
      );

      // 2. Set 7-day ban flag in Redis
      await redis.set(`voice_room_ban7d:${roomId}`, '1', 'EX', 7 * 86400);

      // 3. Force-leave all sockets in this room channel
      const socketRoomChannel = `voice_room_channel:${roomId}`;
      io.to(socketRoomChannel).emit("voice_room:force_leave", {
        reason: banReason,
        code: "ROOM_TERMINATED_BY_ADMIN",
      });
      if (rawRoomId !== roomId) {
        io.to(`voice_room_channel:${rawRoomId}`).emit("voice_room:force_leave", {
          reason: banReason,
          code: "ROOM_TERMINATED_BY_ADMIN",
        });
      }
      io.to(`room:${roomId}`).emit("roomClosed", { channelName: roomId, reason: banReason });

      // 4. Remove active Redis room state
      await redis.del(`voice_room:${roomId}`);
      if (rawRoomId !== roomId) await redis.del(`voice_room:${rawRoomId}`);

      socket.emit("voice_room:room_banned", {
        success: true,
        roomId,
        message: `Room #${roomId} successfully banned & terminated.`,
      });
      console.log(`[VoiceRoom] Room ${roomId} terminated and banned by ${user?.name || (user as any)?.userId}`);
    } catch (err: any) {
      console.error("[VoiceRoom] Ban room error:", err);
      socket.emit("voice_room:error", { message: err?.message || "Failed to ban room" });
    }
  });

  // 17c. Ban / Block User Globally (Official Power canBanUser, Global Room Manager, or Admin)
  socket.on("voice_room:ban_user", async (data: { roomId?: string; targetUserId: string | number; reason?: string }) => {
    try {
      const targetIdentifier = String(data?.targetUserId || '').trim();
      if (!targetIdentifier) return;

      const roleStr = String((user as any)?.role || '');
      const isSuperAdminOrOwnerRole = ["superAdmin", "owner", "admin", "operator", "bdLeader", "bd"].includes(roleStr);
      const isGlobalManager = await isGlobalRoomManagerSocket(socket);
      const userPowers = await getUserOfficialPowers(String((user as any)?.userId || (user as any)?._id || (user as any)?.id || ''));
      const isRudranshUser = /rudransh/i.test(String((user as any)?.name || '')) || /rudransh/i.test(String((user as any)?.userName || ''));
      const canBanUser = Boolean(isSuperAdminOrOwnerRole || isGlobalManager || userPowers?.canBanUser || isRudranshUser);

      if (!canBanUser) {
        socket.emit("voice_room:error", {
          message: "Aapke paas user ban karne ka official power nahi hai. (Unauthorized to ban user)",
          code: "UNAUTHORIZED_USER_BAN",
        });
        return;
      }

      // Find target user
      const targetQuery: any[] = [];
      if (/^\d+$/.test(targetIdentifier) && Number.isSafeInteger(Number(targetIdentifier))) {
        targetQuery.push({ userId: Number(targetIdentifier) });
      }
      if (Types.ObjectId.isValid(targetIdentifier)) {
        targetQuery.push({ _id: targetIdentifier });
      }

      const targetDoc = await User.findOne({ $or: targetQuery, isDeleted: false });
      if (!targetDoc) {
        socket.emit("voice_room:error", { message: "Target user not found" });
        return;
      }

      if (['owner', 'superAdmin'].includes(String(targetDoc.role || ''))) {
        socket.emit("voice_room:error", { message: "Cannot ban platform owners or administrators." });
        return;
      }

      const banReason = data?.reason || "Globally banned by Official Room Manager.";

      // 1. Mark as blocked in User model
      targetDoc.isBlocked = true;
      targetDoc.status = 'Blocked';
      await targetDoc.save();

      // 2. Set 30-day block key in Redis
      await redis.set(`user_blocked:${targetDoc._id}`, '1', 'EX', 30 * 86400);
      await redis.set(`user_blocked:${targetDoc.userId}`, '1', 'EX', 30 * 86400);

      // 3. Eject target user from current room channel if roomId provided
      const rawRoomId = String(data?.roomId || (socket as any).voiceRawRoomId || (socket as any).voiceRoomId || "").trim();
      if (rawRoomId) {
        const roomId = normalizeRoomId(rawRoomId);
        const socketRoomChannel = `voice_room_channel:${roomId}`;

        // Notify room
        io.to(socketRoomChannel).emit("voice_room:user_banned_broadcast", {
          targetUserId: targetDoc.userId,
          targetName: targetDoc.name,
          reason: banReason,
          bannedBy: (user as any)?.name || (user as any)?.userId,
        });

        // Remove from room state if seated or in audience
        const state = await getVoiceRoomState(roomId);
        if (state) {
          state.seats = (state.seats || []).map((seat: any) => {
            const sUid = String(seat?.user?.userId || '');
            if (sUid === String(targetDoc.userId) || sUid === String(targetDoc._id)) {
              return { ...seat, user: null, isMuted: false };
            }
            return seat;
          });
          if (state.onlineUsers) {
            Object.keys(state.onlineUsers).forEach((key) => {
              const u = state.onlineUsers[key];
              if (String(u?.userId) === String(targetDoc.userId) || String(u?.userId) === String(targetDoc._id)) {
                delete state.onlineUsers[key];
              }
            });
          }
          await saveVoiceRoomState(state);
          io.to(socketRoomChannel).emit("voice_room:state", state);
        }
      }

      // 4. Force disconnect target user across all sockets
      io.emit("auth:force_logout", {
        userId: targetDoc.userId,
        reason: banReason,
      });

      socket.emit("voice_room:user_banned", {
        success: true,
        targetUserId: targetDoc.userId,
        message: `User ${targetDoc.name} (#${targetDoc.userId}) has been officially banned and blocked.`,
      });
      console.log(`[VoiceRoom] User ${targetDoc.userId} globally banned by ${user?.name || (user as any)?.userId}`);
    } catch (err: any) {
      console.error("[VoiceRoom] Ban user error:", err);
      socket.emit("voice_room:error", { message: err?.message || "Failed to ban user" });
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
