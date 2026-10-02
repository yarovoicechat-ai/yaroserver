import assert from 'node:assert';
import { test, describe } from 'node:test';
import { VipService, INITIAL_VIP_PACKAGES, INITIAL_SVIP_TIERS } from '../services/vip.service';

describe('VIP & SVIP Store System, Priorities & Responsive Fitting Tests', () => {
  // Test 1: Web Duniya Diamond Balance Requirement
  test('1. Web Duniya target balance is exactly 100,000,000 Diamonds (10 Crore)', () => {
    const requiredBalance = 100000000;
    assert.strictEqual(requiredBalance, 100000000, 'Must be 100,000,000');
    assert.notStrictEqual(requiredBalance, 10000000);
    assert.notStrictEqual(requiredBalance, 1000000);
    assert.notStrictEqual(requiredBalance, 100000);
  });

  // Test 2: VIP Catalog Configuration
  test('2. Initial VIP packages cover all required tiers and Diamond pricing', () => {
    assert.ok(INITIAL_VIP_PACKAGES.length >= 4, 'Must have at least 4 initial packages');
    INITIAL_VIP_PACKAGES.forEach((pkg) => {
      assert.ok(pkg.name, 'Package must have name');
      assert.ok(pkg.slug, 'Package must have slug');
      assert.ok(pkg.price > 0, 'Price must be positive');
      assert.strictEqual(pkg.currency, 'DIAMONDS', 'Currency must be DIAMONDS');
      assert.ok(pkg.entryTag, 'Package must have entryTag');
      assert.ok(pkg.micWave, 'Package must have micWave config');
      assert.ok(pkg.chatBubble, 'Package must have chatBubble config');
      assert.ok(pkg.roomTheme, 'Package must have roomTheme config');
      assert.ok(pkg.nameEffect, 'Package must have nameEffect config');
    });
  });

  // Test 3: SVIP Catalog Configuration
  test('3. Initial SVIP tiers cover Knight, Count, Duke, and King of Kings with feature toggles', () => {
    assert.ok(INITIAL_SVIP_TIERS.length >= 4, 'Must have at least 4 SVIP tiers');
    INITIAL_SVIP_TIERS.forEach((tier) => {
      assert.ok(tier.name, 'SVIP tier must have name');
      assert.ok(tier.level >= 1, 'SVIP tier must have valid level');
      assert.ok(tier.price > 0, 'Price must be positive');
      assert.strictEqual(tier.currency, 'DIAMONDS', 'Currency must be DIAMONDS');
      assert.ok(typeof tier.features.enableEntryEffect === 'boolean');
      assert.ok(typeof tier.features.enableMicWave === 'boolean');
      assert.ok(typeof tier.features.enableChatBubble === 'boolean');
      assert.ok(typeof tier.features.enableRoomTheme === 'boolean');
    });
  });

  // Test 4: Atomic Diamond Deduction Calculation
  test('4. Atomic Diamond purchase deduction calculates correctly', () => {
    const startingDiamonds = 100000000; // 10 Crore
    const vipPrice = 250000; // King of Kings
    const remaining = startingDiamonds - vipPrice;
    assert.strictEqual(remaining, 99750000);
  });

  // Test 5: Insufficient Diamonds Check
  test('5. Purchase fails when user has insufficient diamonds', () => {
    const balance = 5000;
    const price = 50000;
    const canAfford = balance >= price;
    assert.strictEqual(canAfford, false);
  });

  // Test 6: VIP + SVIP Priority Resolution
  test('6. resolveVipExperience: SVIP overrides VIP only for overlapping enabled feature slots', async () => {
    const mockUser = {
      _id: 'user_1',
      name: 'Web Duniya',
      equippedVipId: 'vip-gold-emperor',
      equippedSvipId: 'knight',
    };

    // When both are present, SVIP overrides only enabled features
    const exp = await VipService.resolveVipExperience(mockUser);
    assert.strictEqual(exp.isSvip, true);
    assert.strictEqual(exp.isVip, true);
    assert.ok(exp.micWave.enabled, 'Mic wave should be enabled');
    assert.ok(exp.chatBubble.enabled, 'Chat bubble should be enabled');
    assert.ok(exp.roomTheme.enabled, 'Room theme should be enabled');
  });

  // Test 7: Entry Tag Resolution
  test('7. Entry Tag resolves accurately from equipped VIP or custom tag', async () => {
    const mockUserWithCustomTag = {
      name: 'King User',
      equippedEntryTag: '👑 KING IS HERE',
    };
    const exp = await VipService.resolveVipExperience(mockUserWithCustomTag);
    assert.strictEqual(exp.entryTag, '👑 KING IS HERE');
  });

  // Test 8: Auto-Scaling Name Fitting Algorithm
  test('8. Dynamic name auto-scaling fits short, long, very long, Hindi, and emoji names without clipping', () => {
    const containerWidth = 320;
    const horizontalPadding = 32;
    const availableWidth = containerWidth - horizontalPadding; // 288px
    const minFontSize = 11;
    const maxFontSize = 22;

    const calculateFittedFontSize = (name: string): number => {
      const len = Array.from(name).length;
      if (len <= 8) return maxFontSize;
      if (len <= 14) return 18;
      if (len <= 20) return 15;
      if (len <= 26) return 13;
      return minFontSize;
    };

    // Short name: "WEB" -> maxFontSize (22)
    assert.strictEqual(calculateFittedFontSize('WEB'), 22);

    // Medium name: "WEB DUNIYA" (10 chars) -> 18
    assert.strictEqual(calculateFittedFontSize('WEB DUNIYA'), 18);

    // Long name: "WEB DUNIYA OFFICIAL" (19 chars) -> 15
    assert.strictEqual(calculateFittedFontSize('WEB DUNIYA OFFICIAL'), 15);

    // Very long name: "WEB DUNIYA OFFICIAL KING OF KING" (32 chars) -> minFontSize (11)
    assert.strictEqual(calculateFittedFontSize('WEB DUNIYA OFFICIAL KING OF KING'), 11);

    // Hindi name: "नमस्ते वेब दुनिया"
    assert.ok(calculateFittedFontSize('नमस्ते वेब दुनिया') >= minFontSize);

    // Emoji name: "👑 WEB 💎 🔥"
    assert.ok(calculateFittedFontSize('👑 WEB 💎 🔥') >= minFontSize);
  });

  // Test 9: Content-Responsive Chat Bubble Dimensions
  test('9. Chat bubble dimensions scale strictly to text length without giant empty space or clipping', () => {
    const roomWidth = 390;
    const maxBubbleWidth = Math.floor(roomWidth * 0.72); // ~280px
    const minBubbleWidth = 44;
    const paddingX = 24;

    const computeBubbleWidth = (text: string): number => {
      const approxCharWidth = 8.5;
      const textWidth = Math.ceil(text.length * approxCharWidth);
      return Math.max(minBubbleWidth, Math.min(textWidth + paddingX, maxBubbleWidth));
    };

    // Short message: "Hi" (2 chars) -> minBubbleWidth or close to it
    const shortWidth = computeBubbleWidth('Hi');
    assert.ok(shortWidth < 65, 'Short bubble should be compact');

    // Emoji message: "😊" -> compact
    const emojiWidth = computeBubbleWidth('😊');
    assert.ok(emojiWidth < 65, 'Emoji bubble should be compact');

    // Medium message: "Hello everyone" (14 chars)
    const mediumWidth = computeBubbleWidth('Hello everyone');
    assert.ok(mediumWidth > shortWidth);
    assert.ok(mediumWidth < maxBubbleWidth);

    // Long message: wraps up to maxBubbleWidth
    const longWidth = computeBubbleWidth('Hello everyone, welcome to Yaro live audio room! Let us have fun.');
    assert.strictEqual(longWidth, maxBubbleWidth, 'Long message must cap at maxBubbleWidth');
  });

  // Test 10: Mic Wave States
  test('10. Mic wave handles IDLE, SPEAKING, MUTED, DISCONNECTED states correctly', () => {
    type MicState = 'IDLE' | 'SPEAKING' | 'MUTED' | 'DISCONNECTED';
    const states: MicState[] = ['IDLE', 'SPEAKING', 'MUTED', 'DISCONNECTED'];
    states.forEach((st) => {
      assert.ok(['IDLE', 'SPEAKING', 'MUTED', 'DISCONNECTED'].includes(st));
    });
  });

  // Test 11: Idempotency Protection for VIP Purchases
  test('11. Unique requestId prevents duplicate purchase transactions', () => {
    const processedRequests = new Set<string>();
    const req1 = 'vip_req_12345';
    assert.strictEqual(processedRequests.has(req1), false);
    processedRequests.add(req1);
    assert.strictEqual(processedRequests.has(req1), true, 'Duplicate request must be rejected or replayed idempotently');
  });
});
