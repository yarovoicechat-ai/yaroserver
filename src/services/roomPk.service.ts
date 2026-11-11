import { Types } from 'mongoose';
import { Room } from '../models/room.model';
import { RoomPK } from '../models/roomPk.model';
import { GiftTransaction } from '../gift/gift.model';
import redis from '../configs/redisConfig';
import { withDistributedLock } from '../utils/distributedLock';
import { normalizePKRoomId, ROOM_PK_DURATION_MS, ROOM_PK_INVITE_MS, ROOM_PK_SETTLE_MS, roomPKResult } from '../utils/roomPkRules';

export class RoomPKError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

async function resolveRoom(value: unknown): Promise<any> {
  const raw = String(value || '').trim(), canonical = normalizePKRoomId(raw);
  if (!raw || raw.length > 128) throw new RoomPKError('Enter a valid room ID');
  const room = await Room.findOne({ $or: [
    { channelName: { $in: [raw, canonical] } }, { uniqueId: raw }, { customDisplayId: raw },
    ...(Types.ObjectId.isValid(raw) ? [{ _id: raw }] : []),
  ] }).populate('ownerId', 'userId name image avatar').lean();
  if (!room || room.isBanned || !room.isActive) throw new RoomPKError('This room is not available for PK', 404);
  return room;
}

function ownerId(room: any) { return String(room.ownerId?._id || room.ownerId || ''); }
function actorId(user: any) { return String(user?.id || user?._id || ''); }
function requireOwner(room: any, user: any) {
  if (!actorId(user) || ownerId(room) !== actorId(user)) throw new RoomPKError('Only the room owner can manage its PK', 403);
}
function roomSummary(room: any) {
  return { id: normalizePKRoomId(room.channelName), title: room.title,
    coverImage: room.coverImage || room.ownerId?.image || room.ownerId?.avatar || '',
    ownerId: ownerId(room), hostName: room.ownerId?.name || 'Host' };
}
async function liveState(room: any) {
  const { getVoiceRoomState } = await import('../sockets/voiceRoomSocket');
  return getVoiceRoomState(normalizePKRoomId(room.channelName));
}
async function requireLiveHost(room: any) {
  const state = await liveState(room);
  const ids = [ownerId(room), String(room.ownerId?.userId || '')].filter(Boolean);
  if (!Object.values(state.onlineUsers || {}).some((person: any) =>
    [person.userId, person.id, person._id].some(id => id && ids.includes(String(id))))) {
    throw new RoomPKError('Both room owners must be online in their rooms to start PK');
  }
}

export function pkSnapshot(match: any, now = Date.now()) {
  if (!match) return null;
  return { id: String(match._id), roomIds: match.roomIds, rooms: match.rooms, status: match.status,
    scores: match.scores, durationSeconds: 300, inviteExpiresAt: match.inviteExpiresAt,
    startedAt: match.startedAt, endsAt: match.endsAt, winnerRoomId: match.winnerRoomId,
    loserRoomId: match.loserRoomId, draw: match.draw, finishedAt: match.finishedAt,
    updatedAt: match.updatedAt, serverNow: now };
}

async function publish(match: any) {
  const { getIOOptional } = await import('../sockets');
  const io = getIOOptional();
  if (!io || !match) return;
  for (const roomId of match.roomIds) {
    io.to([`voice_room_channel:${roomId}`, `room:${roomId}`]).emit('room_pk:state', pkSnapshot(match));
  }
}

