import { Settings } from '../models/settings.model';

export interface NamePolicy {
  blockedNames: string[];
  allowedNames: string[];
  enforceAllowedNames: boolean;
}

const normalizeName = (value: unknown): string => String(value || '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[\p{P}\p{S}\s_]+/gu, '');

export const getNamePolicy = async (): Promise<NamePolicy> => {
  const settings = await Settings.findOne().select('blockedNames allowedNames enforceAllowedNames').lean();
  return {
    blockedNames: Array.isArray(settings?.blockedNames) ? settings.blockedNames : [],
    allowedNames: Array.isArray(settings?.allowedNames) ? settings.allowedNames : [],
    enforceAllowedNames: Boolean(settings?.enforceAllowedNames),
  };
};

export const validateNameAgainstPolicy = (
  value: unknown,
  policy: NamePolicy,
  applyAllowedNameList = true,
): string | null => {
  const normalized = normalizeName(value);
  if (!normalized) return 'Name cannot be empty';

  const blocked = policy.blockedNames
    .map(normalizeName)
    .filter(Boolean)
    .find((entry) => normalized.includes(entry));
  if (blocked) return 'This name is restricted. Please choose another name.';

  if (applyAllowedNameList && policy.enforceAllowedNames) {
    const allowed = new Set(policy.allowedNames.map(normalizeName).filter(Boolean));
    if (!allowed.has(normalized)) return 'This name is not on the approved name list.';
  }

  return null;
};

export const getDefaultNameForPolicy = (fallback: string, policy: NamePolicy): string => {
  if (policy.enforceAllowedNames) {
    const validNames = policy.allowedNames
      .map((name) => String(name || '').trim())
      .filter((name) => Boolean(name) && !validateNameAgainstPolicy(name, policy));
    if (!validNames.length) return '';
    return validNames[Math.floor(Math.random() * validNames.length)];
  }
  return validateNameAgainstPolicy(fallback, policy) ? '' : fallback;
};
