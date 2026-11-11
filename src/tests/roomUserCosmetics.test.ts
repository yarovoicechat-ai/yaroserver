import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roomUserCosmetics } from '../utils/roomUserCosmetics';

test('other room members receive resolved VIP frame and entry, not just the owners profile', () => {
  const entry = { animationUrl: '/api/vip-assets/entry/vip_entry_2.svga' };
  const result = roomUserCosmetics({}, { avatarFrame: '/api/vip-assets/frame/vip_frame_2.svga' }, { entryAsset: entry });
  assert.equal(result.equippedFrameAsset, '/api/vip-assets/frame/vip_frame_2.svga');
  assert.equal(result.equippedEntryAsset, entry);
});

test('explicit equipped assets retain priority and empty memberships do not create assets', () => {
  const frame = { animationUrl: '/uploads/custom.svga' };
  assert.equal(roomUserCosmetics({ equippedFrameAsset: frame }, { avatarFrame: '/default.svga' }).equippedFrameAsset, frame);
  assert.equal(roomUserCosmetics({}, {}).equippedFrameAsset, null);
  assert.equal(roomUserCosmetics({}, {}).equippedEntryAsset, null);
});
