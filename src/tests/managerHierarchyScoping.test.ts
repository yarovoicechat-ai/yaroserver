import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { HierarchyScopeService } from '../utils/hierarchyScope';
import { isActorInRequestBranch } from '../utils/emsApprovalRules';

test('1. HierarchyScopeService.buildUserScope for State Manager strictly excludes Country Manager and State Managers', () => {
  const stateManagerId = new mongoose.Types.ObjectId().toString();
  const scope = HierarchyScopeService.buildUserScope({ id: stateManagerId, role: 'stateManager' });

  assert.ok(scope.$and, 'Scope should have $and conditions');
  
  // Find the role filter in $and
  const roleCondition = scope.$and.find((c: any) => c.$or && c.$or.some((o: any) => o.role && o.role.$nin));
  assert.ok(roleCondition, 'Should have role restriction condition');
  
  const ninList = roleCondition.$or.find((o: any) => o.role?.$nin)?.role?.$nin;
  assert.ok(ninList.includes('countryManager'), 'Must exclude countryManager');
  assert.ok(ninList.includes('country-manager'), 'Must exclude country-manager');
  assert.ok(ninList.includes('stateManager'), 'Must exclude stateManager');
  assert.ok(ninList.includes('state-manager'), 'Must exclude state-manager');
  assert.ok(ninList.includes('owner'), 'Must exclude owner');
  assert.ok(ninList.includes('operator'), 'Must exclude operator');
});

test('2. HierarchyScopeService.buildUserScope for Country Manager strictly excludes Owner, Operator, and other Country Managers', () => {
  const countryManagerId = new mongoose.Types.ObjectId().toString();
  const scope = HierarchyScopeService.buildUserScope({ id: countryManagerId, role: 'countryManager' });

  assert.ok(scope.$and, 'Scope should have $and conditions');
  
  const roleCondition = scope.$and.find((c: any) => c.$or && c.$or.some((o: any) => o.role && o.role.$nin));
  assert.ok(roleCondition, 'Should have role restriction condition');
  
  const ninList = roleCondition.$or.find((o: any) => o.role?.$nin)?.role?.$nin;
  assert.ok(ninList.includes('countryManager'), 'Must exclude countryManager');
  assert.ok(ninList.includes('country-manager'), 'Must exclude country-manager');
  assert.ok(ninList.includes('owner'), 'Must exclude owner');
  assert.ok(ninList.includes('operator'), 'Must exclude operator');
  // Country manager CAN see stateManager (subordinate)
  assert.ok(!ninList.includes('stateManager'), 'Should allow subordinate stateManager');
});

test('3. HierarchyScopeService.buildRequestScope enforces strict isolation between Country Manager A and Country Manager B', () => {
  const cmAId = new mongoose.Types.ObjectId().toString();
  const cmBId = new mongoose.Types.ObjectId().toString();

  const scopeA = HierarchyScopeService.buildRequestScope({ id: cmAId, role: 'countryManager' });
  const scopeB = HierarchyScopeService.buildRequestScope({ id: cmBId, role: 'countryManager' });

  // Excludes upper/peer roles
  assert.deepEqual(scopeA.role, { $nin: ['owner', 'operator', 'country-manager', 'countryManager'] });

  // Ensure NO leaky public or unlinked fallback conditions in scope
  const hasPublicLeakerA = scopeA.$or.some((cond: any) => 
    cond.createdBy?.$in?.includes('public') || cond.referralUserId?.$in?.includes(null)
  );
  assert.equal(hasPublicLeakerA, false, 'Country Manager scope must not leak public/unassigned requests');

  // Verify that scopeA strictly checks cmAId and scopeB strictly checks cmBId
  const aContainsA = JSON.stringify(scopeA).includes(cmAId);
  const aContainsB = JSON.stringify(scopeA).includes(cmBId);
  assert.equal(aContainsA, true, 'Scope A must filter by CM A ID');
  assert.equal(aContainsB, false, 'Scope A must NOT contain CM B ID');

  const bContainsB = JSON.stringify(scopeB).includes(cmBId);
  const bContainsA = JSON.stringify(scopeB).includes(cmAId);
  assert.equal(bContainsB, true, 'Scope B must filter by CM B ID');
  assert.equal(bContainsA, false, 'Scope B must NOT contain CM A ID');
});

test('4. HierarchyScopeService.buildRequestScope for State Manager strictly excludes Country Manager & State Manager requests', () => {
  const smId = new mongoose.Types.ObjectId().toString();
  const scope = HierarchyScopeService.buildRequestScope({ id: smId, role: 'stateManager' });

  assert.deepEqual(scope.role, { 
    $nin: ['owner', 'operator', 'country-manager', 'countryManager', 'state-manager', 'stateManager'] 
  });

  const hasPublicLeaker = scope.$or.some((cond: any) => 
    cond.createdBy?.$in?.includes('public') || cond.referralUserId?.$in?.includes(null)
  );
  assert.equal(hasPublicLeaker, false, 'State Manager scope must not leak public/unassigned requests');
});

test('5. isActorInRequestBranch rejects cross-country manager request access', () => {
  const cmAId = new mongoose.Types.ObjectId().toString();
  const cmBId = new mongoose.Types.ObjectId().toString();

  const requestUnderCmA = {
    _id: new mongoose.Types.ObjectId().toString(),
    countryManagerId: cmAId,
    data: {
      countryManagerId: cmAId,
      hierarchyPath: `/${cmAId}`
    }
  };

  // CM A is in branch
  assert.equal(isActorInRequestBranch({ id: cmAId, role: 'countryManager' }, requestUnderCmA), true);

  // CM B is NOT in branch
  assert.equal(isActorInRequestBranch({ id: cmBId, role: 'countryManager' }, requestUnderCmA), false);
});
