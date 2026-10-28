import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { User } from '../models/user.model';
import Notification from '../models/notification.model';
import { RecruitmentApplication, RecruitmentRole } from '../models/recruitmentApplication.model';
import { RecruitmentRoleConfig } from '../models/recruitmentRoleConfig.model';
import { Request as RequestModel, RequestStatus } from '../models/request.model';
import { AuditLog } from '../models/auditLog.model';
import { ROLE_APPROVAL_CONFIG } from '../utils/emsApprovalRules';
import { atomic } from '../economy/service';
import { canInviteRole, effectiveTeamRole, normalizeTeamRole, scopeFields, teamScope } from './rules';
import { TeamInvitation } from './models';

const applicationAliases: Record<string, string> = { superAdmin: 'super-admin', bdLeader: 'bd-leader' };
const applicationRole = (role: string): RecruitmentRole => (applicationAliases[role] || role) as RecruitmentRole;
const titles: Record<string, string> = { operator: 'Operator', superAdmin: 'Super Admin', admin: 'Admin', bdLeader: 'BD Leader', bd: 'BD', agency: 'Agency', host: 'Host' };
export async function sendTeamInvitation(actorId: string, recipientUserId: number, role: string, requestKey: string) {
  role = normalizeTeamRole(role);
  if (!Number.isSafeInteger(recipientUserId) || !/^[A-Za-z0-9_-]{8,100}$/.test(requestKey)) throw new Error('Valid YARO user ID and request key required');
  return atomic(async session => {
    const inviter = await User.findById(actorId).session(session);
    if (!inviter || inviter.isDeleted || inviter.isBlocked || !canInviteRole(effectiveTeamRole(inviter), role)) throw new Error('This invitation role is not authorized');
    const recipient = await User.findOne({ userId: recipientUserId, isDeleted: { $ne: true }, isBlocked: { $ne: true } }).session(session);
    if (!recipient || String(recipient._id) === actorId) throw new Error('Recipient is unavailable');
    if (effectiveTeamRole(recipient) !== 'user' && effectiveTeamRole(recipient) !== role) throw new Error('Use the existing role-change approval workflow for this account');
    if (!['user', 'host', 'agency', 'bd'].includes(String(recipient.role || 'user'))) throw new Error('Use the existing employee/transfer approval workflow for this account');
    const bound = recipient.parentId || recipient.parentUserId || recipient.agencyId || recipient.bdId || recipient.bdLeaderId || recipient.adminId;
    if (bound && !await User.exists({ $and: [teamScope(actorId, effectiveTeamRole(inviter)), { _id: recipient._id }] }).session(session)) throw new Error('Account already belongs to another team; a transfer approval is required');
    const replay = await TeamInvitation.findOne({ inviterId: actorId, requestKey }).session(session);
    if (replay) {
      if (String(replay.recipientId) !== String(recipient._id) || replay.role !== role) throw new Error('Invitation key conflict');
      return replay;
    }
    const pending = await TeamInvitation.findOne({ inviterId: actorId, recipientId: recipient._id, role, state: 'pending' }).session(session);
    if (pending && pending.expiresAt > new Date()) return pending;
    if (pending) { pending.state = 'expired'; await pending.save({ session }); }
    const [invite] = await TeamInvitation.create([{ inviterId: actorId, recipientId: recipient._id, role, requestKey,
      expiresAt: new Date(Date.now() + 7 * 86400000) }], { session });
    await Notification.create([{ userId: recipient._id, title: `${titles[role]} team invitation`,
      message: `${inviter.name || 'Team manager'} invited you to apply as ${titles[role]}. Open this invitation, fill in your own details and submit for review.`,
      type: 'system', data: { action: 'team_invitation', invitationId: String(invite._id) } }], { session });
    await AuditLog.create([{ adminId: actorId, action: 'TEAM_INVITATION_SENT', target: String(invite._id), details: `Recipient ${recipient.userId}; role ${role}` }], { session });
    return invite;
  });
}
export async function readTeamInvitation(recipientId: string, id: string) {
  if (!Types.ObjectId.isValid(id)) throw new Error('Invalid invitation');
  const invite = await TeamInvitation.findOne({ _id: id, recipientId }).lean();
  if (!invite) throw new Error('Invitation not found');
  const [inviter, config] = await Promise.all([User.findById(invite.inviterId).select('name role').lean(),
    RecruitmentRoleConfig.findOne({ role: applicationRole(invite.role), isActive: true }).select('fields title').lean()]);
  return { id: String(invite._id), role: invite.role, state: invite.state, expiresAt: invite.expiresAt,
    inviter: { name: inviter?.name || 'Team manager', role: inviter?.role }, fields: config?.fields || [], applicationId: invite.applicationId };
}
export async function submitTeamInvitation(recipientId: string, id: string, input: Record<string, unknown>) {
  if (!Types.ObjectId.isValid(id)) throw new Error('Invalid invitation');
  const text = (key: string, required = false) => {
    const value = input[key]; if (value != null && typeof value !== 'string') throw new Error(`Invalid ${key}`);
    const clean = String(value || '').trim(); if (clean.length > 1000 || (required && !clean)) throw new Error(`${key} is required or too long`);
    return clean;
  };
  const name = text('name', true), email = text('email', true).toLowerCase(), phone = text('phone', true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+?[\d\s()-]{7,22}$/.test(phone)) throw new Error('Valid email and phone required');
  return atomic(async session => {
    const invite = await TeamInvitation.findOne({ _id: id, recipientId }).session(session);
    if (!invite) throw new Error('Invitation not found');
    if (invite.state === 'submitted') return { applicationId: invite.applicationId, requestId: invite.requestId, state: 'submitted', replay: true };
    if (invite.state !== 'pending' || invite.expiresAt <= new Date()) throw new Error('Invitation is no longer active');
    const inviter = await User.findById(invite.inviterId).session(session);
    const recipient = await User.findById(recipientId).session(session);
    if (!inviter || !recipient || inviter.isDeleted || inviter.isBlocked || recipient.isDeleted || recipient.isBlocked || !canInviteRole(effectiveTeamRole(inviter), invite.role)) throw new Error('Invitation is no longer authorized');
    if (effectiveTeamRole(recipient) !== 'user' && effectiveTeamRole(recipient) !== invite.role) throw new Error('Account role changed; request a new authorized invitation');
    const bound = recipient.parentId || recipient.parentUserId || recipient.agencyId || recipient.bdId || recipient.bdLeaderId || recipient.adminId;
    if (bound && !await User.exists({ $and: [teamScope(String(inviter._id), effectiveTeamRole(inviter)), { _id: recipient._id }] }).session(session)) throw new Error('A transfer approval is required for the current team');
    await User.updateOne({ _id: recipientId }, { $inc: { recruitmentRevision: 1 } }, { session });
    const role = applicationRole(invite.role), config = await RecruitmentRoleConfig.findOne({ role, isActive: true }).session(session);
    const roleData: Record<string, any> = {};
    const protectedKeys = /password|role|permission|parent|hierarchy|referr|owner|operator|admin|agencyId|bdId|userId|yaroId|__proto__|constructor/i;
    for (const field of config?.fields || []) {
      const key = field.fieldKey; if (protectedKeys.test(key) || ['name', 'email', 'phone', 'hostTypes'].includes(key)) continue;
      const value = input[key];
      if (field.required && field.fieldType === 'checkbox' && value !== true) throw new Error(`${field.label} must be accepted`);
      if (field.fieldType === 'upload' && value && (typeof value !== 'string' || !/^https:\/\//i.test(value))) throw new Error(`${field.label} must be an uploaded HTTPS document URL`);
      if (field.required && (value == null || value === '' || (Array.isArray(value) && !value.length))) throw new Error(`${field.label} is required`);
      if (value == null) continue;
      if (typeof value === 'string' && value.length <= 2000) roleData[key] = value.trim();
      else if (typeof value === 'boolean') roleData[key] = value;
      else if (Array.isArray(value) && value.every(v => typeof v === 'string' && v.length <= 100) && value.length <= 20) roleData[key] = value;
      else throw new Error(`Invalid ${field.label}`);
      if (field.options?.length && ['dropdown', 'radio', 'multi-select'].includes(field.fieldType)) {
        for (const selected of Array.isArray(value) ? value : [value]) if (!field.options.includes(String(selected))) throw new Error(`Invalid ${field.label} option`);
      }
    }
    if (invite.role === 'host' && (!Array.isArray(input.hostTypes) || !input.hostTypes.length)) throw new Error('Choose hosting types');
    if (Array.isArray(input.hostTypes)) {
      if (!input.hostTypes.length || input.hostTypes.some(t => !['voice', 'video', 'room'].includes(String(t)))) throw new Error('Select valid hosting types');
      roleData.hostTypes = [...new Set(input.hostTypes)];
    }
    const ancestry: Record<string, string> = {};
    for (const [r, field] of Object.entries({ owner: 'ownerId', ...scopeFields })) {
      const value = effectiveTeamRole(inviter) === r ? inviter._id : (inviter as any)[field];
      if (value) ancestry[field] = String(value);
    }
    Object.assign(roleData, ancestry, { hierarchyPath: `${inviter.hierarchyPath || ''}/${inviter._id}`.replace(/\/+/g, '/'),
      yaroId: String(recipient.userId), userId: recipient.userId, invitationId: String(invite._id), parentId: String(inviter._id), parentRole: effectiveTeamRole(inviter) });
    const existing = await RecruitmentApplication.findOne({ 'applicant.userId': recipient.userId, role, status: { $in: ['pending', 'under_review', 'submitted', 'interview_scheduled'] } }).session(session);
    if (existing) throw new Error('An application for this role is already being reviewed');
    const [application] = await RecruitmentApplication.create([{ applicationId: `APP-${invite.role.toUpperCase()}-${randomUUID()}`, role,
      status: 'pending', applicant: { name, email, phone, gender: text('gender') || 'other', country: text('country') || 'India', city: text('city'),
        experienceYears: text('experienceYears'), yaroId: String(recipient.userId), userId: recipient.userId }, roleData,
      referrer: { referrerId: inviter._id, referrerRole: effectiveTeamRole(inviter), referrerName: inviter.name, code: inviter.employeeCode || inviter.referralCode || '' },
      reviewNotes: [{ authorName: 'System', text: 'Authenticated invitation submitted by the recipient; approval required.' }] }], { session });
    const [request] = await RequestModel.create([{ requestType: `${titles[invite.role]} Request`, role,
      userId: recipient.userId, status: RequestStatus.PENDING, workflowSteps: ROLE_APPROVAL_CONFIG[invite.role]?.steps || [], generatedUserId: recipient.userId,
      createdBy: String(inviter._id), createdByRole: effectiveTeamRole(inviter), referralUserId: String(inviter._id), referralRole: effectiveTeamRole(inviter), referralOwner: inviter.name,
      referralCode: inviter.employeeCode || inviter.referralCode || '',
      data: { ...roleData, name, email, phoneNumber: phone, mobile: phone, city: text('city'), gender: text('gender') || 'other',
        recruitmentAppId: String(application._id), mithiChatId: application.applicationId, invitedBy: inviter.name },
      timeline: [{ action: 'INVITATION_SUBMITTED', actor: name, actorRole: recipient.role, remarks: `Invitation ${invite._id}` }] }], { session });
    invite.state = 'submitted'; invite.applicationId = application._id; invite.requestId = request._id; await invite.save({ session });
    await Notification.create([{ userId: inviter._id, title: 'Team application received', message: `${name} submitted the ${titles[invite.role]} application. Review it in the existing Request Center.`, type: 'system', data: { action: 'team_application_received', requestId: String(request._id) } }], { session });
    return { applicationId: application.applicationId, requestId: String(request._id), state: 'submitted' };
  });
}
