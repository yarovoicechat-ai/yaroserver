import test from 'node:test';
import assert from 'node:assert/strict';
import { canEnterLockedRoom, roomPinGrantKey, roomPinVersion } from '../utils/roomLockAccess';

const room = { _id: 'room-db-id', ownerId: 'owner-db-id', channelName: '1000000001', isLocked: true, pinHash: 'hashed-pin' };
test('locked rooms require a verified grant for ordinary members', () => {
  assert.equal(canEnterLockedRoom(room, { id: 'visitor', userId: 2 }), false);
  assert.equal(canEnterLockedRoom(room, { id: 'visitor', userId: 2 }, roomPinVersion(room)), true);
  assert.notEqual(roomPinGrantKey(room, 'visitor'), roomPinGrantKey(room, 'another-user'));
});
test('changing PIN revokes previous verification and PIN-less locks fail closed', () => {
  assert.equal(canEnterLockedRoom({ ...room, pinHash: 'new-pin' }, { id: 'visitor' }, roomPinVersion(room)), false);
  assert.equal(canEnterLockedRoom({ ...room, pinHash: '' }, { id: 'visitor' }, roomPinVersion(room)), false);
});
test('owner and explicit official manager bypass PIN, ordinary admin roles do not', () => {
  assert.equal(canEnterLockedRoom(room, { id: room.ownerId }), true);
  assert.equal(canEnterLockedRoom(room, { id: 'official' }, null, true), true);
  assert.equal(canEnterLockedRoom(room, { id: 'other', role: 'owner' }), false);
  assert.equal(canEnterLockedRoom(room, { id: 'other', role: 'superAdmin' }), false);
});
test('unlocking makes the room public without a stale grant requirement', () => {
  assert.equal(canEnterLockedRoom({ ...room, isLocked: false }, { id: 'visitor' }), true);
});
