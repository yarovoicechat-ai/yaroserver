import { RequestStatus } from '../models/request.model';

export interface AdminOperatorRequestLike {
  role?: string;
  requestType?: string;
  status?: string;
  approvedBy?: Array<{ role?: string }>;
}

export interface ApprovalStage {
  index: 0 | 1;
  role: 'admin' | 'operator';
  label: 'Stage 1: Admin Approval' | 'Stage 2: Operator Final Approval';
}

export const isAdminOperatorApprovalRequest = (request: AdminOperatorRequestLike): boolean => {
  const roleToken = String(request.role || request.requestType || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return roleToken === 'agency' || roleToken === 'agencyrequest' ||
    roleToken.includes('host') || roleToken === 'admin' || roleToken === 'adminrequest';
};

export const getAdminOperatorApprovalStage = (request: AdminOperatorRequestLike): ApprovalStage => {
  const adminApproved = (request.approvedBy || []).some(
    (approval) => String(approval?.role || '').trim().toLowerCase() === 'admin',
  );
  return adminApproved
    ? { index: 1, role: 'operator', label: 'Stage 2: Operator Final Approval' }
    : { index: 0, role: 'admin', label: 'Stage 1: Admin Approval' };
};

export const canActOnAdminOperatorRequest = (
  request: AdminOperatorRequestLike,
  actorRole: string,
): boolean => {
  if (!isAdminOperatorApprovalRequest(request)) return false;
  if ([RequestStatus.APPROVED, RequestStatus.REJECTED, RequestStatus.CANCELLED, RequestStatus.EXPIRED].includes(request.status as RequestStatus)) {
    return false;
  }
  return getAdminOperatorApprovalStage(request).role === actorRole;
};
