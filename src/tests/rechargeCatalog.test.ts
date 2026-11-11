import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE_PLAY_PRODUCT_IDS, getProductConfig, GOOGLE_PLAY_PRODUCTS } from '../constants/googlePlayProducts';

test('public catalog offers exactly ten approved packages', () => {
  assert.deepEqual(
    GOOGLE_PLAY_PRODUCT_IDS.map(id => {
      const p = getProductConfig(id)!;
      return [p.priceInr, p.diamonds];
    }),
    [
      [10, 720],
      [50, 3600],
      [100, 7200],
      [200, 14400],
      [500, 36000],
      [1000, 72000],
      [2000, 144000],
      [5000, 360000],
      [10000, 720000],
      [20000, 1440000],
    ]
  );
  assert.equal(GOOGLE_PLAY_PRODUCT_IDS.length, 10);
});

test('720,000 Coins pack is strictly coins_720000 and never coins_720', () => {
  const p720 = getProductConfig('coins_720')!;
  const p720k = getProductConfig('coins_720000')!;

  assert.equal(p720.coins, 720);
  assert.equal(p720.priceInr, 10);
  assert.equal(p720k.coins, 720000);
  assert.equal(p720k.priceInr, 10000);
  assert.notEqual(p720.productId, p720k.productId);
  assert.notEqual(p720.coins, p720k.coins);
});

test('all ten official packs maintain exact coin entitlement and price integrity', () => {
  const expectedPacks: Record<string, [number, number]> = {
    coins_720: [720, 10],
    coins_3600: [3600, 50],
    coins_7200: [7200, 100],
    coins_14400: [14400, 200],
    coins_36000: [36000, 500],
    coins_72000: [72000, 1000],
    coins_144000: [144000, 2000],
    coins_360000: [360000, 5000],
    coins_720000: [720000, 10000],
    coins_1440000: [1440000, 20000],
  };

  for (const [id, [coins, price]] of Object.entries(expectedPacks)) {
    const config = getProductConfig(id);
    assert.ok(config, `Missing config for ${id}`);
    assert.equal(config.coins, coins, `Coins mismatch for ${id}`);
    assert.equal(config.diamonds, coins, `Diamonds mismatch for ${id}`);
    assert.equal(config.priceInr, price, `Price mismatch for ${id}`);
  }
});

test('historical entitlements remain unchanged and are not advertised', () => {
  assert.equal(getProductConfig('diamonds_71')?.diamonds, 7200);
  assert.equal(getProductConfig('diamonds_800')?.diamonds, 800);
  assert.equal(GOOGLE_PLAY_PRODUCT_IDS.includes('diamonds_800'), false);
});

test('prototype names cannot resolve as purchase products', () => {
  for (const id of ['toString', 'constructor', '__proto__', 'unknown', '']) {
    assert.equal(getProductConfig(id), null);
  }
});
