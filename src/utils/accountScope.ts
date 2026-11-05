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
  return PANEL_ACCOUNT_ROLES.includes(role as any);
};

// Role changes within a scope (user -> host, operator -> admin) keep one identity.
// A second scope receives its own userId, password and login sessions.
export const ACCOUNT_IDENTITY_INDEXES = (['email', 'phoneNumber'] as const).flatMap(field =>
  ([['app', APP_ACCOUNT_ROLES], ['panel', PANEL_ACCOUNT_ROLES]] as const).map(([scope, roles]) => ({
    key: { [field]: 1 } as Record<string, 1>,
    options: {
      name: `${field}_${scope}_unique`,
      unique: true,
      partialFilterExpression: { [field]: { $type: 'string', $gt: '' }, role: { $in: [...roles] } },
    },
  }))
);

export const getAccountRoleScope = (role: string): string[] =>
  isAppRole(role)
    ? [...APP_ACCOUNT_ROLES]
    : [...PANEL_ACCOUNT_ROLES];
