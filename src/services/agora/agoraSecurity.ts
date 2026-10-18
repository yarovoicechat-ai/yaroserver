import crypto from 'crypto';

/**
 * Derives a 32-byte key for AES-256-GCM.
 * Production requires a dedicated AGORA_CREDENTIAL_SECRET (or AGORA_CREDENTIAL_ENCRYPTION_KEY).
 * Silent fallback to JWT_SECRET is strictly forbidden.
 */
const getEncryptionKey = (): Buffer => {
  const secret =
    process.env.AGORA_CREDENTIAL_SECRET ||
    process.env.AGORA_CREDENTIAL_ENCRYPTION_KEY;

  if (secret && secret.trim()) {
    return crypto.createHash('sha256').update(secret.trim()).digest();
  }

  // In production, strictly enforce dedicated AGORA_CREDENTIAL_SECRET
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'FATAL: Production Agora credential encryption requires a dedicated AGORA_CREDENTIAL_SECRET environment variable. Silent fallback to JWT_SECRET is prohibited for security compliance.'
    );
  }

  // Non-production development fallback: allow ENCRYPTION_SECRET_KEY, but never JWT_ACCESS_SECRET or hardcoded secret
  const devFallback = process.env.ENCRYPTION_SECRET_KEY || process.env.VERIFICATION_ENCRYPTION_KEY;
  if (!devFallback || !devFallback.trim()) {
    throw new Error(
      'Agora credential encryption key missing. Please define AGORA_CREDENTIAL_SECRET in your environment configuration.'
    );
  }

  return crypto.createHash('sha256').update(devFallback.trim()).digest();
};

/**
 * Encrypts an Agora App Certificate using AES-256-GCM.
 * Formatted as: iv.tag.ciphertext (all base64).
 */
export const encryptAgoraSecret = (plain: string): string => {
  if (!plain || !plain.trim()) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain.trim(), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
};

/**
 * Decrypts an Agora App Certificate from its AES-256-GCM payload.
 */
export const decryptAgoraSecret = (payload: string): string => {
  if (!payload || !payload.trim()) return '';
  const parts = payload.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted Agora secret format');
  }
  const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};

/**
 * Masks a secret string (e.g. certificate or token) for safe UI display.
 */
export const maskSecret = (secret: string, showFirst = 4, showLast = 4): string => {
  if (!secret) return '';
  const trimmed = secret.trim();
  if (trimmed.length <= showFirst + showLast) return '••••••••';
  return `${trimmed.slice(0, showFirst)}${'•'.repeat(16)}${trimmed.slice(-showLast)}`;
};

/**
 * Deeply redacts any sensitive keys (certificates, tokens, passwords) from objects before logging or returning to clients.
 */
export const redactSensitive = <T>(obj: T): T => {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitive(item)) as unknown as T;
  }

  const SENSITIVE_KEYS = new Set([
    'appcertificate',
    'appcertificateencrypted',
    'certificate',
    'secret',
    'password',
    'token',
    'callertoken',
    'hosttoken',
    'agoratoken',
  ]);

  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      result[key] = val ? '••••••••' : '';
    } else if (typeof val === 'object' && val !== null) {
      result[key] = redactSensitive(val);
    } else {
      result[key] = val;
    }
  }
  return result as T;
};

/**
 * Asserts the Agora security configuration is safe and derives a valid 256-bit key.
 * In production mode, throws an exception if AGORA_CREDENTIAL_SECRET is absent or invalid.
 * Never prints or leaks secret values.
 */
export const assertAgoraSecurityConfig = (): { valid: boolean; keyLengthBits: number } => {
  const key = getEncryptionKey();
  if (!key || key.length !== 32) {
    throw new Error('FATAL: Agora credential encryption key length is invalid (must be 256 bits).');
  }
  return { valid: true, keyLengthBits: key.length * 8 };
};
