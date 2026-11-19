const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const roomId = '507f1f77bcf86cd799439020';
const host = '507f1f77bcf86cd799439011';
const guest = '507f1f77bcf86cd799439012';
const viewer = '507f1f77bcf86cd799439013';
const outsider = '507f1f77bcf86cd799439014';
let voiceRoom, liveRoom, rivalRoom, voiceState, transaction;
const processed = [];
const broadcasts = [];
const pkChannels = [];
const query = value => ({ select() { return this; }, session() { return this; }, lean: async () => value });
class GiftTransaction {
  constructor() { this._id = '507f1f77bcf86cd799439030'; }
  static findOne() { return query(transaction); }
  static async create(rows) { transaction = rows[0]; return rows; }
}
const original = Module._load;
Module._load = function (name, parent, isMain) {
  if (name.endsWith('/models/room.model')) return { Room: { findOne: () => query(voiceRoom) } };
  if (name.endsWith('/models/liveBroadcast.model')) return { __esModule: true, default: {
    findOne(filter) {
      const candidate = String(filter._id) === roomId ? liveRoom : rivalRoom;
      const live = candidate && candidate.status === 'live' && candidate.heartbeatAt > filter.heartbeatAt.$gt &&
        (!filter.host || String(candidate.host) === String(filter.host));
      return query(live ? candidate : null);
    },
  } };
  if (name.endsWith('/sockets/voiceRoomSocket')) return { getVoiceRoomState: async () => voiceState };
  if (name.endsWith('/gift/gift.model')) return { GiftTransaction };
  if (name.endsWith('/gift/gift.socket')) return { broadcastGiftSuccess: value => broadcasts.push(value) };
  if (name.endsWith('/models/user.model')) return { User: { findById: () => query({ role: 'host' }) } };
  if (name.endsWith('/models/agency.model')) return { Agency: {} };
  if (name.endsWith('/services/roomPk.service')) return {
    capturePKGift: async channel => { pkChannels.push(channel); return {}; }, notifyPKGift: async () => {},
  };
  if (name === './service' && parent.filename.endsWith('giftAdapter.ts')) return {
    atomic: async work => work({}),
    processRoomGift: async (...args) => {
      processed.push(args);
      return { totalUnits: 2000, afterUnits: 98000, allocations: [{ instant: 1000, platform: 1000 }] };
    },
  };
  return original.call(this, name, parent, isMain);
};
const { validateGiftRoomContext } = require('../economy/giftContext');
const { sendVersionedRoomGift } = require('../economy/giftAdapter');
Module._load = original;
const voiceSocketPath = require.resolve('../sockets/voiceRoomSocket');
require.cache[voiceSocketPath] = { id: voiceSocketPath, filename: voiceSocketPath, loaded: true,
  exports: { getVoiceRoomState: async () => voiceState } };

test.beforeEach(() => {
  voiceRoom = null;
  rivalRoom = null;
  liveRoom = { _id: roomId, status: 'live', heartbeatAt: new Date(), host,
    guests: [{ user: guest }], viewers: [{ user: viewer, heartbeatAt: new Date() }] };
  voiceState = { onlineUsers: {}, seats: [] };
  transaction = null;
  processed.length = broadcasts.length = pkChannels.length = 0;
});

test('live viewers and accepted guests can gift the host and accepted co-hosts', async () => {
  assert.equal(await validateGiftRoomContext(roomId, { _id: viewer }, [{ _id: host }]), null);
  assert.equal(await validateGiftRoomContext(roomId, { _id: guest }, [{ _id: host }]), null);
  assert.equal(await validateGiftRoomContext(roomId, { _id: host }, [{ _id: guest }]), null);
});

test('live gifts reject outsiders, stale viewer leases and unapproved recipients', async () => {
  await assert.rejects(validateGiftRoomContext(roomId, { _id: outsider }, [{ _id: host }]), /Sender is not present/);
  await assert.rejects(validateGiftRoomContext(roomId, { _id: viewer }, [{ _id: outsider }]), /Recipient is not/);
  liveRoom.viewers[0].heartbeatAt = new Date(Date.now() - 100000);
  await assert.rejects(validateGiftRoomContext(roomId, { _id: viewer }, [{ _id: host }]), /Sender is not present/);
  liveRoom.status = 'ended';
  await assert.rejects(validateGiftRoomContext(roomId, { _id: host }, [{ _id: guest }]), /Room is unavailable/);
});

test('voice gifts retain sender presence, seated-recipient and banned-room checks', async () => {
  voiceRoom = { channelName: 'voice-room', ownerId: host };
  voiceState = { onlineUsers: { [viewer]: {} }, seats: [{ user: { _id: guest } }] };
  assert.equal(await validateGiftRoomContext('voice-room', { _id: viewer }, [{ _id: guest }]), 'voice-room');
  await assert.rejects(validateGiftRoomContext('voice-room', { _id: outsider }, [{ _id: host }]), /Sender is not present/);
  await assert.rejects(validateGiftRoomContext('voice-room', { _id: viewer }, [{ _id: outsider }]), /Recipient is not seated/);
  voiceRoom.isBanned = true;
  await assert.rejects(validateGiftRoomContext('voice-room', { _id: viewer }, [{ _id: host }]), /Room is unavailable/);
});

test('PK gifts allow the active rival host while rejecting stale or mismatched rivals', async () => {
  liveRoom.pk = { isActive: true, rivalRoomId: '507f1f77bcf86cd799439021', rivalHost: outsider };
  rivalRoom = { host: outsider, status: 'live', heartbeatAt: new Date() };
  assert.equal(await validateGiftRoomContext(roomId, { _id: viewer }, [{ _id: outsider }]), null);
  rivalRoom.heartbeatAt = new Date(Date.now() - 100000);
  await assert.rejects(validateGiftRoomContext(roomId, { _id: viewer }, [{ _id: outsider }]), /Recipient is not/);
});

test('a live gift uses the existing ledger allocation and replays without another settlement or broadcast', async () => {
  const pinned = { version: 'test', digest: 'digest', rules: { gift: { platformMinBps: 1000, agencyMaxBps: 1000 } } };
  const gift = { _id: '507f1f77bcf86cd799439031', price: 10, name: 'Rose', toObject() { return { name: this.name, price: this.price }; } };
  const dto = { roomId, requestId: 'live-gift-regression' };
  const first = await sendVersionedRoomGift({ _id: viewer }, [{ _id: host }], gift, dto, 2, pinned);
  assert.equal(processed.length, 1);
  assert.equal(processed[0][0].unitsPerReceiver, 2000);
  assert.equal(processed[0][0].roomId, roomId);
  assert.deepEqual(processed[0][0].receivers, [{ id: host }]);
  assert.equal(first.data.totalDiamonds, 20);
  assert.equal(first.newBalance, 980);
  assert.equal(transaction.hostEarning, 1000);
  assert.equal(transaction.platformCommission, 1000);
  const replay = await sendVersionedRoomGift({ _id: viewer }, [{ _id: host }], gift, dto, 2, pinned);
  assert.equal(replay.isReplay, true);
  assert.equal(processed.length, 1);
  assert.equal(broadcasts.length, 1);
  assert.equal(pkChannels.length, 0);
});
