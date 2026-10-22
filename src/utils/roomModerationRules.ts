const PROTECTED_TEAM_ROLES = new Set(['owner', 'operator', 'superadmin', 'admin', 'customersupport']);
const PROTECTED_ROOM_POWERS = [
  'isGlobalRoomManager',
  'canBanRoom',
  'canBanUser',
  'canGhostEntry',
  'canKickAnyUser',
  'canMuteAnyUser',
  'canLockAnySeat',
] as const;

export const isProtectedTeamAccount = (account: any): boolean => {
  const role = String(account?.role || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (PROTECTED_TEAM_ROLES.has(role) || account?.isGlobalRoomManager) return true;
  return PROTECTED_ROOM_POWERS.some((power) => Boolean(account?.officialPowers?.[power]));
};
