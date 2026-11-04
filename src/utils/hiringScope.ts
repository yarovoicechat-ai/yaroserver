export interface HiringScope { country?: string; state?: string }
const token = (value: any): string => String(typeof value === 'object' ? value?.name || '' : value || '').trim().normalize('NFKC').toLowerCase();
export const isManager = (role: string) => ['countrymanager', 'statemanager'].includes(String(role).replace(/[ _-]/g, '').toLowerCase());
export function deriveHiringScope(sponsor: any, targetRole: string, location: any): HiringScope {
  const role = String(targetRole).replace(/[ _-]/g, '').toLowerCase();
  const country = token(location.country);
  const state = token(location.state);
  const sponsorRole = String(sponsor?.role || '').replace(/[ _-]/g, '').toLowerCase();
  const inherited = ['owner', 'operator'].includes(sponsorRole) ? {} : sponsor?.hiringScope || {};
  if (isManager(sponsorRole) && !['superadmin', 'admin', 'bdleader', 'bd', 'agency', 'host', 'customersupport', 'customerservice'].includes(role)) throw new Error('Managers can hire only Super Admin, Admin, BD Leader, BD, Agency, Host and Customer Support.');
  if (isManager(sponsorRole) && !inherited.country) throw new Error('Manager has no assigned hiring territory. Contact Owner or Operator.');
  if (inherited.country && (!country || token(inherited.country) !== country)) throw new Error('Hiring is restricted to the assigned country.');
  if (inherited.state && (!state || token(inherited.state) !== state)) throw new Error('Hiring is restricted to the assigned state.');
  if (isManager(role)) {
    if (!['owner', 'operator'].includes(sponsorRole)) throw new Error('Only Owner or Operator can hire Country / State Managers.');
    if (!country || (role === 'statemanager' && !state)) throw new Error('Assigned country and, for State Manager, state are required.');
    return { country, ...(role === 'statemanager' ? { state } : {}) };
  }
  return { ...(inherited.country ? { country: token(inherited.country) } : {}), ...(inherited.state ? { state: token(inherited.state) } : {}) };
}
export function validateManagerDocuments(role: string, documents: any[]) {
  if (!isManager(role)) return;
  const has = (type: string) => documents.some(d => d && token(d.documentType).replace(/[ _-]/g, '') === type && typeof d.url === 'string' && (d.url.startsWith('https://') || d.url.startsWith('data:')));
  if (!has('resume') || !has('selfiewithidcard')) throw new Error('Resume and selfie with ID card are mandatory for managers.');
}
