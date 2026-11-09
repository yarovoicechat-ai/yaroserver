import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSendVipGift } from '../gift/gift.eligibility';

test('VIP gift eligibility uses the current displayed wealth level', () => {
  assert.equal(canSendVipGift({ wealthLevel: 110, level: 3 }), true);
  assert.equal(canSendVipGift({ wealthLevel: 4, level: 100 }), false);
  assert.equal(canSendVipGift({ wealthLevel: 5 }), true);
});

test('legacy profiles still require level five', () => {
  assert.equal(canSendVipGift({ level: 5 }), true);
  assert.equal(canSendVipGift({ level: 3 }), false);
  assert.equal(canSendVipGift({}), false);
});
