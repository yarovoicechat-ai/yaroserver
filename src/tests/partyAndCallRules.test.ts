import test from 'node:test';
import assert from 'node:assert/strict';
import { withDistributedLock } from '../utils/distributedLock';
import { allocateRoomSeat } from '../utils/roomSeatRules';
import { getOrCreateConversationPair } from '../utils/conversationPair';
import {
  canActOnAdminOperatorRequest,
  getAdminOperatorApprovalStage,
} from '../utils/emsApprovalRules';
import { RequestStatus } from '../models/request.model';
import { isProtectedTeamAccount } from '../utils/roomModerationRules';
import { hasRoomVoicePublisherAccess } from '../utils/roomVoiceAuthorization';
import { getCallActivityContent } from '../utils/callActivityRules';

class FakeRedis {
  private values = new Map<string, string>();

  async set(key: string, token: string, ...options: any[]) {
    if (options.includes('NX') && this.values.has(key)) return null;
    this.values.set(key, token);
    return 'OK';
  }

  async eval(_script: string, _keyCount: number, key: string, token: string) {
    if (this.values.get(key) === token) this.values.delete(key);
    return 1;
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('serializes concurrent seat claims and preserves other occupants', async () => {
  const redis = new FakeRedis();
  const sharedState = {
    diamonds: 120,
    seats: [
      { seatIndex: 0, user: { userId: 'host' }, isMuted: false, isLocked: false },
      { seatIndex: 1, user: null, isMuted: true, isLocked: false },
      { seatIndex: 2, user: { userId: 'already-seated' }, isMuted: true, isLocked: false },
    ],
  };

  const results = await Promise.allSettled(['alice', 'bob'].map((userId) =>
    withDistributedLock(redis, 'room:seat', async () => {
      await delay(5);
      const allocation = allocateRoomSeat(sharedState, 1, { userId }, true);
      sharedState.seats = allocation.state.seats;
    }, { ttlMs: 1_000, waitMs: 500, retryDelayMs: 1 }),
  ));

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.ok(['alice', 'bob'].includes(String(sharedState.seats[1].user?.userId)));
  assert.equal(sharedState.seats[0].user?.userId, 'host');
  assert.equal(sharedState.seats[2].user?.userId, 'already-seated');
  assert.equal(sharedState.diamonds, 120, 'room seat allocation must not deduct diamonds');
});

test('reuses a single private conversation for concurrent opens of the same pair', async () => {
  const redis = new FakeRedis();
  const conversations: Array<{ participants: [string, string] }> = [];
  let creates = 0;
  const repository = {
    find: async (pair: [string, string]) => conversations.find((item) => item.participants.join(':') === pair.join(':')) || null,
    create: async (pair: [string, string]) => {
      creates += 1;
      const conversation = { participants: pair };
      conversations.push(conversation);
      return conversation;
    },
    withLock: <T>(key: string, task: () => Promise<T>) =>
      withDistributedLock(redis, key, task, { ttlMs: 1_000, waitMs: 500, retryDelayMs: 1 }),
  };

  const opened = await Promise.all(Array.from({ length: 8 }, () =>
    getOrCreateConversationPair('user-b', 'user-a', repository),
  ));

  assert.equal(creates, 1);
  assert.equal(new Set(opened).size, 1);
  assert.deepEqual(opened[0].participants, ['user-a', 'user-b']);
});

test('requires Admin approval before Operator final approval and blocks terminal requests', () => {
  const request: any = { role: 'Hosting', status: RequestStatus.PENDING, approvedBy: [] };
  assert.deepEqual(getAdminOperatorApprovalStage(request), {
    index: 0, role: 'admin', label: 'Stage 1: Admin Approval',
  });
  assert.equal(canActOnAdminOperatorRequest(request, 'admin'), true);
  assert.equal(canActOnAdminOperatorRequest(request, 'operator'), false);

  request.approvedBy.push({ role: 'Admin' });
  request.status = RequestStatus.UNDER_REVIEW;
  assert.equal(getAdminOperatorApprovalStage(request).role, 'operator');
  assert.equal(canActOnAdminOperatorRequest(request, 'admin'), false);
  assert.equal(canActOnAdminOperatorRequest(request, 'operator'), true);
  request.status = RequestStatus.APPROVED;
  assert.equal(canActOnAdminOperatorRequest(request, 'operator'), false);
});

test('protects team accounts using server role and official powers', () => {
  assert.equal(isProtectedTeamAccount({ role: 'admin' }), true);
  assert.equal(isProtectedTeamAccount({ role: 'superAdmin' }), true);
  assert.equal(isProtectedTeamAccount({ role: 'user', officialPowers: { canGhostEntry: true } }), true);
  assert.equal(isProtectedTeamAccount({ role: 'user', officialPowers: {} }), false);
});

test('grants room publisher tokens only to the owner or an unmuted seated member', () => {
  const common = {
    userId: 'mongo-user-1',
    numericUserId: '1000000001',
    roomOwnerId: 'mongo-owner',
    roomChannelName: '1000000009',
    requestedRoomId: '1000000009',
    seats: [
      { user: { userId: '1000000001' }, isMuted: false },
      { user: { userId: '1000000002' }, isMuted: true },
      { user: null, isMuted: true },
    ],
  };

  assert.equal(hasRoomVoicePublisherAccess({ ...common, userId: 'mongo-owner', numericUserId: '1000000009', seats: [] }), true);
  assert.equal(hasRoomVoicePublisherAccess(common), true, 'unmuted seat holder may publish');
  assert.equal(hasRoomVoicePublisherAccess({ ...common, numericUserId: '1000000002' }), true, 'seated member may publish');
  assert.equal(hasRoomVoicePublisherAccess({ ...common, numericUserId: '1000000003' }), false, 'audience member may not publish');
});

test('formats call activity updates across ringing, accepted, missed, rejected and ended states', () => {
  assert.deepEqual(getCallActivityContent('ringing', 'host', 'Asha'), {
    title: 'Incoming call', message: 'Asha is calling you',
  });
  assert.deepEqual(getCallActivityContent('accepted', 'caller', 'Ravi'), {
    title: 'Call accepted', message: 'Ravi accepted your call',
  });
  assert.deepEqual(getCallActivityContent('missed', 'host', 'Asha'), {
    title: 'Missed call', message: 'You missed a call from Asha',
  });
  assert.equal(getCallActivityContent('rejected', 'caller', 'Ravi').title, 'Call declined');
  assert.equal(getCallActivityContent('ended', 'host', 'Asha').title, 'Call ended');
});
