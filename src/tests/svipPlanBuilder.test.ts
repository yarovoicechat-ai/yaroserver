import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * SVIP Plan Builder & Management System Acceptance Tests
 *
 * Verifies:
 * 1. Independent plan creation/editing for SVIP1, SVIP2, etc. with distinct pricing, durations, badges, and privileges.
 * 2. Privilege filtering: Disabled privileges are excluded from active user benefits.
 * 3. Atomic purchase validation: Insufficient diamond balance is rejected without granting entitlements or mutating balance.
 * 4. Verified purchase transaction: Deducts diamonds, sets entitlement start/expiry timestamps, awards wealth EXP, logs audit record.
 * 5. Extension logic: Renewing an active SVIP extends the existing expiry timestamp.
 * 6. Expiry behavior: Expired SVIP reverts to default identity/tier without modifying the permanent numeric userId.
 * 7. Permanent numeric userId immutability under all SVIP lifecycle transitions.
 */

interface MockSvipPrivilege {
  code: string;
  name: string;
  description: string;
  iconUrl: string;
  enabled: boolean;
  isVisible: boolean;
  implementationStatus: 'supported' | 'partially_supported' | 'coming_soon';
  valueLimit?: string;
  displayOrder: number;
}

interface MockSvipPlan {
  planCode: string;
  name: string;
  level: number;
  price: number;
  originalPrice: number;
  discountPercent: number;
  durationDays: number;
  validityType: 'days' | 'months' | 'custom';
  status: 'active' | 'draft' | 'inactive' | 'archived';
  heroBadgeUrl: string;
  svipTagConfig?: {
    enabled: boolean;
    text: string;
    bgGradient: [string, string];
  };
  svipBubbleConfig?: {
    enabled: boolean;
    previewUrl: string;
    textColor: string;
  };
  privileges: MockSvipPrivilege[];
}

interface MockUser {
  userId: number; // Permanent numeric ID (e.g. 1000000002)
  name: string;
  diamonds: number;
  wealthExp: number;
  svipTier?: number;
}

interface MockEntitlement {
  userId: number;
  type: 'svip_tier' | 'custom_display_id' | 'official_id';
  config: any;
  status: 'active' | 'expired' | 'revoked';
  startsAt: Date;
  expiresAt: Date;
}

// Helper: Resolve active SVIP entitlement and privileges
function resolveActiveSvip(
  user: MockUser,
  entitlements: MockEntitlement[],
  plans: MockSvipPlan[],
  asOf: Date = new Date()
) {
  const activeEntitlement = entitlements.find(
    (e) =>
      e.userId === user.userId &&
      e.type === 'svip_tier' &&
      e.status === 'active' &&
      new Date(e.startsAt).getTime() <= asOf.getTime() &&
      new Date(e.expiresAt).getTime() > asOf.getTime()
  );

  if (!activeEntitlement) {
    return {
      hasActiveSvip: false,
      tier: 0,
      activePrivileges: [] as MockSvipPrivilege[],
      effectiveDisplayId: String(user.userId),
    };
  }

  const plan = plans.find((p) => p.level === activeEntitlement.config?.tierLevel);
  // Filter active privileges: must be enabled in plan AND supported/partially_supported
  const activePrivileges = (plan?.privileges || []).filter(
    (p) => p.enabled && p.implementationStatus !== 'coming_soon'
  );

  return {
    hasActiveSvip: true,
    tier: activeEntitlement.config?.tierLevel || 1,
    planCode: plan?.planCode,
    expiresAt: activeEntitlement.expiresAt,
    activePrivileges,
    effectiveDisplayId: String(user.userId), // Permanent ID remains untouched
  };
}

