import { RequestStatus } from '../models/request.model';

export const normalizeRoleKey = (role: string = ''): string => {
  const clean = role.toLowerCase().replace(/[\s_-]/g, '');
  if (clean.includes('superadmin')) return 'superAdmin';
  if (clean.includes('bdleader')) return 'bdLeader';
  if (clean === 'bd' || clean.includes('bdrequest')) return 'bd';
  if (clean.includes('agency')) return 'agency';
  if (clean.includes('operator')) return 'operator';
  if (clean.includes('admin')) return 'admin';
  if (clean.includes('support') || clean.includes('customer') || clean === 'cs') return 'customerSupport';
  if (clean.includes('host')) return 'host';
  if (clean.includes('seller') || clean.includes('coin')) return 'coinSeller';
  if (clean.includes('owner')) return 'owner';
  return clean;
};

export interface WorkflowDefinition {
  targetRole: string;
  steps: string[];
  stepRoles: string[];
  directApprovers: string[];
}

/**
 * Platform Multi-Tier Approval Hierarchy Configuration
 * 1. Host: Agency -> BD -> BD Leader -> Admin -> Super Admin (Direct: Operator, Owner)
 * 2. Agency: BD -> BD Leader -> Admin -> Super Admin (Direct: Operator, Owner)
 * 3. BD: BD Leader -> Admin -> Super Admin (Direct: Operator, Owner)
 * 4. BD Leader: Admin -> Super Admin (Direct: Operator, Owner)
 * 5. CS (Customer Support): Admin -> Super Admin (Direct: Operator, Owner)
 * 6. Admin: Super Admin (Direct: Operator, Owner)
 * 7. Super Admin: Operator / Owner Direct Approve
 * 8. Operator: Owner Only
 */
export const ROLE_APPROVAL_CONFIG: Record<string, WorkflowDefinition> = {
  host: {
    targetRole: 'host',
    steps: [
      'Stage 1: Agency Review',
      'Stage 2: BD Review',
      'Stage 3: BD Leader Review',
      'Stage 4: Admin Review',
      'Stage 5: Super Admin Final Approval',
    ],
    stepRoles: ['agency', 'bd', 'bdLeader', 'admin', 'superAdmin'],
    directApprovers: ['operator', 'owner'],
  },
  agency: {
    targetRole: 'agency',
    steps: [
      'Stage 1: BD Review',
      'Stage 2: BD Leader Review',
      'Stage 3: Admin Review',
      'Stage 4: Super Admin Final Approval',
    ],
    stepRoles: ['bd', 'bdLeader', 'admin', 'superAdmin'],
    directApprovers: ['operator', 'owner'],
  },
  bd: {
    targetRole: 'bd',
    steps: [
      'Stage 1: BD Leader Review',
      'Stage 2: Admin Review',
      'Stage 3: Super Admin Final Approval',
    ],
    stepRoles: ['bdLeader', 'admin', 'superAdmin'],
    directApprovers: ['operator', 'owner'],
  },
  bdLeader: {
    targetRole: 'bdLeader',
    steps: [
      'Stage 1: Admin Review',
      'Stage 2: Super Admin Final Approval',
    ],
    stepRoles: ['admin', 'superAdmin'],
    directApprovers: ['operator', 'owner'],
  },
  customerSupport: {
    targetRole: 'customerSupport',
    steps: [
      'Stage 1: Admin Review',
      'Stage 2: Super Admin Final Approval',
    ],
    stepRoles: ['admin', 'superAdmin'],
    directApprovers: ['operator', 'owner'],
  },
  admin: {
    targetRole: 'admin',
    steps: [
      'Stage 1: Super Admin Final Approval',
    ],
    stepRoles: ['superAdmin'],
    directApprovers: ['operator', 'owner'],
  },
  superAdmin: {
    targetRole: 'superAdmin',
    steps: [
      'Stage 1: Operator / Owner Direct Approval',
    ],
    stepRoles: ['operator', 'owner'],
    directApprovers: ['operator', 'owner'],
  },
  operator: {
    targetRole: 'operator',
    steps: [
      'Stage 1: Platform Owner Only Approval',
    ],
    stepRoles: ['owner'],
    directApprovers: ['owner'],
  },
  coinSeller: {
    targetRole: 'coinSeller',
    steps: [
      'Stage 1: Operator Review',
      'Stage 2: Owner Approval',
    ],
    stepRoles: ['operator', 'owner'],
    directApprovers: ['owner'],
  },
};

/**
 * Returns true if actor is an authorized direct approver who can approve immediately
 * at any stage without intermediate reviews
 */
export const isDirectApprover = (actorRole: string, targetRole: string): boolean => {
  const normActor = normalizeRoleKey(actorRole);
  const normTarget = normalizeRoleKey(targetRole);

  // Operator can NEVER approve an Operator (Owner Only)
  if (normTarget === 'operator') {
    return normActor === 'owner';
  }

  const config = ROLE_APPROVAL_CONFIG[normTarget];
  if (config && config.directApprovers.includes(normActor)) {
    return true;
  }

  return normActor === 'owner';
};

