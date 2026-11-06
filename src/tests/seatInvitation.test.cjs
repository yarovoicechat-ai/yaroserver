const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');

const setup = () => {
  const source = fs.readFileSync(path.join(__dirname, '../sockets/voiceRoomSocket.ts'), 'utf8');
  const start = source.indexOf('  // 1.5 Invite User to Seat');
  const end = source.indexOf('  // 2. Take Seat', start);
  assert.ok(start > 0 && end > start);
  const state = { onlineUsers: { host: { userId: 'host', socketId: 'host-socket' },
    guest: { userId: 'guest', id: 'db-guest', socketId: 'recipient-socket' } },
    seats: [{}, { user: null, isLocked: false }] };
  const events = [];
  let handler;
  const socket = { voiceRoomId: 'room', voiceUser: { userId: 'host' },
    on: (_, fn) => { handler = fn; }, emit: (event, data) => events.push({ event, data }) };
  vm.runInNewContext(ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, { socket, user: { userId: 'host', name: 'Host' }, console,
    normalizeRoomId: String, getVoiceRoomState: async () => state,
    io: { to: target => ({ emit: (event, data) => events.push({ target, event, data }) }) },
  });
  return { state, events, socket, invite: data => handler({ roomId: 'room', targetUserId: 'guest', seatIndex: 1, ...data }) };
};

test('seat invitation reaches the active authenticated recipient for numeric or database ID', async () => {
  for (const targetUserId of ['guest', 'db-guest']) {
    const { invite, events } = setup();
    await invite({ targetUserId });
    const delivered = events.find(event => event.event === 'voice_room:seat_invitation');
    assert.equal(delivered.target, 'recipient-socket');
    assert.equal(delivered.data.roomId, 'room');
    assert.equal(delivered.data.seatIndex, 1);
  }
});

test('offline recipients, occupied seats and senders outside the room cannot send an invite', async () => {
  for (const mutate of [s => { delete s.state.onlineUsers.guest; },
    s => { s.state.seats[1].user = { userId: 'other' }; },
    s => { s.socket.voiceRoomId = 'other-room'; }]) {
    const subject = setup();
    mutate(subject);
    await subject.invite();
    assert.equal(subject.events.some(event => event.event === 'voice_room:seat_invitation'), false);
    assert.equal(subject.events[0].event, 'voice_room:error');
  }
});
