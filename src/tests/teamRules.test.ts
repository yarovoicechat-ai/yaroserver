import { test } from 'node:test';
import assert from 'node:assert/strict';
import { belongsTo, canInviteRole, csvCell, effectiveTeamRole, hostChannels, progress, reportMonth, teamScope } from '../team/rules';
import { callReferenceAmounts } from '../economy/reporting';
import { NEW_ECONOMY } from '../economy/rules';

test('hierarchy invitations allow lower roles and deny same/higher roles', () => {
  assert.equal(canInviteRole('operator', 'superAdmin'), true);
  assert.equal(canInviteRole('bd', 'agency'), true);
  assert.equal(canInviteRole('agency', 'host'), true);
  for (const [a, b] of [['agency', 'bd'], ['bd', 'bd'], ['host', 'agency'], ['user', 'host'], ['admin', 'owner']]) assert.equal(canInviteRole(a, b), false);
});
test('app-only BD/Agency flags require a trusted approved option', () => {
  assert.equal(effectiveTeamRole({ role: 'user', appRole: 'bd', hasAppOption: true, isBD: true }), 'bd');
  assert.equal(effectiveTeamRole({ role: 'user', appRole: 'agency', hasAppOption: true, isAgency: true }), 'agency');
  assert.equal(effectiveTeamRole({ role: 'user', appRole: 'bd', hasAppOption: false, isBD: true }), 'user');
  assert.equal(effectiveTeamRole({ role: 'user', appRole: 'owner', hasAppOption: true }), 'user');
  assert.throws(() => teamScope('abc', 'user'));
});
test('voice-only and two-hosting configurations keep independent targets', () => {
  assert.deepEqual(hostChannels({ hostTypes: ['voice'] }), ['voice']);
  assert.deepEqual(hostChannels({ hostTypes: ['video', 'room'] }), ['video', 'room']);
  const voice = progress(500, 1000), room = progress(10000, 5000);
  assert.equal(voice.pending, 500); assert.equal(room.pending, 0);
  assert.equal(progress(0).pending, null);
});
test('hierarchy path matching cannot select a partial ID in another branch', () => {
  assert.equal(belongsTo({ _id: 'host', hierarchyPath: '/abc1234/' }, 'abc123'), false);
  assert.equal(belongsTo({ _id: 'host', hierarchyPath: '/abc123/' }, 'abc123'), true);
});
test('monthly boundaries use Asia/Calcutta and CSV neutralizes formulas', () => {
  const period = reportMonth('2026-10');
  assert.equal(period.from.toISOString(), '2026-09-30T18:30:00.000Z');
  assert.equal(period.to.toISOString(), '2026-10-31T18:30:00.000Z');
  assert.throws(() => reportMonth('2026-99'));
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell(-205), '"-205"');
});
test('versioned dashboard references use pinned Beans conversion instead of legacy 0.10', () => {
  const voice = callReferenceAmounts({ totalCoins: 4.92, totalHostEarnings: 205, fundedMinutes: 1, video: false }, NEW_ECONOMY);
  assert.equal(voice.revenueInr, 6); assert.equal(voice.hostEarningsInr, 2.5);
  const video = callReferenceAmounts({ totalCoins: 9.84, totalHostEarnings: 410, fundedMinutes: 1, video: true }, NEW_ECONOMY);
  assert.equal(video.revenueInr, 12); assert.equal(video.hostEarningsInr, 5);
  assert.equal(callReferenceAmounts({ totalCoins: 100, totalHostEarnings: 25, fundedMinutes: 1, video: false }, null).hostEarningsInr, 2.5);
});
