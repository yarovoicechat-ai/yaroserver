import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveHiringScope, validateManagerDocuments } from '../utils/hiringScope';
import { canActOnRequest, normalizeRoleKey } from '../utils/emsApprovalRules';
import { ROLE_HIERARCHY, UserRole } from '../constants/user';

const roles = ['superAdmin', 'admin', 'bdLeader', 'bd', 'agency', 'host', 'customerSupport'];
test('managers rank below Operator and above Super Admin', () => {
  assert.ok(ROLE_HIERARCHY[UserRole.OPERATOR] < ROLE_HIERARCHY[UserRole.COUNTRY_MANAGER]);
  assert.ok(ROLE_HIERARCHY[UserRole.STATE_MANAGER] < ROLE_HIERARCHY[UserRole.SUPER_ADMIN]);
});
test('all descendants inherit country/state boundaries', () => {
  for (const role of roles) for (const regional of [false, true]) {
    const sponsor = { role: regional ? 'stateManager' : 'countryManager', hiringScope: { country: 'india', ...(regional ? { state: 'bihar' } : {}) } };
    const scope = deriveHiringScope(sponsor, role, { country: ' India ', state: 'BIHAR' });
    const child = { role, hiringScope: scope };
    assert.throws(() => deriveHiringScope(child, 'host', { country: 'Nepal', state: 'Bihar' }), /country/);
    if (regional) {
      assert.throws(() => deriveHiringScope(child, 'host', { country: 'India', state: 'Punjab' }), /state/);
      assert.throws(() => deriveHiringScope(child, 'host', { country: 'India' }), /state/);
    } else assert.doesNotThrow(() => deriveHiringScope(child, 'host', { country: 'India', state: 'Punjab' }));
    assert.deepEqual(deriveHiringScope(child, 'agency', { country: { name: 'INDIA' }, state: 'bihar' }), scope);
  }
});
test('Owner/Operator recruited staff can hire globally', () => {
  for (const role of ['owner', 'operator']) {
    const scope = deriveHiringScope({ role }, 'superAdmin', { country: 'India' });
    assert.deepEqual(scope, {});
    assert.deepEqual(deriveHiringScope({ role: 'superAdmin', hiringScope: scope }, 'admin', { country: 'Nepal' }), {});
  }
});
test('manager assignments fail closed without territory or authorized sponsor', () => {
  assert.deepEqual(deriveHiringScope({ role: 'operator' }, 'state-manager', { country: 'India', state: 'Bihar' }), { country: 'india', state: 'bihar' });
  assert.throws(() => deriveHiringScope({ role: 'owner' }, 'countryManager', {}), /country/);
  assert.throws(() => deriveHiringScope({ role: 'owner' }, 'stateManager', { country: 'India' }), /state/);
  assert.throws(() => deriveHiringScope({ role: 'admin' }, 'countryManager', { country: 'India' }), /Only Owner/);
  assert.throws(() => deriveHiringScope({ role: 'stateManager' }, 'host', { country: 'India', state: 'Bihar' }), /no assigned/);
});
test('resume and selfie holding ID are both required', () => {
  const resume = { documentType: 'Resume', url: 'https://example.test/resume.pdf' };
  const selfie = { documentType: 'SelfieWithIdCard', url: 'https://example.test/selfie.jpg' };
  for (const role of ['country-manager', 'stateManager']) {
    for (const docs of [[], [resume], [selfie]]) assert.throws(() => validateManagerDocuments(role, docs), /mandatory/);
    assert.doesNotThrow(() => validateManagerDocuments(role, [resume, selfie]));
  }
});
test('manager approval requires subordinate role and matching branch', () => {
  for (const manager of ['countryManager', 'stateManager']) for (const role of roles) {
    const request = { role, status: 'pending', roleData: { hierarchyPath: '/owner/manager' } };
    assert.equal(canActOnRequest({ id: 'manager', role: manager }, request).canAct, true);
    assert.equal(canActOnRequest({ id: 'outsider', role: manager }, request).canAct, false);
  }
  assert.equal(normalizeRoleKey('Country Manager Request'), 'countryManager');
  assert.equal(normalizeRoleKey('State Manager Request'), 'stateManager');
  assert.equal(canActOnRequest({ id: 'manager', role: 'countryManager' }, { role: 'operator', status: 'pending' }).canAct, false);
});
