import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canActOnRequest,
  isDirectApprover,
  isActorInRequestBranch,
  ROLE_APPROVAL_CONFIG,
  normalizeRoleKey,
} from '../utils/emsApprovalRules';
import { HierarchyScopeService } from '../utils/hierarchyScope';

test('1. Role approval configuration matches notebook requirements', () => {
  // Host: Agency -> BD -> BD Leader -> Admin -> Super Admin (Direct: Operator, Owner)
  const hostConfig = ROLE_APPROVAL_CONFIG.host;
  assert.deepEqual(hostConfig.stepRoles, ['agency', 'bd', 'bdLeader', 'admin', 'superAdmin']);
  assert.deepEqual(hostConfig.directApprovers, ['operator', 'owner']);

  // Agency: BD -> BD Leader -> Admin -> Super Admin (Direct: Operator, Owner)
  const agencyConfig = ROLE_APPROVAL_CONFIG.agency;
  assert.deepEqual(agencyConfig.stepRoles, ['bd', 'bdLeader', 'admin', 'superAdmin']);
  assert.deepEqual(agencyConfig.directApprovers, ['operator', 'owner']);

  // BD: BD Leader -> Admin -> Super Admin (Direct: Operator, Owner)
  const bdConfig = ROLE_APPROVAL_CONFIG.bd;
  assert.deepEqual(bdConfig.stepRoles, ['bdLeader', 'admin', 'superAdmin']);
  assert.deepEqual(bdConfig.directApprovers, ['operator', 'owner']);

  // BD Leader: Admin -> Super Admin (Direct: Operator, Owner)
  const bdlConfig = ROLE_APPROVAL_CONFIG.bdLeader;
  assert.deepEqual(bdlConfig.stepRoles, ['admin', 'superAdmin']);
  assert.deepEqual(bdlConfig.directApprovers, ['operator', 'owner']);

  // CS: Admin -> Super Admin (Direct: Operator, Owner)
  const csConfig = ROLE_APPROVAL_CONFIG.customerSupport;
  assert.deepEqual(csConfig.stepRoles, ['admin', 'superAdmin']);
  assert.deepEqual(csConfig.directApprovers, ['operator', 'owner']);

  // Admin: Super Admin (Direct: Operator, Owner)
  const adminConfig = ROLE_APPROVAL_CONFIG.admin;
  assert.deepEqual(adminConfig.stepRoles, ['superAdmin']);
  assert.deepEqual(adminConfig.directApprovers, ['operator', 'owner']);

  // Super Admin: Direct Operator / Owner
  const saConfig = ROLE_APPROVAL_CONFIG.superAdmin;
  assert.deepEqual(saConfig.directApprovers, ['operator', 'owner']);

  // Operator: STRICTLY Owner Only
  const oprConfig = ROLE_APPROVAL_CONFIG.operator;
  assert.deepEqual(oprConfig.stepRoles, ['owner']);
  assert.deepEqual(oprConfig.directApprovers, ['owner']);
});

test('2. Direct approval override: Operator and Owner can directly approve at any stage', () => {
  assert.equal(isDirectApprover('owner', 'host'), true);
  assert.equal(isDirectApprover('operator', 'host'), true);
  assert.equal(isDirectApprover('operator', 'agency'), true);
  assert.equal(isDirectApprover('operator', 'bd'), true);
  assert.equal(isDirectApprover('operator', 'bdLeader'), true);
  assert.equal(isDirectApprover('operator', 'customerSupport'), true);
  assert.equal(isDirectApprover('operator', 'admin'), true);
  assert.equal(isDirectApprover('operator', 'superAdmin'), true);

  // Critical security rule: Operator CANNOT approve an Operator! Owner only!
  assert.equal(isDirectApprover('operator', 'operator'), false);
  assert.equal(isDirectApprover('owner', 'operator'), true);
});

test('3. Strict branch isolation: requests in Branch 1 are invisible and cannot be approved by Branch 2', () => {
  const branch1Actor = { id: 'admin_branch_1', role: 'admin' };
  const branch2Actor = { id: 'admin_branch_2', role: 'admin' };

  const branch1HostRequest = {
    role: 'host',
    requestType: 'Host Request',
    status: 'pending',
    currentStepIndex: 0,
    referralUserId: 'agency_branch_1',
    data: {
      adminId: 'admin_branch_1',
      agencyId: 'agency_branch_1',
      hierarchyPath: '/owner_1/op_1/sa_1/admin_branch_1/bdl_1/bd_1/agency_branch_1',
    },
  };

  // Branch 1 Admin IS in branch
  assert.equal(isActorInRequestBranch(branch1Actor, branch1HostRequest), true);
  // Branch 2 Admin IS NOT in branch
  assert.equal(isActorInRequestBranch(branch2Actor, branch1HostRequest), false);

  // Branch 2 Admin trying to approve Branch 1 request must fail with 403 Access Denied
  const branch2Eval = canActOnRequest(branch2Actor, branch1HostRequest);
  assert.equal(branch2Eval.canAct, false);
  assert.match(branch2Eval.reason || '', /Access Denied/i);

  // Platform Owner CAN act across any branch
  const ownerActor = { id: 'owner_global', role: 'owner' };
  assert.equal(isActorInRequestBranch(ownerActor, branch1HostRequest), true);
  const ownerEval = canActOnRequest(ownerActor, branch1HostRequest);
  assert.equal(ownerEval.canAct, true);
  assert.equal(ownerEval.isDirectApproval, true);
});

