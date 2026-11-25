import { Types } from 'mongoose';
import { Room } from '../models/room.model';
import { RoomPK } from '../models/roomPk.model';
import { RoomPKVote } from '../models/roomPkVote.model';
import { Gift } from '../gift/gift.model';
import { GiftTransaction } from '../gift/gift.model';
import redis from '../configs/redisConfig';
import { withDistributedLock } from '../utils/distributedLock';
import { normalizePKRoomId, ROOM_PK_INVITE_MS, ROOM_PK_SETTLE_MS, roomPKResult } from '../utils/roomPkRules';

export class RoomPKError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const VALID_PK_DURATIONS = [60, 180, 300, 600, 900, 1800];

async function resolveRoom(value: unknown): Promise<any> {
  const raw = String(value || '').trim(), canonical = normalizePKRoomId(raw);
  if (!raw || raw.length > 128) throw new RoomPKError('Enter a valid User ID or Room ID');
  let room = await Room.findOne({ $or: [
    { channelName: { $in: [raw, canonical] } }, { uniqueId: raw }, { customDisplayId: raw },
    ...(Types.ObjectId.isValid(raw) ? [{ _id: raw }] : []),
  ] }).populate('ownerId', 'userId name image avatar').lean();

  if (!room && /^\d+$/.test(raw)) {
    const { User } = await import('../models/user.model');
    const userDoc = await User.findOne({ userId: Number(raw) }).select('_id').lean();
    if (userDoc) {
      room = await Room.findOne({ ownerId: userDoc._id }).populate('ownerId', 'userId name image avatar').lean();
    }
  }

  if (!room || room.isBanned || !room.isActive) throw new RoomPKError('This user or room is not available for PK', 404);
  return room;
}

function ownerId(room: any) { return String(room.ownerId?._id || room.ownerId || ''); }
function actorId(user: any) { return String(user?.id || user?._id || ''); }
function requireOwner(room: any, user: any) {
  const currentActor = actorId(user);
  if (!currentActor) throw new RoomPKError('Authentication required to manage PK', 401);
  const isDirectOwner = ownerId(room) === currentActor;
  const isSystemAdmin = user?.role === 'admin' || user?.role === 'owner';
  const isRoomAdmin = Array.isArray(room.admins) && room.admins.some((a: any) => String(a?._id || a) === currentActor);
  if (!isDirectOwner && !isSystemAdmin && !isRoomAdmin) {
    throw new RoomPKError('Only the room owner or authorized room admin can manage its PK', 403);
  }
}

function roomSummary(room: any) {
  return {
    id: normalizePKRoomId(room.channelName),
    title: room.title,
    coverImage: room.coverImage || room.ownerId?.image || room.ownerId?.avatar || '',
    ownerId: ownerId(room),
    hostName: room.ownerId?.name || 'Host',
    userId: room.ownerId?.userId ? String(room.ownerId.userId) : String(room.channelName || '').replace(/^room_/, ''),
  };
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
  return {
    id: String(match._id),
    roomIds: match.roomIds,
    rooms: match.rooms,
    status: match.status,
    scores: match.scores || [0, 0],
    votes: match.votes || [0, 0],
    durationSeconds: match.durationSeconds || 300,
    inviteExpiresAt: match.inviteExpiresAt,
    startedAt: match.startedAt,
    endsAt: match.endsAt,
    pkType: match.pkType || 'user',
    pkMode: match.pkMode || (match.pkType === 'room' ? 'room' : 'personal'),
    participantA: match.participantA || null,
    participantB: match.participantB || null,
    teamA: match.teamA || [],
    teamB: match.teamB || [],
    selectedGiftId: match.selectedGiftId || null,
    selectedGift: match.selectedGift || null,
    jackpotEnabled: Boolean(match.jackpotEnabled),
    leftContributors: match.leftContributors || [],
    rightContributors: match.rightContributors || [],
    winnerSide: match.winnerSide ?? null,
    winnerRoomId: match.winnerRoomId || null,
    loserRoomId: match.loserRoomId || null,
    draw: Boolean(match.draw),
    finishedAt: match.finishedAt,
    updatedAt: match.updatedAt,
    serverNow: now,
  };
}

async function publish(match: any) {
  const { getIOOptional } = await import('../sockets');
  const io = getIOOptional();
  if (!io || !match) return;
  const snapshot = pkSnapshot(match);
  for (const roomId of match.roomIds) {
    io.to([`voice_room_channel:${roomId}`, `room:${roomId}`]).emit('room_pk:state', snapshot);
  }
}

