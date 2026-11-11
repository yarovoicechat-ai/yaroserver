import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeRoomSeats, allocateRoomSeat } from '../utils/roomSeatRules';
import { explicitRoomPowers } from '../utils/roomOfficialPowers';

const empty = (count: number) => ({ seatCount: count, seats: Array.from({ length: count + 2 }, (_, seatIndex) => ({
  seatIndex, user: null as any, isMuted: true, isLocked: false,
})) });

test('8 to 12 seats preserves occupants and enables every new seat', () => {
  const initial = empty(8);
  initial.seats[3].user = { userId: 'existing' };
  const expanded = resizeRoomSeats(initial, 12);
  assert.equal(expanded.seats.length, 14);
  assert.equal(expanded.seats[3].user.userId, 'existing');
  assert.equal(allocateRoomSeat(expanded, 11, { userId: 'new' }).seatIndex, 11);
  assert.equal(initial.seats.length, 10);
});
test('shrinking relocates users without losing their mute state or identity', () => {
  const initial = empty(12);
  initial.seats[0].user = { userId: 'host' };
  initial.seats[11].user = { userId: 'guest' };
  initial.seats[11].isMuted = false;
  const shrunk = resizeRoomSeats(initial, 8);
  assert.equal(shrunk.seats.length, 10);
  assert.equal(shrunk.seats[0].user.userId, 'host');
  const guest = shrunk.seats.find(seat => seat.user?.userId === 'guest');
  assert.ok(guest);
  assert.equal(guest.isMuted, false);
  assert.ok(guest.seatIndex < 10);
  assert.equal(shrunk.seats.filter(seat => seat.user).length, 2);
});

test('moving or retaking a seat preserves the current microphone state', () => {
  for (const muted of [false, true]) {
    const initial = empty(8);
    initial.seats[3] = { ...initial.seats[3], user: { userId: 'speaker' }, isMuted: muted };
    for (const target of [3, 5]) {
      const { state } = allocateRoomSeat(initial, target, { userId: 'speaker', name: 'Updated' }, true);
      assert.equal(state.seats[target].isMuted, muted);
      assert.equal(state.seats.filter(seat => seat.user?.userId === 'speaker').length, 1);
      assert.equal(initial.seats[3].isMuted, muted);
    }
  }
});

test('a new audience member still joins with the requested default mute state', () => {
  for (const muted of [true, false]) {
    const { state } = allocateRoomSeat(empty(8), 3, { userId: 'new' }, muted);
    assert.equal(state.seats[3].isMuted, muted);
  }
});
test('an overcrowded shrink is rejected without modifying any seats', () => {
  const initial = empty(12);
  initial.seats.forEach((seat, index) => { seat.user = { userId: String(index) }; });
  const before = JSON.stringify(initial);
  assert.throws(() => resizeRoomSeats(initial, 8), /Not enough empty seats/);
  assert.equal(JSON.stringify(initial), before);
});
test('account names, badges, and hierarchy roles do not grant room powers', () => {
  for (const role of ['user', 'bd', 'bdLeader', 'admin', 'superAdmin', 'owner']) {
    const powers = explicitRoomPowers({ role, name: 'Rudransh', isOfficial: true, specialCode: 'SPECIAL' });
    assert.ok(Object.values(powers).every(value => value === false));
  }
});
test('individual panel powers stay separate and manager access must be explicit', () => {
  const single = explicitRoomPowers({ officialPowers: { canMuteAnyUser: true } });
  assert.equal(single.canMuteAnyUser, true);
  assert.equal(single.canKickAnyUser, false);
  assert.equal(single.isGlobalRoomManager, false);
  assert.equal(explicitRoomPowers({ officialPowers: { isGlobalRoomManager: true } }).isGlobalRoomManager, true);
});