/**
 * Strict branch isolation check:
 * Returns true only if the actor is in the upstream hierarchy branch of the request,
 * or if the actor is the Platform Owner.
 */
export const isActorInRequestBranch = (actor: { id: string | any; role: string }, requestData: any): boolean => {
  const normActor = normalizeRoleKey(actor.role);
  if (normActor === 'owner') return true;

  const actorId = String(actor.id || (actor as any)._id || '');
  if (!actorId) return false;

  // Direct referral or creator match
  const referralUserId = String(requestData.referralUserId || requestData.referrer?.referrerId || '');
  const createdBy = String(requestData.createdBy || '');
  if (referralUserId === actorId || createdBy === actorId) {
    return true;
  }

  const data = requestData.data || requestData.roleData || {};
  const branchFields = [
    data.operatorId,
    data.superAdminId,
    data.adminId,
    data.bdLeaderId,
    data.bdId,
    data.agencyId,
    requestData.operatorId,
    requestData.superAdminId,
    requestData.adminId,
    requestData.bdLeaderId,
    requestData.bdId,
    requestData.agencyId,
  ];

  if (branchFields.some((field) => field && String(field) === actorId)) {
    return true;
  }

  const hierarchyPath = String(data.hierarchyPath || requestData.hierarchyPath || '');
  if (hierarchyPath && hierarchyPath.includes(actorId)) {
    return true;
  }

  return false;
};

/**
 * Evaluates whether an actor can approve/reject the request at the current stage
 */
export const canActOnRequest = (
  actor: { id: string | any; role: string },
  request: any
): { canAct: boolean; isDirectApproval: boolean; reason?: string } => {
  if (
    [RequestStatus.APPROVED, RequestStatus.REJECTED, RequestStatus.CANCELLED, RequestStatus.EXPIRED].includes(
      request.status as RequestStatus
    )
  ) {
    return { canAct: false, isDirectApproval: false, reason: `Request is already ${request.status}.` };
  }

  const normActor = normalizeRoleKey(actor.role);
  const targetRole = normalizeRoleKey(request.role || request.requestType || '');

  // 1. Strict branch isolation check
  if (!isActorInRequestBranch(actor, request)) {
    return {
      canAct: false,
      isDirectApproval: false,
      reason: 'Access Denied: This application belongs to another branch/network.',
    };
  }

  // 2. Operator target: strictly Owner only
  if (targetRole === 'operator') {
    if (normActor !== 'owner') {
      return {
        canAct: false,
        isDirectApproval: false,
        reason: 'Operator applications can ONLY be approved by Platform Owner.',
      };
    }
    return { canAct: true, isDirectApproval: true };
  }

  // 3. Direct approvers (Operator / Owner bypass at any stage)
  if (isDirectApprover(normActor, targetRole)) {
    return { canAct: true, isDirectApproval: true };
  }

  // 4. Multi-tier step check
  const config = ROLE_APPROVAL_CONFIG[targetRole];
  if (!config) {
    if (['admin', 'superAdmin'].includes(normActor)) {
      return { canAct: true, isDirectApproval: false };
    }
    return { canAct: false, isDirectApproval: false, reason: 'Unauthorized role for this workflow.' };
  }

  const currentStep = request.currentStepIndex || 0;
  const stepIndexForActor = config.stepRoles.indexOf(normActor);

  if (stepIndexForActor >= currentStep) {
    const isLastStep = stepIndexForActor === config.stepRoles.length - 1;
    return { canAct: true, isDirectApproval: isLastStep };
  }

  const requiredRole = config.stepRoles[currentStep] || 'Authorized Approver';
  return {
    canAct: false,
    isDirectApproval: false,
    reason: `Verification failure: Current stage requires '${requiredRole}' role approval.`,
  };
};

export interface AdminOperatorRequestLike {
  role?: string;
  requestType?: string;
  status?: string;
  approvedBy?: Array<{ role?: string }>;
}

export interface ApprovalStage {
  index: number;
  role: string;
  label: string;
}

export const isAdminOperatorApprovalRequest = (request: AdminOperatorRequestLike): boolean => {
  const roleToken = normalizeRoleKey(request.role || request.requestType || '');
  return Boolean(ROLE_APPROVAL_CONFIG[roleToken]);
};

export const getAdminOperatorApprovalStage = (request: any): ApprovalStage => {
  const targetRole = normalizeRoleKey(request.role || request.requestType || '');
  const config = ROLE_APPROVAL_CONFIG[targetRole];
  const currentStep = request.currentStepIndex || 0;

  if (config && config.stepRoles[currentStep]) {
    return {
      index: currentStep,
      role: config.stepRoles[currentStep],
      label: config.steps[currentStep] || `Stage ${currentStep + 1} Review`,
    };
  }

  return { index: 0, role: 'admin', label: 'Stage 1: Admin Approval' };
};

export const canActOnAdminOperatorRequest = (
  request: any,
  actorRole: string
): boolean => {
  return canActOnRequest({ id: '', role: actorRole }, request).canAct;
};