export async function refreshPK(id: string, now = Date.now()): Promise<any> {
  if (!Types.ObjectId.isValid(id)) throw new RoomPKError('Invalid PK match', 404);
  return withDistributedLock(redis, `room_pk:match:${id}`, async () => {
    let match = await RoomPK.findById(id).lean() as any;
    if (!match || !match.isOpen) return match;
    if (match.status === 'invited' && new Date(match.inviteExpiresAt).getTime() <= now) {
      match = await RoomPK.findOneAndUpdate({ _id: id, status: 'invited' },
        { $set: { status: 'expired', isOpen: false, finishedAt: new Date(now) } }, { new: true }).lean();
      await publish(match);
    } else if (match.status === 'active') {
      // Scores come from committed gift receipts, never client supplied totals.
      const totals = await GiftTransaction.aggregate([
        { $match: { 'meta.pkId': id, status: { $in: ['SUCCESS', 'COMPLETED'] },
          createdAt: { $gte: new Date(match.startedAt), $lt: new Date(match.endsAt) } } },
        { $group: { _id: '$meta.pkSide', total: { $sum: '$totalDiamonds' } } },
      ]);
      const scores = [0, 0];
      for (const total of totals) if ([0, 1].includes(total._id)) scores[total._id] = total.total;
      const finished = now >= new Date(match.endsAt).getTime() + ROOM_PK_SETTLE_MS;
      const changed = scores.some((score, side) => score !== match.scores[side]);
      if (changed || finished) {
        const update = { scores, ...(finished ? { status: 'finished', isOpen: false,
          finishedAt: new Date(now), ...roomPKResult(match.roomIds, scores) } : {}) };
        match = await RoomPK.findOneAndUpdate({ _id: id, status: 'active', isOpen: true },
          { $set: update }, { new: true }).lean();
        await publish(match);
      }
    }
    return match;
  }, { ttlMs: 15000, waitMs: 1500 });
}

async function releaseExpiredRooms(roomIds: string[]) {
  const now = Date.now();
  const matches = await RoomPK.find({ roomIds: { $in: roomIds }, isOpen: true }).lean();
  for (const match of matches) {
    if ((match.status === 'invited' && new Date(match.inviteExpiresAt).getTime() <= now) ||
        (match.status === 'active' && new Date(match.endsAt).getTime() + ROOM_PK_SETTLE_MS <= now)) {
      await refreshPK(String(match._id), now);
    }
  }
}

export async function invitePK(roomId: string, targetRoomId: string, user: any) {
  const [own, opponent] = await Promise.all([resolveRoom(roomId), resolveRoom(targetRoomId)]);
  requireOwner(own, user);
  const ids = [normalizePKRoomId(own.channelName), normalizePKRoomId(opponent.channelName)];
  if (ids[0] === ids[1] || ownerId(own) === ownerId(opponent)) throw new RoomPKError('Choose a different room for PK');
  await Promise.all([requireLiveHost(own), requireLiveHost(opponent)]);
  await releaseExpiredRooms(ids);
  await RoomPK.init();
  try {
    const match = await RoomPK.create({ roomIds: ids, busyRoomIds: ids,
      rooms: [roomSummary(own), roomSummary(opponent)], invitedBy: actorId(user),
      inviteExpiresAt: new Date(Date.now() + ROOM_PK_INVITE_MS) });
    await publish(match);
    return pkSnapshot(match);
  } catch (error: any) {
    if (error.code === 11000) throw new RoomPKError('One of these rooms already has a PK or pending invitation', 409);
    throw error;
  }
}

export async function respondPK(id: string, roomId: string, decision: string, user: any) {
  if (!['accept', 'decline', 'cancel'].includes(decision)) throw new RoomPKError('Invalid PK response');
  const own = await resolveRoom(roomId);
  requireOwner(own, user);
  await refreshPK(id);
  return withDistributedLock(redis, `room_pk:match:${id}`, async () => {
    const match = await RoomPK.findById(id).lean() as any;
    if (!match || match.status !== 'invited' || !match.isOpen) throw new RoomPKError('This PK invitation is no longer available', 409);
    const side = match.roomIds.indexOf(normalizePKRoomId(own.channelName));
    if (side < 0 || (decision === 'cancel' ? side !== 0 : side !== 1)) throw new RoomPKError('You cannot respond to this invitation', 403);
    let update: any;
    if (decision === 'accept') {
      const opponent = await resolveRoom(match.roomIds[0]);
      if (ownerId(opponent) !== match.rooms[0].ownerId) throw new RoomPKError('Room ownership changed. Send a new invitation.', 409);
      await Promise.all([requireLiveHost(own), requireLiveHost(opponent)]);
      const now = Date.now();
      if (new Date(match.inviteExpiresAt).getTime() <= now) throw new RoomPKError('PK invitation expired', 409);
      update = { status: 'active', startedAt: new Date(now), endsAt: new Date(now + ROOM_PK_DURATION_MS), scores: [0, 0] };
    } else update = { status: decision === 'cancel' ? 'cancelled' : 'declined', isOpen: false, finishedAt: new Date() };
    const changed = await RoomPK.findOneAndUpdate({ _id: id, status: 'invited', isOpen: true }, { $set: update }, { new: true }).lean();
    if (!changed) throw new RoomPKError('PK invitation already handled', 409);
    await publish(changed);
    return pkSnapshot(changed);
  }, { ttlMs: 15000, waitMs: 1500 });
}