test('4. Operator branch isolation: Operator 1 cannot see or approve Operator 2 branch requests', () => {
  const operator1 = { id: 'op_1', role: 'operator' };
  const operator2 = { id: 'op_2', role: 'operator' };

  const op1Request = {
    role: 'agency',
    requestType: 'Agency Request',
    status: 'pending',
    currentStepIndex: 0,
    referralUserId: 'bd_branch_1',
    data: {
      operatorId: 'op_1',
      hierarchyPath: '/owner_1/op_1/sa_1/admin_1/bdl_1/bd_branch_1',
    },
  };

  assert.equal(isActorInRequestBranch(operator1, op1Request), true);
  assert.equal(isActorInRequestBranch(operator2, op1Request), false);

  const op1Eval = canActOnRequest(operator1, op1Request);
  assert.equal(op1Eval.canAct, true);
  assert.equal(op1Eval.isDirectApproval, true); // Direct override by Operator

  const op2Eval = canActOnRequest(operator2, op1Request);
  assert.equal(op2Eval.canAct, false);
  assert.match(op2Eval.reason || '', /Access Denied/i);
});

test('5. Multi-tier progression for Host within same branch', () => {
  const hostRequest = {
    role: 'host',
    status: 'pending',
    currentStepIndex: 0, // Stage 0: Agency
    referralUserId: 'agency_1',
    data: {
      agencyId: 'agency_1',
      bdId: 'bd_1',
      bdLeaderId: 'bdl_1',
      adminId: 'admin_1',
      superAdminId: 'sa_1',
      operatorId: 'op_1',
      hierarchyPath: '/owner_1/op_1/sa_1/admin_1/bdl_1/bd_1/agency_1',
    },
  };

  // Stage 0: Agency 1 can act
  const agencyEval = canActOnRequest({ id: 'agency_1', role: 'agency' }, hostRequest);
  assert.equal(agencyEval.canAct, true);
  assert.equal(agencyEval.isDirectApproval, false); // Intermediate review

  // Stage 0: Rival Agency 2 CANNOT act
  const rivalAgencyEval = canActOnRequest({ id: 'agency_2', role: 'agency' }, hostRequest);
  assert.equal(rivalAgencyEval.canAct, false);

  // Stage 0: BD 1 (higher up in chain) can also review or advance
  const bdEval = canActOnRequest({ id: 'bd_1', role: 'bd' }, hostRequest);
  assert.equal(bdEval.canAct, true);

  // Stage 0: Super Admin 1 (last stage approver in branch) can finalize
  const saEval = canActOnRequest({ id: 'sa_1', role: 'superAdmin' }, hostRequest);
  assert.equal(saEval.canAct, true);
  assert.equal(saEval.isDirectApproval, true);
});

test('6. HierarchyScopeService.buildRequestScope isolates branches', () => {
  const op1Scope = HierarchyScopeService.buildRequestScope({ id: 'op_1', role: 'operator' });
  assert.ok(op1Scope.$or);
  assert.ok(op1Scope.$or.some((c: any) => c['data.operatorId'] === 'op_1'));

  const sa1Scope = HierarchyScopeService.buildRequestScope({ id: 'sa_1', role: 'superAdmin' });
  assert.ok(sa1Scope.$or);
  assert.ok(sa1Scope.$or.some((c: any) => c['data.superAdminId'] === 'sa_1'));

  const admin1Scope = HierarchyScopeService.buildRequestScope({ id: 'adm_1', role: 'admin' });
  assert.ok(admin1Scope.$or);
  assert.ok(admin1Scope.$or.some((c: any) => c['data.adminId'] === 'adm_1'));

  const bdl1Scope = HierarchyScopeService.buildRequestScope({ id: 'bdl_1', role: 'bdLeader' });
  assert.ok(bdl1Scope.$or);
  assert.ok(bdl1Scope.$or.some((c: any) => c['data.bdLeaderId'] === 'bdl_1'));

  const bd1Scope = HierarchyScopeService.buildRequestScope({ id: 'bd_1', role: 'bd' });
  assert.ok(bd1Scope.$or);
  assert.ok(bd1Scope.$or.some((c: any) => c['data.bdId'] === 'bd_1'));

  const ag1Scope = HierarchyScopeService.buildRequestScope({ id: 'ag_1', role: 'agency' });
  assert.ok(ag1Scope.$or);
  assert.ok(ag1Scope.$or.some((c: any) => c['data.agencyId'] === 'ag_1'));
});
