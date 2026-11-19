const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const host = '507f1f77bcf86cd799439011';
const guest = '507f1f77bcf86cd799439012';
const viewer = '507f1f77bcf86cd799439013';
const roomId = '507f1f77bcf86cd799439020';
const updates = [];
const room = { host, status: 'live', guests: [{ user: guest, agoraUid: 20, camera: true }] };
const model = {
  findOne(filter) {
    const allowedHost = !filter.host || filter.host === host;
    const allowedGuest = !filter['guests.user'] || filter['guests.user'] === guest;
    return { lean: async () => allowedHost && allowedGuest ? room : null };
  },
  updateOne: async (filter, update) => updates.push({ filter, update }),
};
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name.endsWith('/models/liveBroadcast.model')) return { __esModule: true, default: model };
  if (name.endsWith('/models/user.model')) return { User: {} };
  if (name.endsWith('/gift/gift.model')) return { Gift: {} };
  if (name.endsWith('/gift/gift.service')) return { GiftService: {} };
  if (name.endsWith('/services/entryEffect.service')) return { EntryEffectService: {} };
  if (name.endsWith('/services/agora/agoraToken.service')) return { AgoraTokenService: {} };
  return originalLoad.call(this, name, parent, isMain);
};
const { registerLiveBroadcastHandlers } = require('../sockets/liveBroadcastSocket');
Module._load = originalLoad;

function connect(userId) {
  const handlers = {};
  const broadcasts = [];
  const socket = { user: { id: userId }, rooms: new Set(),
    on: (event, handler) => { handlers[event] = handler; }, emit() {} };
  const io = { to: channel => ({ emit: (event, payload) => broadcasts.push({ channel, event, payload }) }) };
  registerLiveBroadcastHandlers(io, socket);
  return { handlers, broadcasts };
}

test.beforeEach(() => { updates.length = 0; });

test('host can mute an accepted guest without changing the guest camera', async () => {
  const client = connect(host);
  await client.handlers['live:mute_guest']({ roomId, targetUserId: guest });
  assert.deepEqual(updates[0].update, { $set: { 'guests.$.muted': true } });
  assert.equal(client.broadcasts[0].channel, `live_broadcast_room:${roomId}`);
  assert.deepEqual(client.broadcasts[0].payload, { roomId, userId: guest, agoraUid: 20, muted: true, camera: true });
});

test('viewer cannot mute guests or publish guest media state', async () => {
  const client = connect(viewer);
  await client.handlers['live:mute_guest']({ roomId, targetUserId: guest });
  await client.handlers['live:guest_media']({ roomId, muted: false, camera: false });
  assert.equal(updates.length, 0);
  assert.equal(client.broadcasts.length, 0);
});

test('accepted guest can mute, unmute and switch their own camera state', async () => {
  const client = connect(guest);
  await client.handlers['live:guest_media']({ roomId, muted: true, camera: false });
  await client.handlers['live:guest_media']({ roomId, muted: false, camera: true });
  assert.equal(updates.length, 2);
  assert.equal(updates[0].filter['guests.user'], guest);
  assert.deepEqual(updates[0].update.$set, { 'guests.$.muted': true, 'guests.$.camera': false });
  assert.deepEqual(updates[1].update.$set, { 'guests.$.muted': false, 'guests.$.camera': true });
  assert.equal(client.broadcasts.length, 2);
});

test('invalid control values cannot change persisted or broadcast state', async () => {
  const client = connect(guest);
  await client.handlers['live:guest_media']({ roomId, muted: 'false', camera: true });
  await client.handlers['live:guest_media']({ roomId: 'invalid', muted: true, camera: false });
  assert.equal(updates.length, 0);
  assert.equal(client.broadcasts.length, 0);
});
