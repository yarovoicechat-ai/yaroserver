import { User } from '../models/user.model';
import { TeamInvitation } from './models';
import { canInviteRole, effectiveTeamRole, normalizeTeamRole } from './rules';

/** Bind existing EMS approval to the authenticated invitation, never a supplied referral code. */
export async function invitationSponsor(request: any) {
  if (!request.data?.invitationId) return null;
  const invite = await TeamInvitation.findOne({ _id: request.data.invitationId, requestId: request._id, state: 'submitted' }).lean();
  if (!invite || normalizeTeamRole(request.role) !== invite.role) throw new Error('Invitation approval binding is invalid');
  const [inviter, recipient] = await Promise.all([User.findById(invite.inviterId).lean(), User.findById(invite.recipientId).lean()]);
  if (!inviter || !recipient || inviter.isBlocked || inviter.isDeleted || recipient.isBlocked || recipient.isDeleted ||
    !canInviteRole(effectiveTeamRole(inviter), invite.role) || recipient.userId !== request.generatedUserId) throw new Error('Invitation is no longer authorized');
  const fields = ['ownerId', 'operatorId', 'superAdminId', 'adminId', 'bdLeaderId', 'bdId', 'agencyId'];
  const currentRole = effectiveTeamRole(inviter);
  const ownField: Record<string, string> = { owner: 'ownerId', operator: 'operatorId', superAdmin: 'superAdminId', admin: 'adminId', bdLeader: 'bdLeaderId', bd: 'bdId', agency: 'agencyId' };
  for (const field of fields) {
    const expected = field === ownField[currentRole] ? String(inviter._id) : String((inviter as any)[field] || '');
    if (String(request.data[field] || '') !== expected) throw new Error('Inviter hierarchy changed; a fresh invitation/review is required');
  }
  if (recipient.role !== 'user' && normalizeTeamRole(recipient.role) !== invite.role) throw new Error('Recipient role changed; use the role-change workflow');
  return { ...inviter, role: currentRole };
}