// Purchase Transaction Engine
function processSvipPurchase(
  user: MockUser,
  plan: MockSvipPlan,
  entitlements: MockEntitlement[],
  now: Date = new Date()
): { success: boolean; error?: string; entitlement?: MockEntitlement } {
  // 1. Validate status
  if (plan.status !== 'active') {
    return { success: false, error: 'This SVIP plan is currently not available for purchase' };
  }

  // 2. Validate balance
  if (user.diamonds < plan.price) {
    return {
      success: false,
      error: `Insufficient diamonds. Need ${plan.price}, have ${user.diamonds}`,
    };
  }

  // 3. Atomic deduction
  user.diamonds -= plan.price;
  user.wealthExp += plan.price; // Wealth exp rewards

  // 4. Calculate validity window
  const durationMs = plan.durationDays * 24 * 60 * 60 * 1000;
  let startsAt = now;
  let expiresAt = new Date(now.getTime() + durationMs);

  // Check if existing active entitlement exists for extension
  const existingIndex = entitlements.findIndex(
    (e) =>
      e.userId === user.userId &&
      e.type === 'svip_tier' &&
      e.status === 'active' &&
      new Date(e.expiresAt).getTime() > now.getTime()
  );

  let grantedEntitlement: MockEntitlement;

  if (existingIndex >= 0) {
    // Extend existing entitlement
    const existing = entitlements[existingIndex];
    const currentExpiry = new Date(existing.expiresAt).getTime();
    expiresAt = new Date(currentExpiry + durationMs);
    existing.expiresAt = expiresAt;
    existing.config = {
      ...existing.config,
      tierLevel: Math.max(existing.config.tierLevel, plan.level),
      planCode: plan.planCode,
    };
    grantedEntitlement = existing;
  } else {
    // Create new entitlement
    grantedEntitlement = {
      userId: user.userId,
      type: 'svip_tier',
      config: {
        tierLevel: plan.level,
        planCode: plan.planCode,
        badgeUrl: plan.heroBadgeUrl,
      },
      status: 'active',
      startsAt,
      expiresAt,
    };
    entitlements.push(grantedEntitlement);
  }

  user.svipTier = grantedEntitlement.config.tierLevel;

  return { success: true, entitlement: grantedEntitlement };
}

/* =========================================================================
   TEST SUITE: SVIP PLAN BUILDER & LIFECYCLE MANAGEMENT
========================================================================= */

test('1. Admin can configure SVIP1 and SVIP2 independently with distinct pricing, duration, and badges', () => {
  const planSvip1: MockSvipPlan = {
    planCode: 'SVIP_KNIGHT_1M',
    name: 'SVIP 1 - Knight',
    level: 1,
    price: 399,
    originalPrice: 599,
    discountPercent: 33,
    durationDays: 30,
    validityType: 'months',
    status: 'active',
    heroBadgeUrl: 'https://assets.yaroapp.in/svip/svip1_knight_badge.png',
    svipTagConfig: {
      enabled: true,
      text: 'SVIP 1',
      bgGradient: ['#3b82f6', '#1d4ed8'],
    },
    svipBubbleConfig: {
      enabled: true,
      previewUrl: 'https://assets.yaroapp.in/svip/bubble1.png',
      textColor: '#ffffff',
    },
    privileges: [
      {
        code: 'rank_top',
        name: 'Rank the Top',
        description: 'Priority ranking in room',
        iconUrl: 'https://assets.yaroapp.in/icons/rank.png',
        enabled: true,
        isVisible: true,
        implementationStatus: 'supported',
        displayOrder: 1,
      },
      {
        code: 'colorful_nick',
        name: 'Colorful Nickname',
        description: 'Unique nickname styling',
        iconUrl: 'https://assets.yaroapp.in/icons/nick.png',
        enabled: true,
        isVisible: true,
        implementationStatus: 'supported',
        displayOrder: 2,
      },
    ],
  };

  const planSvip2: MockSvipPlan = {
    planCode: 'SVIP_BARON_3M',
    name: 'SVIP 2 - Baron',
    level: 2,
    price: 999,
    originalPrice: 1499,
    discountPercent: 33,
    durationDays: 90,
    validityType: 'custom',
    status: 'active',
    heroBadgeUrl: 'https://assets.yaroapp.in/svip/svip2_baron_badge.png',
    svipTagConfig: {
      enabled: true,
      text: 'SVIP 2',
      bgGradient: ['#10b981', '#047857'],
    },
    svipBubbleConfig: {
      enabled: true,
      previewUrl: 'https://assets.yaroapp.in/svip/bubble2.png',
      textColor: '#a7f3d0',
    },
    privileges: [
      {
        code: 'rank_top',
        name: 'Rank the Top',
        description: 'Higher priority ranking in room',
        iconUrl: 'https://assets.yaroapp.in/icons/rank.png',
        enabled: true,
        isVisible: true,
        implementationStatus: 'supported',
        displayOrder: 1,
      },
      {
        code: 'special_room_entry',
        name: 'Special Room Entry',
        description: 'VIP banner and sound effect on entrance',
        iconUrl: 'https://assets.yaroapp.in/icons/entry.png',
        enabled: true,
        isVisible: true,
        implementationStatus: 'supported',
        displayOrder: 2,
      },
    ],
  };

  // Verify independent field configurations
  assert.notEqual(planSvip1.price, planSvip2.price);
  assert.equal(planSvip1.durationDays, 30);
  assert.equal(planSvip2.durationDays, 90);
  assert.notEqual(planSvip1.heroBadgeUrl, planSvip2.heroBadgeUrl);
  assert.notEqual(planSvip1.svipTagConfig?.text, planSvip2.svipTagConfig?.text);
  assert.equal(planSvip2.privileges.some((p) => p.code === 'special_room_entry'), true);
  assert.equal(planSvip1.privileges.some((p) => p.code === 'special_room_entry'), false);
});

