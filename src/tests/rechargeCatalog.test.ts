import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE_PLAY_PRODUCT_IDS, getProductConfig } from '../constants/googlePlayProducts';
test('public catalog offers exactly nine approved packages', () => {
 assert.deepEqual(GOOGLE_PLAY_PRODUCT_IDS.map(id => { const p=getProductConfig(id)!;return [p.priceInr,p.diamonds]; }), [[10,7],[50,36],[100,72],[200,144],[500,360],[1000,720],[2000,1440],[5000,3600],[10000,7200]]);
});
test('historical entitlements remain unchanged and are not advertised', () => {
 assert.equal(getProductConfig('diamonds_71')?.diamonds,71);
 assert.equal(getProductConfig('diamonds_800')?.diamonds,800);
 assert.equal(GOOGLE_PLAY_PRODUCT_IDS.includes('diamonds_800'),false);
});
test('prototype names cannot resolve as purchase products', () => {
 for(const id of ['toString','constructor','__proto__','unknown','']) assert.equal(getProductConfig(id),null);
});
