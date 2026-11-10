import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE_PLAY_PRODUCT_IDS, getProductConfig } from '../constants/googlePlayProducts';
test('public catalog offers exactly ten approved packages', () => {
 assert.deepEqual(GOOGLE_PLAY_PRODUCT_IDS.map(id => { const p=getProductConfig(id)!;return [p.priceInr,p.diamonds]; }), [[10,720],[50,3600],[100,7200],[200,14400],[500,36000],[1000,72000],[2000,144000],[5000,360000],[10000,720000],[20000,1440000]]);
});
test('historical entitlements remain unchanged and are not advertised', () => {
 assert.equal(getProductConfig('diamonds_71')?.diamonds,7200);
 assert.equal(getProductConfig('diamonds_800')?.diamonds,800);
 assert.equal(GOOGLE_PLAY_PRODUCT_IDS.includes('diamonds_800'),false);
});
test('prototype names cannot resolve as purchase products', () => {
 for(const id of ['toString','constructor','__proto__','unknown','']) assert.equal(getProductConfig(id),null);
});
