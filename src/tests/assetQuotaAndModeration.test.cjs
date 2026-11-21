const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Tiered Asset Stock Quota Allocation logic with Multi-Asset Allocation', () => {
  // Simulate Owner allocating multiple assets (e.g. Super Admin Frame + Dragon Entry + VIP Badge)
  const quotas = [
    {
      operatorId: 'operator_123',
      assetName: 'Super Admin Frame',
      assetCategory: 'Frames',
      packages: [
        { days: 30, allocatedQuantity: 1, remainingQuantity: 1 },
        { days: 15, allocatedQuantity: 2, remainingQuantity: 2 },
        { days: 7, allocatedQuantity: 2, remainingQuantity: 2 },
      ]
    },
    {
      operatorId: 'operator_123',
      assetName: 'Dragon Entry Effect',
      assetCategory: 'Entry',
      packages: [
        { days: 30, allocatedQuantity: 2, remainingQuantity: 2 },
        { days: 15, allocatedQuantity: 3, remainingQuantity: 3 },
      ]
    }
  ];

  assert.equal(quotas.length, 2, 'Should have 2 assets allocated in multi-allocation');
  const frameQuota = quotas[0];
  const totalFrameAllocated = frameQuota.packages.reduce((sum, p) => sum + p.allocatedQuantity, 0);
  assert.equal(totalFrameAllocated, 5, 'Total allocated quantity should be 5');

  // Helper simulating operator multi-grant (Frame + Entry)
  function operatorMultiGrant(grants) {
    const results = [];
    for (const g of grants) {
      const q = quotas.find(item => item.assetName === g.assetName);
      if (!q) throw new Error(`Asset ${g.assetName} not found in quota`);
      const pkg = q.packages.find(p => p.days === g.days);
      if (!pkg) throw new Error(`Package with ${g.days} days not available for ${g.assetName}`);
      if (pkg.remainingQuantity <= 0) throw new Error(`Out of stock for ${g.assetName} with ${g.days} days`);
      pkg.remainingQuantity -= 1;
      results.push({
        assetName: g.assetName,
        days: g.days,
        remainingStock: pkg.remainingQuantity
      });
    }
    return results;
  }

  // Multi-grant: 1x 30d Frame AND 1x 15d Dragon Entry Effect together!
  const results = operatorMultiGrant([
    { assetName: 'Super Admin Frame', days: 30 },
    { assetName: 'Dragon Entry Effect', days: 15 }
  ]);

  assert.equal(results.length, 2);
  assert.equal(results[0].remainingStock, 0, 'Frame 30d should now be 0');
  assert.equal(results[1].remainingStock, 2, 'Dragon Entry 15d should now be 2');

  // Attempting to grant Frame 30d again fails
  assert.throws(() => {
    operatorMultiGrant([{ assetName: 'Super Admin Frame', days: 30 }]);
  }, /Out of stock/);
});

test('Chat Restriction Deletion & Clear Logic', () => {
  const user = {
    userId: 10099,
    name: 'Restricted User',
    chatMuteUntil: new Date(Date.now() + 86400000),
    chatMuteReason: 'Repeated phone number sharing',
    chatMuteViolationCount: 3,
    lastEscalationAction: 'MUTED_24H',
    moderationRiskScore: 75,
    moderationRiskLevel: 'HIGH',
    accountReviewRequired: true,
  };

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
  assert.equal(user.chatMuteViolationCount, 0);
  assert.equal(user.lastEscalationAction, 'RESTRICTION_DELETED_BY_OWNER');
  assert.equal(user.moderationRiskLevel, 'LOW');
  assert.equal(result.deletedViolations, 3);
});