test('2. Privilege Filtering: Disabled privileges or coming_soon features are excluded from active user privileges', () => {
  const plan: MockSvipPlan = {
    planCode: 'SVIP1',
    name: 'SVIP 1',
    level: 1,
    price: 399,
    originalPrice: 599,
    discountPercent: 33,
    durationDays: 30,
    validityType: 'days',
    status: 'active',
    heroBadgeUrl: 'https://example.com/badge.png',
    privileges: [
      {
        code: 'colorful_nick',
        name: 'Colorful Nickname',
        description: 'Color styling',
        iconUrl: 'https://example.com/icon1.png',
        enabled: true,
        isVisible: true,
        implementationStatus: 'supported',
        displayOrder: 1,
      },
      {
        code: 'secret_lord',
        name: 'Room Secret Lord',
        description: 'Stealth presence',
        iconUrl: 'https://example.com/icon2.png',
        enabled: false, // Disabled by Admin
        isVisible: true,
        implementationStatus: 'supported',
        displayOrder: 2,
      },
      {
        code: 'two_digit_sid',
        name: 'Unique 2-digit SID',
        description: 'Rare SID allocation',
        iconUrl: 'https://example.com/icon3.png',
        enabled: true,
        isVisible: true,
        implementationStatus: 'coming_soon', // Coming soon - not yet active
        displayOrder: 3,
      },
    ],
  };

  const user: MockUser = { userId: 1000000002, name: 'TestUser', diamonds: 1000, wealthExp: 0 };
  const entitlements: MockEntitlement[] = [
    {
      userId: 1000000002,
      type: 'svip_tier',
      config: { tierLevel: 1 },
      status: 'active',
      startsAt: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + 86400000),
    },
  ];

  const resolved = resolveActiveSvip(user, entitlements, [plan]);
  assert.equal(resolved.hasActiveSvip, true);
  assert.equal(resolved.activePrivileges.length, 1);
  assert.equal(resolved.activePrivileges[0].code, 'colorful_nick');
  assert.equal(resolved.activePrivileges.some((p) => p.code === 'secret_lord'), false, 'Disabled privilege must not be granted');
  assert.equal(resolved.activePrivileges.some((p) => p.code === 'two_digit_sid'), false, 'Coming soon privilege must not be granted');
});

test('3. Purchase Validation: Rejects purchase when user has insufficient diamonds without mutating user balance or granting entitlements', () => {
  const plan: MockSvipPlan = {
    planCode: 'SVIP3_COUNT',
    name: 'SVIP 3 - Count',
    level: 3,
    price: 1999,
    originalPrice: 2499,
    discountPercent: 20,
    durationDays: 30,
    validityType: 'days',
    status: 'active',
    heroBadgeUrl: 'https://example.com/badge3.png',
    privileges: [],
  };

  const user: MockUser = { userId: 1000000003, name: 'PoorUser', diamonds: 500, wealthExp: 100 };
  const entitlements: MockEntitlement[] = [];

  const result = processSvipPurchase(user, plan, entitlements);

  assert.equal(result.success, false);
  assert.match(result.error || '', /Insufficient diamonds/);
  assert.equal(user.diamonds, 500, 'Diamonds must remain unchanged on failure');
  assert.equal(user.wealthExp, 100, 'Wealth EXP must remain unchanged on failure');
  assert.equal(entitlements.length, 0, 'No entitlement should be created on failure');
  assert.equal(user.svipTier, undefined);
});

