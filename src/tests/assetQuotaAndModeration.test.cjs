const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Tiered Asset Stock Quota Allocation logic', () => {
  // Simulate Owner allocating 5x Super Admin Frame with duration packages:
  // 1x 30 days, 2x 15 days, 2x 7 days
  const quota = {
    operatorId: 'operator_123',
    assetName: 'Super Admin Frame',
    assetCategory: 'Frames',
    packages: [
      { days: 30, allocatedQuantity: 1, remainingQuantity: 1 },
      { days: 15, allocatedQuantity: 2, remainingQuantity: 2 },
      { days: 7, allocatedQuantity: 2, remainingQuantity: 2 },
    ]
  };

  const totalAllocated = quota.packages.reduce((sum, p) => sum + p.allocatedQuantity, 0);
  assert.equal(totalAllocated, 5, 'Total allocated quantity should be 5');

  // Helper simulating operator grant
  function operatorGrant(requestedDays) {
    const pkg = quota.packages.find(p => p.days === requestedDays);
    if (!pkg) {
      throw new Error(`Package with ${requestedDays} days not available`);
    }
    if (pkg.remainingQuantity <= 0) {
      throw new Error(`Out of stock for ${requestedDays} days`);
    }
    pkg.remainingQuantity -= 1;
    const expiresAt = new Date(Date.now() + requestedDays * 86400000);
    return {
      assetName: quota.assetName,
      days: requestedDays,
      expiresAt,
      remainingStock: pkg.remainingQuantity
    };
  }

  // 1. Operator grants 30 days frame to User A
  const grant1 = operatorGrant(30);
  assert.equal(grant1.remainingStock, 0, 'Remaining 30-day stock should now be 0');
  assert.ok(grant1.expiresAt.getTime() > Date.now(), 'ExpiresAt should be in the future');

  // 2. Operator attempts to grant 30 days frame to User B (should fail)
  assert.throws(() => {
    operatorGrant(30);
  }, /Out of stock for 30 days/);

  // 3. Operator grants 15 days frame to User C
  const grant2 = operatorGrant(15);
  assert.equal(grant2.remainingStock, 1, 'Remaining 15-day stock should now be 1');

  // 4. Operator grants 15 days frame to User D
  const grant3 = operatorGrant(15);
  assert.equal(grant3.remainingStock, 0, 'Remaining 15-day stock should now be 0');

  // 5. Operator attempts to grant 15 days again (should fail)
  assert.throws(() => {
    operatorGrant(15);
  }, /Out of stock for 15 days/);

  // 6. 7 days frame still has 2 available
  const pkg7 = quota.packages.find(p => p.days === 7);
  assert.equal(pkg7.remainingQuantity, 2);
});

test('Chat Restriction Deletion & Clear Logic', () => {
  // Simulate user with chat restriction
  const user = {
    userId: 10099,
    name: 'Restricted User',
    chatMuteUntil: new Date(Date.now() + 86400000), // muted for 24h
    chatMuteReason: 'Repeated phone number sharing',
    chatMuteViolationCount: 3,
    lastEscalationAction: 'MUTED_24H',
    moderationRiskScore: 75,
    moderationRiskLevel: 'HIGH',
    accountReviewRequired: true,
  };

  // Simulate Owner clearing restrictions
  function ownerClearRestrictions(targetUser, deleteViolations) {
    targetUser.chatMuteUntil = undefined;
    targetUser.chatMuteReason = '';
    targetUser.chatMuteViolationCount = 0;
    targetUser.lastEscalationAction = 'RESTRICTION_DELETED_BY_OWNER';
    targetUser.accountReviewRequired = false;
    targetUser.accountReviewReason = '';
    targetUser.moderationRiskScore = 0;
    targetUser.moderationRiskLevel = 'LOW';
    return {
      deletedViolations: deleteViolations ? 3 : 0
    };
  }

  const result = ownerClearRestrictions(user, true);
  assert.equal(user.chatMuteUntil, undefined, 'chatMuteUntil should be cleared');
  assert.equal(user.chatMuteViolationCount, 0, 'chatMuteViolationCount should be reset to 0');
  assert.equal(user.lastEscalationAction, 'RESTRICTION_DELETED_BY_OWNER');
  assert.equal(user.moderationRiskLevel, 'LOW');
  assert.equal(result.deletedViolations, 3);
});
