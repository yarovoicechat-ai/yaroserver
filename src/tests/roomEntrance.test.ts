import { IdentityResolverService } from '../services/identityResolver.service';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { User } from '../models/user.model';
import { StoreItem } from '../models/storeItem.model';
// Isolate the broadcaster from live socket/Redis infrastructure.
const socketPath = require.resolve('../sockets');
require.cache[socketPath] = { id: socketPath, filename: socketPath, loaded: true,
  exports: { getIOOptional: () => null, getIO: () => null } } as any;
const { EntryEffectService } = require('../services/entryEffect.service');
import { VipService } from '../services/vip.service';
import { entryIsActive, roomEntryAsset } from '../utils/roomEntryRules';

test('Entrance is a supported catalog category', () => {
  const item = new StoreItem({ name: 'Bike', category: 'Entrance', price: 1 });
  assert.equal(item.validateSync(), undefined);
});

test('room assets exclude store covers, expired items and unconfigured avatars', () => {
  assert.equal(entryIsActive({ imageUrl: 'cover.png' }), false);
  assert.equal(roomEntryAsset({ animationUrl: 'ride.svga', expiresAt: '2000-01-01' }), null);
  assert.equal(roomEntryAsset({ animationUrl: 'ride.svga', isActive: false }), null);
  const asset = roomEntryAsset({ animationUrl: 'ride.svga', imageUrl: 'cover.png' });
  assert.equal(asset.imageUrl, undefined);
  assert.equal(asset.metadata.showAvatar, false);
  assert.equal(asset.metadata.comingText, 'is coming');
});

test('VIP without entry gets plain arrival; entrance-only and current panel settings work', async () => {
  const originalFind = User.findById;
  const originalCatalog = StoreItem.findOne;
  const originalVip = VipService.resolveVipExperience;
  const originalIdentity = IdentityResolverService.resolveEffectiveIdentity;
  const id = '507f1f77bcf86cd799439011';
  let account: any = { _id: id, userId: 12, name: '\u09ac\u09be\u0982\u09b2\u09be \u0939\u093f\u0902\u0926\u0940 Name', equippedVipId: 'vip' };
  try {
    (IdentityResolverService as any).resolveEffectiveIdentity = async () => null;
    (User as any).findById = () => ({ populate: () => ({ lean: async () => account }) });
    (VipService as any).resolveVipExperience = async () => ({ isVip: true, entryFrame: 'fake-vip.png' });
    (StoreItem as any).findOne = () => ({ lean: async () => null });
    const plain = await EntryEffectService.broadcastEntry('room-a', { id, equippedEntryAsset: { animationUrl: 'stale.svga' } });
    assert.ok(plain);
    assert.equal(plain.hasEntry, false, 'DB unequip must override stale socket cosmetics');
    assert.equal(plain.entry, null);
    assert.equal(plain.entrance?.isDefault, true);
    assert.equal(plain.tagText, 'entered the room');

    account = { ...account, equippedEntranceAsset: { name: 'Bike', animationUrl: 'bike.svga' } };
    (StoreItem as any).findOne = () => ({ lean: async () => ({
      animationUrl: 'new-bike.svga', isActive: true,
      metadata: { showAvatar: true, comingText: 'is coming', duration: 6000 },
    }) });
    const arrival = await EntryEffectService.broadcastEntry('room-a', { id });
    assert.ok(arrival);
    assert.equal(arrival.hasEntry, true);
    assert.equal(arrival.entry, null, 'Entrance does not leak into Entry slot');
    assert.equal(arrival.entrance.animationUrl, 'new-bike.svga');
    assert.equal(arrival.entrance.metadata.showAvatar, true);
    assert.equal(arrival.tagText, 'is coming');
    assert.equal(arrival.user.name, account.name);

    account.equippedEntranceAsset.expiresAt = '2000-01-01';
    const expired = await EntryEffectService.broadcastEntry('room-a', { id });
    assert.equal(expired?.hasEntry, false);
  } finally {
    User.findById = originalFind;
    StoreItem.findOne = originalCatalog;
    VipService.resolveVipExperience = originalVip;
    IdentityResolverService.resolveEffectiveIdentity = originalIdentity;
  }
});

