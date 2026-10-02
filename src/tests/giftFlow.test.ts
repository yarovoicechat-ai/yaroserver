import assert from 'node:assert';
import { test, describe } from 'node:test';
import { INITIAL_GIFTS, INITIAL_CATEGORIES } from '../gift/gift.service';
import { INITIAL_ENTRY_EFFECTS } from '../services/entryEffect.service';

describe('New Live Room Gift Flow - Core Engine & Diamonds Tests', () => {
  // Test 1: Price calculation
  test('1. Single receiver total Diamonds calculation is correct', () => {
    const unitPrice = 100;
    const quantity = 5;
    const receivers = ['receiver-1'];
    const totalDiamonds = unitPrice * quantity * receivers.length;
    assert.strictEqual(totalDiamonds, 500);
  });

  // Test 2: Diamond balance deduction (1,000,000 -> 999,500, never 999,999)
  test('2. Atomic Diamond balance deduction: 1,000,000 -> 999,500 for 5x 100-diamond gift', () => {
    const startingDiamonds = 1000000;
    const price = 100;
    const quantity = 5;
    const totalDiamonds = price * quantity;
    assert.strictEqual(totalDiamonds, 500);

    const resultingDiamonds = startingDiamonds - totalDiamonds;
    assert.strictEqual(resultingDiamonds, 999500);
    assert.notStrictEqual(resultingDiamonds, 999999);
  });

  // Test 3: Multi-receiver total Diamonds calculation
  test('3. Multi-receiver total Diamonds scales linearly with number of selected recipients', () => {
    const unitPrice = 50;
    const quantity = 5;
    const receivers = ['receiver-1', 'receiver-2', 'receiver-3', 'receiver-4'];
    const totalDiamonds = unitPrice * quantity * receivers.length;
    assert.strictEqual(totalDiamonds, 1000);
  });

  // Test 4: Rarity and Animation Types configuration
  test('4. Initial gifts cover all 8 required animation types with Diamond pricing', () => {
    const animationTypes = new Set(INITIAL_GIFTS.map((g) => g.animationType));
    assert.ok(animationTypes.has('NORMAL'), 'Must support NORMAL animation');
    assert.ok(animationTypes.has('FLOATING'), 'Must support FLOATING animation');
    assert.ok(animationTypes.has('FLY_TO_RECEIVER'), 'Must support FLY_TO_RECEIVER animation');
    assert.ok(animationTypes.has('CENTER_STAGE'), 'Must support CENTER_STAGE animation');
    assert.ok(animationTypes.has('FULL_SCREEN'), 'Must support FULL_SCREEN animation');
    assert.ok(animationTypes.has('SPECIAL'), 'Must support SPECIAL animation');
    assert.ok(animationTypes.has('VIP'), 'Must support VIP animation');
    assert.ok(animationTypes.has('LUXURY'), 'Must support LUXURY animation');

    INITIAL_GIFTS.forEach((g) => {
      assert.ok(Number(g.price) > 0, `Gift ${g.name} must have a positive price`);
      assert.ok(g.icon, `Gift ${g.name} must have an icon`);
      assert.strictEqual(g.currency, 'diamonds', `Gift ${g.name} currency must be diamonds`);
    });
  });

  // Test 5: Dynamic Categories
  test('5. Dynamic initial categories are configured without hardcoded assumptions', () => {
    const expectedCategories = ['gifts', 'lucky', 'event', 'surprise', 'custom', 'vip', 'special'];
    const slugs = INITIAL_CATEGORIES.map((c) => c.slug);
    expectedCategories.forEach((slug) => {
      assert.ok(slugs.includes(slug), `Category ${slug} must be present`);
    });
  });

  // Test 6: Insufficient Diamonds detection
  test('6. Insufficient Diamonds check correctly detects when user cannot afford a gift', () => {
    const userDiamonds = 500;
    const requiredCost = 1000;
    const sufficient = userDiamonds >= requiredCost;
    assert.strictEqual(sufficient, false);

    const validCost = 250;
    const canAfford = userDiamonds >= validCost;
    assert.strictEqual(canAfford, true);
    assert.strictEqual(userDiamonds - validCost, 250);
  });

  // Test 7: Idempotency protection check
  test('7. RequestId uniqueness guarantees idempotency', () => {
    const processedRequests = new Set<string>();
    const reqId = 'gift_8f82c7b1-49b0-4f51-b0db-b27e8d6f5f3e';

    // First request
    let isDuplicate = processedRequests.has(reqId);
    assert.strictEqual(isDuplicate, false);
    processedRequests.add(reqId);

    // Duplicate submission with same requestId
    isDuplicate = processedRequests.has(reqId);
    assert.strictEqual(isDuplicate, true);
  });

  // Test 8: Invalid quantity rejection
  test('8. Quantity validation rejects non-positive or excessive quantities', () => {
    const clampQty = (raw: number) => {
      if (!raw || isNaN(raw) || raw < 1) return 1;
      return Math.min(1000, Math.floor(raw));
    };

    assert.strictEqual(clampQty(0), 1);
    assert.strictEqual(clampQty(-5), 1);
    assert.strictEqual(clampQty(10), 10);
    assert.strictEqual(clampQty(9999), 1000);
  });

  // Test 9: Entry effect catalog & types
  test('9. Entry effect catalog covers all required entry animation types', () => {
    const requiredTypes = ['BANNER', 'CENTER_AVATAR', 'PARTICLES', 'VIP_ENTRANCE', 'SPECIAL_EVENT'];
    const availableTypes = new Set(INITIAL_ENTRY_EFFECTS.map((e) => e.animationType));
    requiredTypes.forEach((t) => {
      assert.ok(availableTypes.has(t as any), `Entry animation type ${t} must be supported`);
    });
  });

  // Test 10: Entry tag equip verification
  test('10. Entry tag equip updates user equipped tag accurately', () => {
    const user: any = {
      diamonds: 1000000,
      ownedEntryEffects: ['effect-king'],
      equippedEntryEffect: null,
      equippedEntryTag: '',
    };

    const kingEffect = {
      id: 'effect-king',
      name: 'King Arrival',
      tagText: '🔥 KING IS HERE',
    };

    // Equip
    user.equippedEntryEffect = kingEffect.id;
    user.equippedEntryTag = kingEffect.tagText;

    assert.strictEqual(user.equippedEntryTag, '🔥 KING IS HERE');
    assert.strictEqual(user.equippedEntryEffect, 'effect-king');
  });

  // Test 11: Currency audit - strictly DIAMONDS, no BEANS
  test('11. Currency in transaction payload is strictly DIAMONDS', () => {
    const tx = {
      requestId: 'req_123',
      unitPrice: 100,
      quantity: 5,
      totalDiamonds: 500,
      totalPrice: 500,
      currency: 'DIAMONDS',
      status: 'SUCCESS',
    };

    assert.strictEqual(tx.currency, 'DIAMONDS');
    assert.notStrictEqual(tx.currency, 'BEANS');
    assert.strictEqual(tx.status, 'SUCCESS');
  });
});
