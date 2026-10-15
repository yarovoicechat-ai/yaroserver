import test from 'node:test';
import assert from 'node:assert/strict';

// Core logic unit tests for Identity Presentation & Expiry

interface MockEntitlement {
  userId: number;
  type: string;
  config: any;
  status: 'active' | 'expired' | 'revoked';
  startsAt: Date;
  expiresAt: Date;
}

interface MockUser {
  userId: number;
  name: string;
  userName: string;
  equippedCustomId?: string;
}

function resolveEffectiveMockIdentity(user: MockUser, entitlements: MockEntitlement[], asOfTime: Date = new Date()) {
  const permanentUserId = Number(user.userId);
  let effectiveDisplayId = String(permanentUserId);
  let isOfficial = false;
  let officialBadge = null;

  // Filter valid entitlements server-authoritatively without relying on worker
  const activeEntitlements = entitlements.filter(
    (e) =>
      e.status === 'active' &&
      new Date(e.startsAt).getTime() <= asOfTime.getTime() &&
      new Date(e.expiresAt).getTime() > asOfTime.getTime()
  );

  // 1. Official ID check
  const officialEntitlement = activeEntitlements.find((e) => e.type === 'official_id');
  if (officialEntitlement) {
    isOfficial = true;
    effectiveDisplayId = String(officialEntitlement.config?.displayId || 'Official');
    officialBadge = {
      badgeText: officialEntitlement.config?.badgeText || 'OFFICIAL',
      badgeAnimationType: officialEntitlement.config?.badgeAnimationType || 'gold_rotate',
    };
  } else {
    // 2. Custom Display ID
    const customEntitlement = activeEntitlements.find((e) => e.type === 'custom_display_id');
    if (customEntitlement && customEntitlement.config?.displayId) {
      effectiveDisplayId = String(customEntitlement.config.displayId);
    } else if (user.equippedCustomId) {
      effectiveDisplayId = String(user.equippedCustomId);
    }
  }

  return {
    permanentUserId,
    effectiveDisplayId,
    isOfficial,
    officialBadge,
    activeEntitlementsCount: activeEntitlements.length,
  };
}

function searchMockUsers(
  query: string,
  users: MockUser[],
  entitlements: MockEntitlement[],
  asOfTime: Date = new Date()
) {
  const q = query.trim().toLowerCase();
  const matchedUsers: MockUser[] = [];

  for (const user of users) {
    const userEntitlements = entitlements.filter((e) => e.userId === user.userId);
    const resolved = resolveEffectiveMockIdentity(user, userEntitlements, asOfTime);

    // 1. Permanent numeric ID exact match
    if (String(resolved.permanentUserId) === q) {
      matchedUsers.push(user);
      continue;
    }

    // 2. Username partial match
    if (user.userName.toLowerCase().includes(q)) {
      matchedUsers.push(user);
      continue;
    }

    // 3. Active Official ID or Active Custom ID (EXPIRED IDs MUST NOT MATCH)
    if (resolved.effectiveDisplayId.toLowerCase() === q && resolved.effectiveDisplayId !== String(resolved.permanentUserId)) {
      matchedUsers.push(user);
      continue;
    }
  }

  return matchedUsers;
}

/* =========================================================================
   ACCEPTANCE TESTS
========================================================================= */

test('1. Official ID is active during its validity period', () => {
  const user: MockUser = { userId: 1000000002, name: 'Alice', userName: 'alice_live' };
  const now = new Date('2026-10-15T12:00:00Z');
  const entitlements: MockEntitlement[] = [
    {
      userId: 1000000002,
      type: 'official_id',
      config: { displayId: 'Official', badgeText: 'OFFICIAL' },
      status: 'active',
      startsAt: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-10-31T00:00:00Z'),
    },
  ];

  const resolved = resolveEffectiveMockIdentity(user, entitlements, now);

  assert.equal(resolved.permanentUserId, 1000000002, 'Permanent ID must never change');
  assert.equal(resolved.effectiveDisplayId, 'Official', 'Effective display ID must be Official during validity');
  assert.equal(resolved.isOfficial, true);
  assert.notEqual(resolved.officialBadge, null);
  assert.equal(resolved.officialBadge?.badgeText, 'OFFICIAL');
});

