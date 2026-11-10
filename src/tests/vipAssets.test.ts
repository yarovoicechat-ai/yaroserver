import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getVipAssets } from '../utils/vipAssets';
import { VipService } from '../services/vip.service';
import { updateVipAssets } from '../controllers/vipAssets.controller';
import { VipAssets } from '../models/vipAssets.model';

test('all five VIP levels have backend PNG covers and playable SVGA files', () => {
  for (let level = 1; level <= 5; level++) {
    const assets = getVipAssets(level)!;
    for (const asset of [assets.entry, assets.frame]) {
      for (const url of [asset.imageUrl, asset.animationUrl]) {
        const file = path.resolve(__dirname, '../../assets/vip', url.replace('/api/vip-assets/', ''));
        const bytes = fs.readFileSync(file);
        if (url.endsWith('.png')) assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
        else assert.ok(zlib.inflateSync(bytes).length > 0);
      }
    }
  }
  for (const level of [0, 6, 10, NaN, 1.5]) assert.equal(getVipAssets(level), null);
});

test('VIP assets follow active membership and disappear after expiry', async () => {
  const active = await VipService.resolveVipExperience({ equippedVipId: 'vip-bronze' });
  assert.equal(active.avatarFrame, getVipAssets(1)!.frame.animationUrl);
  assert.equal(active.entryAsset?.animationUrl, getVipAssets(1)!.entry.animationUrl);
  const expired = await VipService.resolveVipExperience({
    equippedVipId: 'vip-bronze', equippedVipExpiresAt: new Date(0),
  });
  assert.equal(expired.entryAsset, undefined);
  assert.equal(expired.avatarFrame, '');
});

test('management validates media and persists only editable asset fields', async () => {
  const original = VipAssets.findOneAndUpdate;
  let persisted: any;
  let status = 0;
  const res: any = { status(code: number) { status = code; return this; }, json(body: any) { return body; } };
  VipAssets.findOneAndUpdate = ((filter: any, update: any) => {
    persisted = { filter, update };
    return { lean: async () => update.$set };
  }) as any;
  try {
    const defaults = getVipAssets(2)!;
    await updateVipAssets({ params: { level: '2' }, body: defaults } as any, res);
    assert.equal(status, 200);
    assert.equal(persisted.filter.level, 2);
    assert.equal(persisted.update.$set.frame.animationUrl, defaults.frame.animationUrl);
    assert.equal(persisted.update.$set.entry.duration, undefined);
    persisted = undefined;
    await updateVipAssets({ params: { level: '2' }, body: {
      ...defaults, frame: { ...defaults.frame, animationUrl: 'javascript:alert(1)' },
    } } as any, res);
    assert.equal(status, 400);
    assert.equal(persisted, undefined);
    await updateVipAssets({ params: { level: '6' }, body: defaults } as any, res);
    assert.equal(status, 400);
  } finally { VipAssets.findOneAndUpdate = original; }
});
