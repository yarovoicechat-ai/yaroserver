import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NAME_EFFECT_PRESETS, nameEffectExpiry } from '../utils/nameEffectPresets';
import { User } from '../models/user.model';
import { IdentityEffect } from '../models/identityEffect.model';
import { IdentityEntitlement } from '../models/identityEntitlement.model';
import { IdentityAuditLog } from '../models/identityAuditLog.model';

const updatePath = require.resolve('../services/nameEffectUpdate.service');
const published: any[] = [];
require.cache[updatePath] = { id: updatePath, filename: updatePath, loaded: true,
  exports: { publishNameEffectUpdate: async (user: any) => { published.push(user); } } } as any;
const { grantNameEffectToUser, revokeEntitlement } = require('../controllers/identityStudio.controller');
const response = () => ({ code: 0, body: null as any,
  status(code: number) { this.code = code; return this; },
  json(body: any) { this.body = body; return this; },
});

test('60 distinct presets are panel-only and eligible for every account', () => {
  assert.equal(NAME_EFFECT_PRESETS.length, 60);
  assert.equal(new Set(NAME_EFFECT_PRESETS.map(effect => effect.slug)).size, 60);
  assert.equal(new Set(NAME_EFFECT_PRESETS.map(effect => effect.config.colors.join(','))).size, 60);
  NAME_EFFECT_PRESETS.forEach(effect => {
    assert.equal(effect.isPurchasable, false);
    assert.equal(effect.metadata.panelOnly, true);
    assert.deepEqual(effect.eligibleTiers, ['all']);
    assert.equal(new IdentityEffect(effect).validateSync(), undefined);
  });
});

test('validity supports permanent and rejects negative or invalid durations', () => {
  const now = new Date('2026-10-25T00:00:00Z');
  assert.equal(nameEffectExpiry(7, now).toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(nameEffectExpiry(0, now).getUTCFullYear(), 9999);
  for (const value of [-1, 0.5, 'invalid', 3651]) assert.throws(() => nameEffectExpiry(value, now));
});

test('panel grant works for a non-VIP ID, replaces its prior effect and supports remove', async () => {
  const originals = [User.findOne, IdentityEffect.findOne, IdentityEntitlement.updateMany,
    IdentityEntitlement.create, IdentityAuditLog.create, IdentityEntitlement.findById];
  let saved: any;
  let replaced: any;
  const user = { _id: '507f1f77bcf86cd799439011', userId: 12345, name: 'Regular Account' };
  try {
    (User as any).findOne = async () => user;
    (IdentityEffect as any).findOne = async () => NAME_EFFECT_PRESETS[0];
    (IdentityEntitlement as any).updateMany = async (filter: any) => { replaced = filter; };
    (IdentityEntitlement as any).create = async (value: any) => { saved = { ...value, _id: 'grant-id' }; return saved; };
    (IdentityAuditLog as any).create = async () => ({});
    const res = response();
    await grantNameEffectToUser({ body: { userIdentifier: '12345', effectSlug: NAME_EFFECT_PRESETS[0].slug, durationDays: 0 }, user: { id: user._id, role: 'admin' } }, res);
    assert.equal(res.code, 201);
    assert.equal(saved.userId, 12345);
    assert.equal(saved.config.styleId, NAME_EFFECT_PRESETS[0].slug);
    assert.equal(saved.expiresAt.getUTCFullYear(), 9999);
    assert.deepEqual(replaced.type.$in, ['animated_name', 'name_color']);
    assert.equal(published.length, 1);
    const invalid = response();
    await grantNameEffectToUser({ body: { userIdentifier: '12345', durationDays: -1 } }, invalid);
    assert.equal(invalid.code, 400);
    (IdentityEntitlement as any).findById = async () => ({ ...saved, save: async function () { saved.status = this.status; } });
    const removed = response();
    await revokeEntitlement({ params: { id: 'grant-id' }, body: {}, user: { id: user._id } }, removed);
    assert.equal(removed.code, 200);
    assert.equal(saved.status, 'revoked');
    assert.equal(published.length, 2);
  } finally {
    [User.findOne, IdentityEffect.findOne, IdentityEntitlement.updateMany,
      IdentityEntitlement.create, IdentityAuditLog.create, IdentityEntitlement.findById] = originals as any;
  }
});