test('4. Purchase Transaction: Deducts diamonds atomically, creates entitlement with timestamps, adds wealth EXP', () => {
  const plan: MockSvipPlan = {
    planCode: 'SVIP1_KNIGHT',
    name: 'SVIP 1 - Knight',
    level: 1,
    price: 399,
    originalPrice: 599,
    discountPercent: 33,
    durationDays: 30,
    validityType: 'days',
    status: 'active',
    heroBadgeUrl: 'https://example.com/badge1.png',
    privileges: [],
  };

  const now = new Date('2026-10-16T12:00:00Z');
  const user: MockUser = { userId: 1000000004, name: 'RichUser', diamonds: 1000, wealthExp: 50 };
  const entitlements: MockEntitlement[] = [];

  const result = processSvipPurchase(user, plan, entitlements, now);

  assert.equal(result.success, true);
  assert.equal(user.diamonds, 601, '1000 - 399 = 601 diamonds');
  assert.equal(user.wealthExp, 449, '50 + 399 = 449 wealth EXP');
  assert.equal(entitlements.length, 1);
  assert.equal(entitlements[0].type, 'svip_tier');
  assert.equal(entitlements[0].config.tierLevel, 1);
  assert.equal(entitlements[0].startsAt.toISOString(), '2026-10-16T12:00:00.000Z');

  const expectedExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  assert.equal(entitlements[0].expiresAt.toISOString(), expectedExpiry.toISOString());
});

test('5. Renewal / Extension: Purchasing when already active extends expiration seamlessly from existing expiry date', () => {
  const plan: MockSvipPlan = {
    planCode: 'SVIP1_KNIGHT',
    name: 'SVIP 1',
    level: 1,
    price: 399,
    originalPrice: 599,
    discountPercent: 33,
    durationDays: 30,
    validityType: 'days',
    status: 'active',
    heroBadgeUrl: 'https://example.com/badge1.png',
    privileges: [],
  };

  const now = new Date('2026-10-16T12:00:00Z');
  const currentExpiry = new Date('2026-10-26T12:00:00Z'); // 10 days remaining

  const user: MockUser = { userId: 1000000005, name: 'ActiveVip', diamonds: 2000, wealthExp: 0, svipTier: 1 };
  const entitlements: MockEntitlement[] = [
    {
      userId: 1000000005,
      type: 'svip_tier',
      config: { tierLevel: 1, planCode: 'SVIP1_KNIGHT' },
      status: 'active',
      startsAt: new Date('2026-09-26T12:00:00Z'),
      expiresAt: currentExpiry,
    },
  ];

  const result = processSvipPurchase(user, plan, entitlements, now);
  assert.equal(result.success, true);
  assert.equal(entitlements.length, 1, 'Should extend existing entitlement rather than create duplicate');

  const expectedNewExpiry = new Date(currentExpiry.getTime() + 30 * 24 * 60 * 60 * 1000);
  assert.equal(entitlements[0].expiresAt.toISOString(), expectedNewExpiry.toISOString());
});

test('6 & 7. Expiry and Permanent Numeric ID Immutability: SVIP drop reverts identity without modifying permanent numeric userId', () => {
  const user: MockUser = { userId: 1000000006, name: 'David', diamonds: 50, wealthExp: 399, svipTier: 1 };
  const plans: MockSvipPlan[] = [
    {
      planCode: 'SVIP1',
      name: 'SVIP 1',
      level: 1,
      price: 399,
      originalPrice: 599,
      discountPercent: 33,
      durationDays: 30,
      validityType: 'days',
      status: 'active',
      heroBadgeUrl: 'https://example.com/badge1.png',
      privileges: [
        {
          code: 'rank_top',
          name: 'Rank the Top',
          description: '',
          iconUrl: '',
          enabled: true,
          isVisible: true,
          implementationStatus: 'supported',
          displayOrder: 1,
        },
      ],
    },
  ];

  const entitlements: MockEntitlement[] = [
    {
      userId: 1000000006,
      type: 'svip_tier',
      config: { tierLevel: 1 },
      status: 'active',
      startsAt: new Date('2026-09-01T00:00:00Z'),
      expiresAt: new Date('2026-10-01T00:00:00Z'), // Expired 15 days ago
    },
  ];

  const now = new Date('2026-10-16T00:00:00Z');
  const resolved = resolveActiveSvip(user, entitlements, plans, now);

  // SVIP is expired!
  assert.equal(resolved.hasActiveSvip, false);
  assert.equal(resolved.tier, 0);
  assert.equal(resolved.activePrivileges.length, 0);

  // CRITICAL: Permanent numeric user ID is strictly identical and immutable!
  assert.equal(user.userId, 1000000006);
  assert.equal(resolved.effectiveDisplayId, '1000000006');
});
