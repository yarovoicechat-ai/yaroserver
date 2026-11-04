export const APP_ACCOUNT_ROLES = ['user', 'host', 'USER', 'HOST'] as const;

export const PANEL_ACCOUNT_ROLES = [
  'owner',
  'operator',
  'OPERATOR',
  'countryManager',
  'country-manager',
  'stateManager',
  'state-manager',
  'bdLeader',
  'bd-leader',
  'bdleader',
  'bd',
  'superAdmin',
  'super-admin',
  'superadmin',
  'admin',
  'ADMIN',
  'agency',
  'coinSeller',
  'seller',
  'coinseller',
  'customerSupport',
  'customer-service',
  'customersupport',
  'support',
] as const;

export const isAppRole = (role: string): boolean => {
  const r = (role || '').toLowerCase().replace(/[-_\s]/g, '');
  return r === 'user' || r === 'host';
};

export const isPanelRole = (role: string): boolean => {
  return !isAppRole(role);
};

export const getAccountRoleScope = (role: string): string[] =>
  isAppRole(role)
    ? [...APP_ACCOUNT_ROLES]
    : [...PANEL_ACCOUNT_ROLES];