export async function refreshPK(id: string, now = Date.now()): Promise<any> {
  if (!Types.ObjectId.isValid(id)) throw new RoomPKError('Invalid PK match', 404);
  return withDistributedLock(redis, `room_pk:match:${id}`, async () => {
    let match = await RoomPK.findById(id).lean() as any;
    if (!match || !match.isOpen) return match;

    if (match.status === 'invited' && new Date(match.inviteExpiresAt).getTime() <= now) {
      match = await RoomPK.findOneAndUpdate(
        { _id: id, status: 'invited' },
        { $set: { status: 'expired', isOpen: false, finishedAt: new Date(now) } },
        { new: true }
      ).lean();
      await publish(match);
      return match;
    }

    if (match.status === 'active') {
      const finished = now >= new Date(match.endsAt).getTime() + ROOM_PK_SETTLE_MS;

      if (match.pkMode === 'vote') {
        // Vote counts come from verified RoomPKVote records
        const voteCounts = await RoomPKVote.aggregate([
          { $match: { pkId: new Types.ObjectId(id) } },
          { $group: { _id: '$side', count: { $sum: 1 } } },
        ]);
        const votes = [0, 0];
        for (const item of voteCounts) {
          if ([0, 1].includes(item._id)) votes[item._id] = item.count;
        }

        const changed = votes.some((v, idx) => v !== (match.votes?.[idx] || 0));
        if (changed || finished) {
          let update: any = { votes, scores: votes };
          if (finished) {
            const draw = votes[0] === votes[1];
            const winnerSide = draw ? null : (votes[0] > votes[1] ? 0 : 1);
            update = {
              ...update,
              status: 'finished',
              isOpen: false,
              finishedAt: new Date(now),
              draw,
              winnerSide,
              winnerRoomId: draw ? null : (match.roomIds[winnerSide!] || match.roomIds[0]),
            };
          }
          match = await RoomPK.findOneAndUpdate(
            { _id: id, status: 'active', isOpen: true },
            { $set: update },
            { new: true }
          ).lean();
          await publish(match);
        }
        return match;
      }

      // Gift-based PK modes ('personal', 'team', 'room')
      const totals = await GiftTransaction.aggregate([
        {
          $match: {
            'meta.pkId': id,
            status: { $in: ['SUCCESS', 'COMPLETED'] },
            createdAt: { $gte: new Date(match.startedAt), $lt: new Date(match.endsAt) },
          },
        },
        { $group: { _id: '$meta.pkSide', total: { $sum: '$totalDiamonds' } } },
      ]);
      const scores = [0, 0];
      for (const total of totals) if ([0, 1].includes(total._id)) scores[total._id] = total.total;

      // Aggregate top 3 sending contributors for both sides
      const contributorAgg = await GiftTransaction.aggregate([
        {
          $match: {
            'meta.pkId': id,
            status: { $in: ['SUCCESS', 'COMPLETED'] },
            createdAt: { $gte: new Date(match.startedAt), $lt: new Date(match.endsAt) },
          },
        },
        { $group: { _id: { side: '$meta.pkSide', senderId: '$senderId' }, total: { $sum: '$totalDiamonds' } } },
        { $sort: { total: -1 } },
        { $lookup: { from: 'users', localField: '_id.senderId', foreignField: '_id', as: 'sender' } },
        { $unwind: { path: '$sender', preserveNullAndEmptyArrays: true } },
        { $project: { side: '$_id.side', avatar: { $ifNull: ['$sender.image', '$sender.avatar'] } } },
      ]);
      const leftContributors: any[] = [];
      const rightContributors: any[] = [];
      for (const item of contributorAgg) {
        if (item.side === 0 && leftContributors.length < 3) {
          leftContributors.push({ seat: leftContributors.length + 1, avatar: item.avatar || '' });
        } else if (item.side === 1 && rightContributors.length < 3) {
          rightContributors.push({ seat: rightContributors.length + 1, avatar: item.avatar || '' });
        }
      }

      // If team PK, also calculate individual member contributions
      let updatedTeamA = match.teamA;
      let updatedTeamB = match.teamB;
      if (match.pkMode === 'team' && (match.teamA?.length || match.teamB?.length)) {
        const memberAgg = await GiftTransaction.aggregate([
          {
            $match: {
              'meta.pkId': id,
              status: { $in: ['SUCCESS', 'COMPLETED'] },
              createdAt: { $gte: new Date(match.startedAt), $lt: new Date(match.endsAt) },
            },
          },
          { $group: { _id: '$receiverId', total: { $sum: '$totalDiamonds' } } },
        ]);
        const memberMap = new Map(memberAgg.map(m => [String(m._id), m.total]));

        updatedTeamA = (match.teamA || []).map((m: any) => ({
          ...m,
          score: memberMap.get(String(m._id || m.id)) || 0,
        }));
        updatedTeamB = (match.teamB || []).map((m: any) => ({
          ...m,
          score: memberMap.get(String(m._id || m.id)) || 0,
        }));
      }

      const changed = scores.some((score, side) => score !== match.scores[side]) ||
        leftContributors.length !== (match.leftContributors?.length || 0) ||
        rightContributors.length !== (match.rightContributors?.length || 0);

      if (changed || finished) {
        const resultInfo = roomPKResult(match.roomIds, scores);
        const update = {
          scores,
          leftContributors,
          rightContributors,
          ...(match.pkMode === 'team' ? { teamA: updatedTeamA, teamB: updatedTeamB } : {}),
          ...(finished ? {
            status: 'finished',
            isOpen: false,
            finishedAt: new Date(now),
            draw: resultInfo.draw,
            winnerSide: resultInfo.winnerSide,
            winnerRoomId: resultInfo.winnerRoomId,
            loserRoomId: resultInfo.loserRoomId,
          } : {}),
        };
        match = await RoomPK.findOneAndUpdate(
          { _id: id, status: 'active', isOpen: true },
          { $set: update },
          { new: true }
        ).lean();
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

/**
 * Create a new Room PK session.
 * Supports: 'vote', 'personal', 'team', and legacy cross-room 'room'
 */
export async function createPK(roomId: string, config: any, user: any) {
  const own = await resolveRoom(roomId);
  requireOwner(own, user);

  const durationSec = Number(config?.durationSeconds || 300);
  const validDuration = VALID_PK_DURATIONS.includes(durationSec) ? durationSec : 300;
  const pkMode = ['vote', 'personal', 'team', 'room'].includes(config?.pkMode) ? config.pkMode : 'personal';
  const canonicalId = normalizePKRoomId(own.channelName);
  const hostActorId = actorId(user);

  await releaseExpiredRooms([canonicalId]);
  await RoomPK.init();

  // Validate optional selected gift
  let selectedGiftDoc: any = null;
  if (config?.selectedGiftId) {
    selectedGiftDoc = await Gift.findById(config.selectedGiftId).lean();
    if (!selectedGiftDoc) throw new RoomPKError('Selected gift is invalid or no longer available', 400);
  }

  const selectedGiftSnapshot = selectedGiftDoc ? {
    id: String(selectedGiftDoc._id),
    name: selectedGiftDoc.name,
    icon: selectedGiftDoc.icon || '',
    image: selectedGiftDoc.image || selectedGiftDoc.previewUrl || '',
    price: Number(selectedGiftDoc.price || selectedGiftDoc.cost || 0),
    cost: Number(selectedGiftDoc.price || selectedGiftDoc.cost || 0),
  } : null;

  const now = Date.now();
  const durationMs = validDuration * 1000;

  // 1. VOTE PK: Two participants compete based on audience votes
  if (pkMode === 'vote') {
    const partA = config?.participantA;
    const partB = config?.participantB;

    if (!partA?.userId || !partB?.userId) {
      throw new RoomPKError('Vote PK requires two participants (Side A and Side B)', 400);
    }
    if (String(partA.userId) === String(partB.userId)) {
      throw new RoomPKError('Side A and Side B must be different participants', 400);
    }

    const state = await liveState(own);
    const roomUsers = [
      ...(state.seats || []).map((s: any) => s.user).filter(Boolean),
      ...Object.values(state.onlineUsers || {}),
    ];
    const userAInRoom = roomUsers.some((u: any) => [u.userId, u.id, u._id].map(String).includes(String(partA.userId)));
    const userBInRoom = roomUsers.some((u: any) => [u.userId, u.id, u._id].map(String).includes(String(partB.userId)));
    if (!userAInRoom || !userBInRoom) {
      throw new RoomPKError('Both Vote PK participants must be in the room', 400);
    }

    try {
      const match = await RoomPK.create({
        roomIds: [canonicalId],
        busyRoomIds: [canonicalId],
        rooms: [
          { id: String(partA.userId), title: partA.name || 'Side A', hostName: partA.name || 'Side A', coverImage: partA.avatar || '', userId: String(partA.userId) },
          { id: String(partB.userId), title: partB.name || 'Side B', hostName: partB.name || 'Side B', coverImage: partB.avatar || '', userId: String(partB.userId) },
        ],
        invitedBy: hostActorId,
        durationSeconds: validDuration,
        pkType: 'user',
        pkMode: 'vote',
        status: 'active',
        startedAt: new Date(now),
        endsAt: new Date(now + durationMs),
        inviteExpiresAt: new Date(now + durationMs),
        participantA: partA,
        participantB: partB,
        votes: [0, 0],
        scores: [0, 0],
        jackpotEnabled: Boolean(config?.jackpotEnabled),
      });
      await publish(match);
      return pkSnapshot(match);
    } catch (error: any) {
      if (error.code === 11000) throw new RoomPKError('This room already has an active PK session', 409);
      throw error;
    }
  }

  // 2. PERSONAL GIFT PK: 1v1 within the same room
  if (pkMode === 'personal') {
    const targetUserId = String(config?.targetUserId || config?.participantB?.userId || '').trim();
    if (!targetUserId) throw new RoomPKError('Enter User ID of an active user in this room for Personal PK', 400);

    const state = await liveState(own);
    const roomUsers = [
      ...(state.seats || []).map((s: any) => s.user).filter(Boolean),
      ...Object.values(state.onlineUsers || {}),
    ];

    let partA = config?.participantA;
    if (partA) {
      const partAId = String(partA.userId || partA.id || partA._id || '');
      const userA = roomUsers.find((person: any) =>
        [String(person.userId || ''), String(person.id || ''), String(person._id || ''), String(person.uniqueId || '')]
          .some(val => val && val.toLowerCase() === partAId.toLowerCase())
      );
      if (userA) {
        partA = {
          id: String(userA.userId || userA._id || userA.id),
          _id: String(userA._id || userA.id),
          userId: String(userA.userId || userA._id || userA.id),
          name: userA.name || partA.name || 'Participant A',
          avatar: userA.avatar || userA.image || partA.avatar || '',
        };
      }
    } else {
      partA = roomSummary(own);
    }

    const opponent = roomUsers.find((person: any) =>
      [String(person.userId || ''), String(person.id || ''), String(person._id || ''), String(person.uniqueId || '')]
        .some(val => val && val.toLowerCase() === targetUserId.toLowerCase())
    );
    if (!opponent && !config?.participantB) throw new RoomPKError('User must be in the same room for Personal PK', 400);

    const opponentActorId = String(opponent?._id || opponent?.id || config?.participantB?._id || config?.participantB?.id || '');
    const opponentUserId = String(opponent?.userId || opponentActorId || config?.participantB?.userId);
    const partAUserId = String(partA.userId || partA.id || partA._id || '');
    if (partAUserId && (partAUserId === opponentUserId || String(partA._id || partA.id) === opponentActorId)) {
      throw new RoomPKError('Both PK participants must be different users', 400);
    }

    const partB = {
      id: opponentUserId,
      _id: opponentActorId,
      userId: opponentUserId,
      name: opponent?.name || config?.participantB?.name || 'Opponent',
      avatar: opponent?.avatar || opponent?.image || config?.participantB?.avatar || '',
    };

    try {
      const match = await RoomPK.create({
        roomIds: [canonicalId],
        busyRoomIds: [canonicalId],
        rooms: [
          {
            id: String(partA.userId || partA.id || own.ownerId?.userId),
            title: partA.name || own.title,
            hostName: partA.name || own.ownerId?.name,
            coverImage: partA.avatar || own.ownerId?.avatar || '',
            userId: String(partA.userId || partA.id || own.ownerId?.userId),
          },
          {
            id: opponentUserId,
            title: partB.name,
            hostName: partB.name,
            coverImage: partB.avatar,
            userId: opponentUserId,
          },
        ],
        invitedBy: hostActorId,
        durationSeconds: validDuration,
        pkType: 'user',
        pkMode: 'personal',
        status: 'active',
        startedAt: new Date(now),
        endsAt: new Date(now + durationMs),
        inviteExpiresAt: new Date(now + durationMs),
        participantA: partA,
        participantB: partB,
        selectedGiftId: selectedGiftSnapshot ? selectedGiftSnapshot.id : null,
        selectedGift: selectedGiftSnapshot,
        jackpotEnabled: Boolean(config?.jackpotEnabled),
        scores: [0, 0],
      });
      await publish(match);
      return pkSnapshot(match);
    } catch (error: any) {
      if (error.code === 11000) throw new RoomPKError('This room already has an active PK session', 409);
      throw error;
    }
  }

  // 3. TEAM GIFT PK: Yellow Team vs Blue Team
  if (pkMode === 'team') {
    const rawTeamA = Array.isArray(config?.teamA) ? config.teamA : [];
    const rawTeamB = Array.isArray(config?.teamB) ? config.teamB : [];

    if (!rawTeamA.length || !rawTeamB.length) {
      throw new RoomPKError('Team Gift PK requires at least one participant on both Yellow Team and Blue Team', 400);
    }

    const teamAIds = new Set(rawTeamA.map((m: any) => String(m.userId || m.id || m._id)));
    const teamBIds = new Set(rawTeamB.map((m: any) => String(m.userId || m.id || m._id)));

    // Prevent duplicate membership across teams
    for (const id of teamAIds) {
      if (teamBIds.has(id)) {
        throw new RoomPKError('A participant cannot be on both Yellow Team and Blue Team', 400);
      }
    }

    const state = await liveState(own);
    const roomUsers = [
      ...(state.seats || []).map((s: any) => s.user).filter(Boolean),
      ...Object.values(state.onlineUsers || {}),
    ];
    const isUserInRoom = (uid: unknown) =>
      roomUsers.some((u: any) => [u.userId, u.id, u._id].map(String).includes(String(uid)));

    for (const id of [...Array.from(teamAIds), ...Array.from(teamBIds)]) {
      if (!isUserInRoom(id)) {
        throw new RoomPKError(`Participant ${String(id)} must be inside the room for Team PK`, 400);
      }
    }

    const cleanTeamA = rawTeamA.map((m: any) => ({
      userId: String(m.userId || m.id),
      _id: String(m._id || m.id || m.userId),
      name: m.name || 'Member',
      avatar: m.avatar || m.image || '',
      seatIndex: Number(m.seatIndex ?? -1),
      score: 0,
    }));
    const cleanTeamB = rawTeamB.map((m: any) => ({
      userId: String(m.userId || m.id),
      _id: String(m._id || m.id || m.userId),
      name: m.name || 'Member',
      avatar: m.avatar || m.image || '',
      seatIndex: Number(m.seatIndex ?? -1),
      score: 0,
    }));

    try {
      const match = await RoomPK.create({
        roomIds: [canonicalId],
        busyRoomIds: [canonicalId],
        rooms: [
          { id: `${canonicalId}_yellow`, title: 'Yellow Team', hostName: 'Yellow Team', coverImage: cleanTeamA[0]?.avatar || '', userId: cleanTeamA[0]?.userId || '' },
          { id: `${canonicalId}_blue`, title: 'Blue Team', hostName: 'Blue Team', coverImage: cleanTeamB[0]?.avatar || '', userId: cleanTeamB[0]?.userId || '' },
        ],
        invitedBy: hostActorId,
        durationSeconds: validDuration,
        pkType: 'user',
        pkMode: 'team',
        status: 'active',
        startedAt: new Date(now),
        endsAt: new Date(now + durationMs),
        inviteExpiresAt: new Date(now + durationMs),
        teamA: cleanTeamA,
        teamB: cleanTeamB,
        selectedGiftId: selectedGiftSnapshot ? selectedGiftSnapshot.id : null,
        selectedGift: selectedGiftSnapshot,
        jackpotEnabled: Boolean(config?.jackpotEnabled),
        scores: [0, 0],
      });
      await publish(match);
      return pkSnapshot(match);
    } catch (error: any) {
      if (error.code === 11000) throw new RoomPKError('This room already has an active PK session', 409);
      throw error;
    }
  }

  // 4. ROOM PK: Legacy cross-room PK
  const targetRaw = String(config?.targetRoomId || config?.targetId || '').trim();
  if (!targetRaw) throw new RoomPKError('Enter Opponent Room ID for Room PK', 400);
  const opponent = await resolveRoom(targetRaw);
  const ids = [canonicalId, normalizePKRoomId(opponent.channelName)];
  if (ids[0] === ids[1] || ownerId(own) === ownerId(opponent)) throw new RoomPKError('Choose a different Room ID for PK', 400);
  await Promise.all([requireLiveHost(own), requireLiveHost(opponent)]);
  await releaseExpiredRooms(ids);
  await RoomPK.init();
  try {
    const match = await RoomPK.create({
      roomIds: ids,
      busyRoomIds: ids,
      rooms: [roomSummary(own), roomSummary(opponent)],
      invitedBy: hostActorId,
      durationSeconds: validDuration,
      pkType: 'room',
      pkMode: 'room',
      inviteExpiresAt: new Date(Date.now() + ROOM_PK_INVITE_MS),
    });
    await publish(match);
    return pkSnapshot(match);
  } catch (error: any) {
    if (error.code === 11000) throw new RoomPKError('One of these rooms already has a PK or pending invitation', 409);
    throw error;
  }
}

export const invitePK = createPK;

/**
 * Cast a free audience vote in Vote PK.
 * Enforces 1 vote per user per PK session.
 */
export async function votePK(roomId: string, side: number, user: any) {
  if (side !== 0 && side !== 1) throw new RoomPKError('Invalid vote side. Must be 0 or 1', 400);
  const own = await resolveRoom(roomId);
  const canonicalId = normalizePKRoomId(own.channelName);
  const voterActorId = actorId(user);
  if (!voterActorId) throw new RoomPKError('Authentication required to vote', 401);

  const now = Date.now();
  const match = await RoomPK.findOne({
    roomIds: canonicalId,
    status: 'active',
    isOpen: true,
    pkMode: 'vote',
    startedAt: { $lte: new Date(now) },
    endsAt: { $gt: new Date(now) },
  }).lean() as any;

  if (!match) throw new RoomPKError('No active Vote PK session in this room', 404);

  // Enforce 1 vote per user via RoomPKVote unique compound index { pkId, voterId }
  try {
    await RoomPKVote.create({
      pkId: match._id,
      roomId: canonicalId,
      voterId: voterActorId,
      voterName: user.name || 'Voter',
      voterAvatar: user.image || user.avatar || '',
      side,
      targetUserId: side === 0 ? match.participantA?.userId : match.participantB?.userId,
    });
  } catch (err: any) {
    if (err.code === 11000) {
      throw new RoomPKError('You have already voted in this PK battle', 400);
    }
    throw err;
  }

  // Atomically increment votes in RoomPK
  const updatedMatch = await RoomPK.findOneAndUpdate(
    { _id: match._id, status: 'active', isOpen: true },
    { $inc: { [`votes.${side}`]: 1, [`scores.${side}`]: 1 } },
    { new: true }
  ).lean();

  if (updatedMatch) {
    await publish(updatedMatch);
    return pkSnapshot(updatedMatch);
  }
  return pkSnapshot(match);
}

/**
 * Respond to an invitation (accept, decline, cancel)
 */
export async function respondPK(id: string, roomId: string, decision: string, user: any) {
  if (!['accept', 'decline', 'cancel'].includes(decision)) throw new RoomPKError('Invalid PK response', 400);
  const own = await resolveRoom(roomId);
  const currentActorId = actorId(user);
  await refreshPK(id);
  return withDistributedLock(redis, `room_pk:match:${id}`, async () => {
    const match = await RoomPK.findById(id).lean() as any;
    if (!match || !match.isOpen) throw new RoomPKError('This PK session is no longer active', 409);

    const isHost = currentActorId === match.invitedBy || ownerId(own) === currentActorId;

    if (decision === 'cancel') {
      if (!isHost) throw new RoomPKError('Only the room host can cancel the PK', 403);
      const changed = await RoomPK.findOneAndUpdate(
        { _id: id, isOpen: true },
        { $set: { status: 'cancelled', isOpen: false, finishedAt: new Date() } },
        { new: true }
      ).lean();
      if (!changed) throw new RoomPKError('PK session already concluded', 409);
      await publish(changed);
      return pkSnapshot(changed);
    }

    if (match.status !== 'invited') throw new RoomPKError('This PK invitation has already been accepted or finished', 409);

    if (decision === 'accept') {
      const now = Date.now();
      if (new Date(match.inviteExpiresAt).getTime() <= now) throw new RoomPKError('PK invitation expired', 409);
      const durationMs = (Number(match.durationSeconds) || 300) * 1000;
      const update = { status: 'active', startedAt: new Date(now), endsAt: new Date(now + durationMs), scores: [0, 0] };
      const changed = await RoomPK.findOneAndUpdate({ _id: id, status: 'invited', isOpen: true }, { $set: update }, { new: true }).lean();
      if (!changed) throw new RoomPKError('PK invitation already handled', 409);
      await publish(changed);
      return pkSnapshot(changed);
    } else {
      const update = { status: 'declined', isOpen: false, finishedAt: new Date() };
      const changed = await RoomPK.findOneAndUpdate({ _id: id, status: 'invited', isOpen: true }, { $set: update }, { new: true }).lean();
      if (!changed) throw new RoomPKError('PK invitation already handled', 409);
      await publish(changed);
      return pkSnapshot(changed);
    }
  }, { ttlMs: 15000, waitMs: 1500 });
}

export async function currentPK(roomId: string) {
  const room = await resolveRoom(roomId);
  const id = normalizePKRoomId(room.channelName);
  const match = await RoomPK.findOne({
    roomIds: id,
    $or: [
      { isOpen: true },
      { status: 'finished', finishedAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) } },
    ],
  }).sort({ isOpen: -1, createdAt: -1 }).lean() as any;
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
  const rooms = await Room.find({
    isActive: true,
    isBanned: { $ne: true },
    isLocked: { $ne: true },
    ownerId: { $ne: own.ownerId?._id || own.ownerId },
  }).populate('ownerId', 'userId name image avatar')
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

interface MatchingRoomQueueEntry {
  roomId: string;
  channelName: string;
  user: any;
  timestamp: number;
}
const matchingRoomQueue = new Map<string, MatchingRoomQueueEntry>();

export async function matchPK(roomId: string, user: any) {
  const own = await resolveRoom(roomId);
  requireOwner(own, user);
  const canonicalId = normalizePKRoomId(own.channelName);

  const now = Date.now();
  // Clear entries older than 60s
  for (const [k, v] of matchingRoomQueue.entries()) {
    if (now - v.timestamp > 60000) matchingRoomQueue.delete(k);
  }

  // Look for another waiting room
  let oppEntry: MatchingRoomQueueEntry | null = null;
  for (const [k, v] of matchingRoomQueue.entries()) {
    if (k !== canonicalId) {
      oppEntry = v;
      matchingRoomQueue.delete(k);
      break;
    }
  }

  if (oppEntry) {
    const match = await createPK(canonicalId, {
      pkType: 'room',
      pkMode: 'room',
      targetRoomId: oppEntry.channelName,
      durationSeconds: 600,
    }, user);
    return await respondPK(String(match.id || match._id), oppEntry.channelName, 'accept', oppEntry.user);
  } else {
    const opponents = await pkOpponents(canonicalId);
    if (opponents.length > 0) {
      return await createPK(canonicalId, {
        pkType: 'room',
        pkMode: 'room',
        targetRoomId: opponents[0].id,
        durationSeconds: 600,
      }, user);
    }
    matchingRoomQueue.set(canonicalId, {
      roomId,
      channelName: canonicalId,
      user,
      timestamp: now,
    });
    return { status: 'matching', message: 'Matching room pk...' };
  }
}

export async function cancelMatchPK(roomId: string, user: any) {
  const own = await resolveRoom(roomId);
  const canonicalId = normalizePKRoomId(own.channelName);
  matchingRoomQueue.delete(canonicalId);
  return { status: 'cancelled' };
}

/**
 * Capture server-verified room eligibility before a successful gift receipt is written.
 * Enforces:
 * - Vote PK: gifts do NOT count toward votes
 * - Selected gift rule: if selectedGiftId is set, only that gift earns score
 * - Personal PK: receiver must be participant A (side 0) or participant B (side 1)
 * - Team PK: receiver must be in team A (side 0) or team B (side 1)
 */
export async function capturePKGift(roomId: string, sender: any, receivers: any[], giftId?: string) {
  const canonical = normalizePKRoomId(roomId), now = new Date();
  const match = await RoomPK.findOne({
    roomIds: canonical,
    status: 'active',
    isOpen: true,
    startedAt: { $lte: now },
    endsAt: { $gt: now },
  }).select('roomIds pkType pkMode rooms participantA participantB teamA teamB selectedGiftId').lean() as any;
  if (!match) return {};

  // Vote PK: gifts do NOT count towards PK score!
  if (match.pkMode === 'vote') return {};

  // Selected gift restriction: if active, only the designated gift contributes to score
  if (match.selectedGiftId && giftId) {
    if (String(giftId) !== String(match.selectedGiftId)) return {};
  }

  const { getVoiceRoomState } = await import('../sockets/voiceRoomSocket');
  const state = await getVoiceRoomState(canonical);
  const senderIds = [String(sender._id), String(sender.userId)];
  const present = Object.values(state.onlineUsers || {}).some((person: any) =>
    [person.userId, person.id, person._id].some(id => id && senderIds.includes(String(id))));
  const eligible = present && receivers.every(rec => state.seats.some(seat =>
    seat.user && [rec._id, rec.userId].some(id => id && [seat.user?.userId, (seat.user as any)?.id, (seat.user as any)?._id].map(String).includes(String(id)))));
  if (!eligible) return {};

  // 1. Personal Gift PK: receiver matches participant A (Side 0) or participant B (Side 1)
  if (match.pkMode === 'personal' || match.pkType === 'user') {
    const side0Ids = [
      String(match.participantA?.userId || ''),
      String(match.participantA?._id || ''),
      String(match.participantA?.id || ''),
      String(match.rooms?.[0]?.ownerId || ''),
      String(match.rooms?.[0]?.userId || ''),
      String(match.rooms?.[0]?.id || ''),
    ].filter(Boolean);
    const side1Ids = [
      String(match.participantB?.userId || ''),
      String(match.participantB?._id || ''),
      String(match.participantB?.id || ''),
      String(match.rooms?.[1]?.ownerId || ''),
      String(match.rooms?.[1]?.userId || ''),
      String(match.rooms?.[1]?.id || ''),
    ].filter(Boolean);

    const isSide0 = receivers.some(rec => [String(rec._id), String(rec.userId)].some(id => side0Ids.includes(id)));
    const isSide1 = receivers.some(rec => [String(rec._id), String(rec.userId)].some(id => side1Ids.includes(id)));

    if (isSide0 && !isSide1) return { pkId: String(match._id), pkSide: 0, targetUserId: String(receivers[0]?.userId || receivers[0]?._id) };
    if (isSide1 && !isSide0) return { pkId: String(match._id), pkSide: 1, targetUserId: String(receivers[0]?.userId || receivers[0]?._id) };
    return {};
  }

  // 2. Team Gift PK: receiver matches Yellow Team (Side 0) or Blue Team (Side 1)
  if (match.pkMode === 'team') {
    const teamAIds = (match.teamA || []).flatMap((m: any) => [String(m.userId), String(m._id), String(m.id)]).filter(Boolean);
    const teamBIds = (match.teamB || []).flatMap((m: any) => [String(m.userId), String(m._id), String(m.id)]).filter(Boolean);

    const isTeamA = receivers.some(rec => [String(rec._id), String(rec.userId)].some(id => teamAIds.includes(id)));
    const isTeamB = receivers.some(rec => [String(rec._id), String(rec.userId)].some(id => teamBIds.includes(id)));

    if (isTeamA && !isTeamB) return { pkId: String(match._id), pkSide: 0, targetUserId: String(receivers[0]?.userId || receivers[0]?._id) };
    if (isTeamB && !isTeamA) return { pkId: String(match._id), pkSide: 1, targetUserId: String(receivers[0]?.userId || receivers[0]?._id) };
    return {};
  }

  // 3. Cross-room PK: side corresponds to room index
  return { pkId: String(match._id), pkSide: match.roomIds.indexOf(canonical) };
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
      const due = await RoomPK.find({
        isOpen: true,
        $or: [
          { status: 'invited', inviteExpiresAt: { $lte: now } },
          { status: 'active', endsAt: { $lte: new Date(now.getTime() - ROOM_PK_SETTLE_MS) } },
        ],
      }).select('_id').limit(50).lean();
      for (const match of due) await refreshPK(String(match._id));
    } catch (error: any) {
      console.warn('[RoomPK] Scheduler notice:', error?.message);
    } finally {
      running = false;
    }
  }, 1000);
  scheduler.unref();
}