test('2 & 3. Official ID expires exactly according to server timestamps and reverts to permanent numeric ID', () => {
  const user: MockUser = { userId: 1000000002, name: 'Alice', userName: 'alice_live' };
  // Check 1 second AFTER expiry
  const expiredTime = new Date('2026-11-01T00:00:01Z');
  const entitlements: MockEntitlement[] = [
    {
      userId: 1000000002,
      type: 'official_id',
      config: { displayId: 'Official', badgeText: 'OFFICIAL' },
      status: 'active', // Status in DB is still 'active' because background worker has NOT run yet
      startsAt: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-10-31T23:59:59Z'),
    },
  ];

  const resolved = resolveEffectiveMockIdentity(user, entitlements, expiredTime);

  // Must automatically drop official ID and revert to permanent numeric ID!
  assert.equal(resolved.permanentUserId, 1000000002);
  assert.equal(resolved.effectiveDisplayId, '1000000002', 'Must revert to permanent numeric ID');
  assert.equal(resolved.isOfficial, false, 'Must no longer be official');
  assert.equal(resolved.officialBadge, null, 'Official badge must disappear');
});

test('4. Expiry works even if background cleanup worker has not executed', () => {
  const user: MockUser = { userId: 1000000099, name: 'Bob', userName: 'bob_rep' };
  const currentTime = new Date('2026-10-16T00:00:00Z');
  const entitlements: MockEntitlement[] = [
    {
      userId: 1000000099,
      type: 'official_id',
      config: { displayId: 'YaroStaff', badgeText: 'STAFF' },
      status: 'active', // Stale active status
      startsAt: new Date('2026-09-01T00:00:00Z'),
      expiresAt: new Date('2026-10-01T00:00:00Z'), // Expired 15 days ago
    },
  ];

  const resolved = resolveEffectiveMockIdentity(user, entitlements, currentTime);
  assert.equal(resolved.effectiveDisplayId, '1000000099', 'Stale active status in DB does NOT bypass timestamp check');
  assert.equal(resolved.isOfficial, false);
});

test('5 & 6. Expired custom IDs cannot be found in search, permanent ID search always works', () => {
  const users: MockUser[] = [
    { userId: 1000000001, name: 'Legend', userName: 'legendary' },
    { userId: 1000000002, name: 'Alice', userName: 'alice_live' },
  ];

  const entitlements: MockEntitlement[] = [
    {
      userId: 1000000002,
      type: 'official_id',
      config: { displayId: 'SuperOfficial' },
      status: 'active',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      expiresAt: new Date('2026-10-01T00:00:00Z'), // Expired
    },
  ];

  const now = new Date('2026-10-15T00:00:00Z');

  // Searching by expired official display ID 'SuperOfficial' MUST return 0 users
  const searchExpired = searchMockUsers('SuperOfficial', users, entitlements, now);
  assert.equal(searchExpired.length, 0, 'Expired official display ID must NOT resolve in search');

  // Searching by permanent numeric ID '1000000002' MUST return Alice
  const searchPermanent = searchMockUsers('1000000002', users, entitlements, now);
  assert.equal(searchPermanent.length, 1);
  assert.equal(searchPermanent[0].userId, 1000000002);
});

test('7. Multiple entitlements priority: Official ID supersedes vanity ID, revocation restores numeric ID', () => {
  const user: MockUser = { userId: 1000000055, name: 'Carol', userName: 'carol_star' };
  const now = new Date('2026-10-15T00:00:00Z');

  // User has both an active custom vanity ID ('Carol777') AND an active Official ID ('Official')
  const entitlements: MockEntitlement[] = [
    {
      userId: 1000000055,
      type: 'custom_display_id',
      config: { displayId: 'Carol777' },
      status: 'active',
      startsAt: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-11-01T00:00:00Z'),
    },
    {
      userId: 1000000055,
      type: 'official_id',
      config: { displayId: 'Official' },
      status: 'active',
      startsAt: new Date('2026-10-01T00:00:00Z'),
      expiresAt: new Date('2026-11-01T00:00:00Z'),
    },
  ];

  // 1. Official ID takes highest presentation precedence
  const r1 = resolveEffectiveMockIdentity(user, entitlements, now);
  assert.equal(r1.effectiveDisplayId, 'Official');
  assert.equal(r1.isOfficial, true);

  // 2. Revoke Official ID -> Falls back to custom vanity ID
  entitlements[1].status = 'revoked';
  const r2 = resolveEffectiveMockIdentity(user, entitlements, now);
  assert.equal(r2.effectiveDisplayId, 'Carol777');
  assert.equal(r2.isOfficial, false);

  // 3. Revoke Vanity ID -> Falls back to permanent numeric ID
  entitlements[0].status = 'revoked';
  const r3 = resolveEffectiveMockIdentity(user, entitlements, now);
  assert.equal(r3.effectiveDisplayId, '1000000055');
  assert.equal(r3.isOfficial, false);
});
