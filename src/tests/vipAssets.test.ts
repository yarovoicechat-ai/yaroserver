import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { getVipAssets } from '../utils/vipAssets';
import { VipService } from '../services/vip.service';
import { membershipAssets, presentVipPlan } from '../utils/vipMembership';
import { adminUpdateSvipPlan, getPublishedSvipPlans } from '../controllers/svipPlan.controller';
import { SvipTier } from '../models/svipTier.model';
import { IdentityAuditLog } from '../models/identityAuditLog.model';

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
  const active = await VipService.resolveVipExperience({ equippedSvipId: 'svip-1' });
  assert.equal(active.avatarFrame, getVipAssets(1)!.frame.animationUrl);
  assert.equal(active.entryAsset?.animationUrl, getVipAssets(1)!.entry.animationUrl);
  const expired = await VipService.resolveVipExperience({
    equippedSvipId: 'svip-1', equippedSvipExpiresAt: new Date(0),
  });
  assert.equal(expired.entryAsset, undefined);
  assert.equal(expired.avatarFrame, '');
});

test('existing SVIP tiers expose VIP assets and preserve existing purchase identifiers', () => {
  const plan = presentVipPlan({ level: 3, name: 'SVIP 3 Duke', slug: 'svip-3', planCode: 'SVIP_3' });
  assert.equal(plan.name, 'VIP 3 Duke');
  assert.equal(plan.slug, 'svip-3');
  assert.equal(plan.planCode, 'SVIP_3');
  assert.equal(plan.entryAnimationUrl, getVipAssets(3)!.entry.animationUrl);
  const edited = { ...plan, entryAnimationUrl: 'https://example.com/new.svga', avatarFrameUrl: 'https://example.com/frame.svga', entryPreviewUrl: 'https://example.com/new.png' };
  assert.equal(membershipAssets(edited).entry?.animationUrl, edited.entryAnimationUrl);
  assert.equal(membershipAssets(edited).frame?.animationUrl, edited.avatarFrameUrl);
  assert.equal(membershipAssets({ ...edited, features: { enableEntryEffect: false, enableAvatarFrame: false } }).entry, null);
  assert.equal(membershipAssets({ ...edited, features: { enableEntryEffect: false, enableAvatarFrame: false } }).frame, null);
});

test('management edits reach the existing mobile catalog without another asset catalog', async () => {
  const originalUpdate = SvipTier.findByIdAndUpdate;
  const originalFind = SvipTier.find;
  const originalAudit = IdentityAuditLog.create;
  let stored: any = { _id: 'existing-plan', slug: 'svip-2', name: 'SVIP 2 Count', level: 2, price: 123 };
  let result: any;
  let status = 0;
  const res: any = {
    status(code: number) { status = code; return this; },
    json(body: any) { result = body; },
    setHeader() {},
  };
  SvipTier.findByIdAndUpdate = (async (_id: any, data: any) => { stored = { ...stored, ...data }; return stored; }) as any;
  SvipTier.find = (() => ({ sort: () => ({ lean: async () => [stored] }) })) as any;
  IdentityAuditLog.create = (async () => ({})) as any;
  try {
    await adminUpdateSvipPlan({ params: { id: 'existing-plan' }, body: {
      price: 456, entryAnimationUrl: 'https://example.com/replaced.svga',
      entryPreviewUrl: 'https://example.com/replaced.png',
      avatarFrameUrl: 'https://example.com/frame.svga',
      avatarFramePreviewUrl: 'https://example.com/frame.png',
    } } as any, res);
    assert.equal(status, 200);
    await getPublishedSvipPlans({} as any, res);
    const plan = result.data.plans[0];
    assert.equal(plan.name, 'VIP 2 Count');
    assert.equal(plan.slug, 'svip-2');
    assert.equal(plan.price, 456);
    assert.equal(plan.entryAnimationUrl, 'https://example.com/replaced.svga');
    assert.equal(plan.avatarFramePreviewUrl, 'https://example.com/frame.png');
    await adminUpdateSvipPlan({ params: { id: 'existing-plan' }, body: { entryAnimationUrl: 'javascript:alert(1)' } } as any, res);
    assert.equal(status, 400);
  } finally {
    SvipTier.findByIdAndUpdate = originalUpdate;
    SvipTier.find = originalFind;
    IdentityAuditLog.create = originalAudit;
  }
});