export async function currentPK(roomId: string) {
  const room = await resolveRoom(roomId);
  const id = normalizePKRoomId(room.channelName);
  const match = await RoomPK.findOne({ roomIds: id, $or: [{ isOpen: true },
    { status: 'finished', finishedAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) } }] })
    .sort({ isOpen: -1, createdAt: -1 }).lean() as any;
  return pkSnapshot(match?.isOpen ? await refreshPK(String(match._id)) : match);
}

export async function pkHistory(roomId: string) {
  const room = await resolveRoom(roomId);
  const matches = await RoomPK.find({ roomIds: normalizePKRoomId(room.channelName), status: 'finished' })
    .sort({ finishedAt: -1 }).limit(20).lean();
  return matches.map(match => pkSnapshot(match));
}

export async function pkOpponents(roomId: string) {
  const own = await resolveRoom(roomId);
  const rooms = await Room.find({ isActive: true, isBanned: { $ne: true }, isLocked: { $ne: true },
    ownerId: { $ne: own.ownerId?._id || own.ownerId } }).populate('ownerId', 'userId name image avatar')
    .sort({ updatedAt: -1 }).limit(40).lean();
  const open = await RoomPK.find({ isOpen: true }).select('roomIds').lean();
  const busy = new Set(open.flatMap(match => match.roomIds));
  const result = [];
  for (const room of rooms) {
    if (busy.has(normalizePKRoomId(room.channelName))) continue;
    try { await requireLiveHost(room); result.push(roomSummary(room)); } catch { /* Only list live hosts. */ }
  }
  return result;
}

/** Capture server-verified room eligibility before a successful gift receipt is written. */
export async function capturePKGift(roomId: string, sender: any, receivers: any[]) {
  const canonical = normalizePKRoomId(roomId), now = new Date();
  const match = await RoomPK.findOne({ roomIds: canonical, status: 'active', isOpen: true,
    startedAt: { $lte: now }, endsAt: { $gt: now } }).select('roomIds').lean() as any;
  if (!match) return {};
  const { getVoiceRoomState } = await import('../sockets/voiceRoomSocket');
  const state = await getVoiceRoomState(canonical);
  const senderIds = [String(sender._id), String(sender.userId)];
  const present = Object.values(state.onlineUsers || {}).some((person: any) =>
    [person.userId, person.id, person._id].some(id => id && senderIds.includes(String(id))));
  const eligible = present && receivers.every(rec => state.seats.some(seat =>
    seat.user && [rec._id, rec.userId].some(id => id && [seat.user?.userId, (seat.user as any)?.id, (seat.user as any)?._id].map(String).includes(String(id)))));
  return eligible ? { pkId: String(match._id), pkSide: match.roomIds.indexOf(canonical) } : {};
}

export async function notifyPKGift(meta: any) {
  if (meta?.pkId) await refreshPK(meta.pkId);
}

let scheduler: ReturnType<typeof setInterval> | null = null;
export function startRoomPKScheduler() {
  if (scheduler) return;
  let running = false;
  scheduler = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      const due = await RoomPK.find({ isOpen: true, $or: [
        { status: 'invited', inviteExpiresAt: { $lte: now } },
        { status: 'active', endsAt: { $lte: new Date(now.getTime() - ROOM_PK_SETTLE_MS) } },
      ] }).select('_id').limit(50).lean();
      for (const match of due) await refreshPK(String(match._id));
    } catch (error: any) { console.warn('[RoomPK] Scheduler notice:', error?.message); }
    finally { running = false; }
  }, 1000);
  scheduler.unref();
}
