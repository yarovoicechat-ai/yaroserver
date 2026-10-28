import { Types } from 'mongoose';
export const TEAM_ROLES = ['owner', 'operator', 'superAdmin', 'admin', 'bdLeader', 'bd', 'agency', 'host'] as const;
export const CHANNELS = ['voice', 'video', 'room'] as const;
export type Channel = typeof CHANNELS[number];
const roleAliases: Record<string, string> = { superadmin: 'superAdmin', bdleader: 'bdLeader' };
export const normalizeTeamRole = (role: unknown) => roleAliases[String(role).replace(/[\s_-]/g, '').toLowerCase()] || String(role).toLowerCase();
export function effectiveTeamRole(user: any): string {
  const role = normalizeTeamRole(user.role);
  if (role !== 'user') return role;
  const appRole = normalizeTeamRole(user.appRole || '');
  if (user.hasAppOption === true && user.hasAppAccess !== false && appRole) {
    const approved = appRole === 'agency' ? user.isAgency === true || user.isAgencyOwner === true
      : appRole === 'bd' ? user.isBD === true || user.isBd === true
      : appRole === 'bdLeader' ? user.isBdLeader === true
      : appRole === 'host' ? user.isApprovedHost === true || user.isHostApproved === true || user.isHost === true : false;
    if (approved) return appRole;
  }
  if (user.isApprovedHost === true || user.isHostApproved === true || user.isHost === true) return 'host';
  if (user.isAgency === true || user.isAgencyOwner === true) return 'agency';
  if (user.isBD === true || user.isBd === true) return 'bd';
  if (user.isBdLeader === true) return 'bdLeader';
  return role;
}
export const teamPeople = {
  $or: [
    { role: { $in: TEAM_ROLES } },
    { role: 'user', hasAppOption: true, appRole: { $in: ['bd', 'bdLeader', 'bd-leader', 'agency', 'host'] } },
    { isApprovedHost: true },
    { isHostApproved: true },
    { isHost: true },
    { isAgency: true },
    { isAgencyOwner: true },
    { isBD: true },
    { isBd: true },
    { isBdLeader: true }
  ]
};
export const scopeFields: Record<string, string> = { operator: 'operatorId', superAdmin: 'superAdminId', admin: 'adminId', bdLeader: 'bdLeaderId', bd: 'bdId', agency: 'agencyId' };
export function canInviteRole(actor: string, target: string) {
  const a = TEAM_ROLES.indexOf(normalizeTeamRole(actor) as any), t = TEAM_ROLES.indexOf(normalizeTeamRole(target) as any);
  return a >= 0 && t > a && target !== 'owner';
}
export function belongsTo(member: any, root: string): boolean {
  if (String(member._id) === root) return true;
  if (Object.values(scopeFields).some(field => String(member[field] || '') === root)) return true;
  if (String(member.parentId || member.parentUserId || member.referredBy || member.referrerId || '') === root) return true;
  return String(member.hierarchyPath || '').split('/').includes(root);
}
export function teamScope(id: string, role: string): Record<string, any> {
  const canonical = normalizeTeamRole(role);
  if (!TEAM_ROLES.includes(canonical as any)) throw new Error('Team access is not authorized');
  if (canonical === 'owner') return { isDeleted: { $ne: true }, ...teamPeople };
  const field = scopeFields[canonical];
  const objId = Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : null;
  const idList: any[] = objId ? [id, objId] : [id];
  const own = { _id: { $in: idList } };
  if (!field) return { ...own, isDeleted: { $ne: true } };
  return {
    isDeleted: { $ne: true },
    $and: [teamPeople],
    $or: [
      own,
      { [field]: { $in: idList } },
      { parentId: { $in: idList } },
      { referredBy: { $in: idList } },
      { referrerId: id },
      { parentUserId: id },
      { hierarchyPath: { $regex: `(^|/)${id}(/|$)` } }
    ]
  };
}
export function reportMonth(month?: string) {
  const key = month || new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw new Error('Month must be YYYY-MM');
  const [year, m] = key.split('-').map(Number);
  return { key, from: new Date(Date.UTC(year, m - 1, 1) - 330 * 60000), to: new Date(Date.UTC(year, m, 1) - 330 * 60000) };
}
export function hostChannels(host: any): Channel[] {
  const configured = (host.hostTypes || []).map((t: string) => t.toLowerCase());
  if (configured.length) { const known = CHANNELS.filter(c => configured.includes(c) || (c === 'voice' && configured.includes('audio')) || (c === 'room' && configured.includes('hosting'))); if (known.length) return known; }
  return CHANNELS.filter(c => c === 'room' || (c === 'voice' ? host.canVoiceCall !== false : host.canVideoCall !== false));
}
export function progress(achieved: number, target?: number) {
  if (!Number.isSafeInteger(achieved)) throw new Error('Noninteger Beans record needs reconciliation');
  if (target == null) return { achieved, target: null, pending: null, percent: null };
  if (!Number.isSafeInteger(target) || target < 0) throw new Error('Target must be nonnegative integer Beans');
  return { achieved, target, pending: Math.max(0, target - achieved), percent: target ? Math.max(0, Math.min(100, Number(BigInt(achieved) * 100n / BigInt(target)))) : null };
}
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '0';
    return String(value);
  }
  let text = String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  if (/[",\r\n\t]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

export function tsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '0';
    return String(value);
  }
  let text = String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return text.replace(/[\t\r\n]/g, ' ');
}
