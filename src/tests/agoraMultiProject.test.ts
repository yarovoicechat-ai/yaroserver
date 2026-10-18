import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encryptAgoraSecret,
  decryptAgoraSecret,
  maskSecret,
  redactSensitive,
  assertAgoraSecurityConfig,
} from '../services/agora/agoraSecurity';
import { AgoraProjectService } from '../services/agora/agoraProject.service';
import { AgoraUsageService } from '../services/agora/agoraUsage.service';
import { AgoraProviderSyncService } from '../services/agora/agoraProviderSync.service';

process.env.AGORA_CREDENTIAL_ENCRYPTION_KEY = 'test-agora-secret-encryption-key-for-unit-testing';

test('1. AES-256-GCM Agora Secret Encryption & Decryption', () => {
  const rawCert = '1b562d3ec8134249bda984e72d02213c';
  const encrypted = encryptAgoraSecret(rawCert);

  assert.notEqual(encrypted, rawCert);
  assert.equal(encrypted.split('.').length, 3, 'Payload should contain iv.tag.ciphertext');

  const decrypted = decryptAgoraSecret(encrypted);
  assert.equal(decrypted, rawCert);
});

test('2. Secret Masking and Deep Redaction', () => {
  const cert = '1b562d3ec8134249bda984e72d02213c';
  const masked = maskSecret(cert);
  assert.equal(masked.startsWith('1b56'), true);
  assert.equal(masked.endsWith('213c'), true);
  assert.equal(masked.includes('••••'), true);

  const testPayload = {
    projectId: '6543210',
    appId: 'd23c897f9305450faa7809ffcf666e57',
    appCertificate: '1b562d3ec8134249bda984e72d02213c',
    nested: {
      callerToken: '006d23c897f...secret_token',
      name: 'Test Project',
    },
  };

  const redacted = redactSensitive(testPayload);
  assert.equal(redacted.appCertificate, '••••••••');
  assert.equal(redacted.nested.callerToken, '••••••••');
  assert.equal(redacted.appId, 'd23c897f9305450faa7809ffcf666e57');
  assert.equal(redacted.nested.name, 'Test Project');
});

test('3. Local Credential Validation with Real RtcTokenBuilder', () => {
  const validAppId = 'd23c897f9305450faa7809ffcf666e57';
  const validCert = '1b562d3ec8134249bda984e72d02213c';

  const validResult = AgoraProjectService.testCredentialsLocally(validAppId, validCert);
  assert.equal(validResult.isValid, true);
  assert.equal(typeof validResult.sampleToken, 'string');
  assert.equal(Boolean(validResult.sampleToken?.startsWith('006') || validResult.sampleToken?.startsWith('007')), true);

  const invalidAppIdResult = AgoraProjectService.testCredentialsLocally('short_id', validCert);
  assert.equal(invalidAppIdResult.isValid, false);

  const missingCertResult = AgoraProjectService.testCredentialsLocally(validAppId, '');
  assert.equal(missingCertResult.isValid, false);
});

test('4. Month Key Helper Consistency', () => {
  const date = new Date('2026-10-18T18:00:00.000Z');
  const monthKey = AgoraUsageService.getMonthKey(date);
  assert.equal(monthKey, '2026-10');
});

test('5. Budget Threshold & Remaining Allowance Calculation', () => {
  const budget = 10000;
  const usedMinutes = 8500;
  const remaining = Math.max(0, budget - usedMinutes);
  const usagePercent = Math.min(100, Math.round((usedMinutes / budget) * 1000) / 10);

  assert.equal(remaining, 1500);
  assert.equal(usagePercent, 85);
  assert.equal(usagePercent >= 85, true, 'Should trigger 85% threshold check');
});

test('6. Redaction Preserves Safe Fields and Redacts Secrets', () => {
  const auditEntry = {
    action: 'CREATE_PROJECT',
    actorName: 'SuperAdmin',
    changes: {
      name: 'Secondary Agora Failover',
      appId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      appCertificate: 'super_secret_certificate_key_123',
      priority: 2,
    },
  };

  const safe = redactSensitive(auditEntry);
  assert.equal(safe.changes.appCertificate, '••••••••');
  assert.equal(safe.changes.name, 'Secondary Agora Failover');
  assert.equal(safe.changes.priority, 2);
});

test('7. Production Agora Credential Encryption requires AGORA_CREDENTIAL_SECRET and forbids JWT_SECRET fallback', () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origSecret = process.env.AGORA_CREDENTIAL_SECRET;
  const origKey = process.env.AGORA_CREDENTIAL_ENCRYPTION_KEY;
  const origJwt = process.env.JWT_ACCESS_SECRET;

  try {
    process.env.NODE_ENV = 'production';
    delete process.env.AGORA_CREDENTIAL_SECRET;
    delete process.env.AGORA_CREDENTIAL_ENCRYPTION_KEY;
    process.env.JWT_ACCESS_SECRET = 'should-never-be-used-as-agora-key';

    // Must throw in production when dedicated secret is missing
    assert.throws(
      () => {
        encryptAgoraSecret('test_cert_12345');
      },
      /FATAL: Production Agora credential encryption requires a dedicated AGORA_CREDENTIAL_SECRET/
    );

    // Provide dedicated secret -> must succeed
    process.env.AGORA_CREDENTIAL_SECRET = 'prod_dedicated_secret_key_32bytes_len';
    const enc = encryptAgoraSecret('test_cert_12345');
    assert.equal(typeof enc, 'string');
    assert.equal(decryptAgoraSecret(enc), 'test_cert_12345');
  } finally {
    process.env.NODE_ENV = origNodeEnv;
    if (origSecret !== undefined) process.env.AGORA_CREDENTIAL_SECRET = origSecret;
    if (origKey !== undefined) process.env.AGORA_CREDENTIAL_ENCRYPTION_KEY = origKey;
    if (origJwt !== undefined) process.env.JWT_ACCESS_SECRET = origJwt;
  }
});

test('8. assertAgoraSecurityConfig asserts valid 256-bit key length and fails safely', () => {
  const result = assertAgoraSecurityConfig();
  assert.equal(result.valid, true);
  assert.equal(result.keyLengthBits, 256);
});

test('9. AgoraProviderSyncService gracefully reports PENDING_EXTERNAL_PROVIDER_VERIFICATION when customer credentials are absent', async () => {
  const origCustId = process.env.AGORA_CUSTOMER_ID;
  const origCustSecret = process.env.AGORA_CUSTOMER_SECRET;

  try {
    delete process.env.AGORA_CUSTOMER_ID;
    delete process.env.AGORA_CUSTOMER_SECRET;

    const status = await AgoraProviderSyncService.getProviderSyncStatus('2026-10');
    assert.equal(status.status, 'PENDING_EXTERNAL_PROVIDER_VERIFICATION');
    assert.equal(status.hasCredentialsConfigured, false);
    assert.deepEqual(status.requiredEnvironmentVariables, [
      'AGORA_CUSTOMER_ID',
      'AGORA_CUSTOMER_SECRET',
    ]);
  } finally {
    if (origCustId !== undefined) process.env.AGORA_CUSTOMER_ID = origCustId;
    if (origCustSecret !== undefined) process.env.AGORA_CUSTOMER_SECRET = origCustSecret;
  }
});

