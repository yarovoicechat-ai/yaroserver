const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: id => mocks[id] || {}, console, process: { env: {} } });
  return module.exports;
}
const scope = load('utils/accountScope.ts');
const send = { __esModule: true, default: (res, status, success, message, data) => Object.assign(res, { status, success, message, data }) };
function fixture() {
  const panel = { _id: 'panel', userId: 101, email: 'same@example.com', phoneNumber: '+919876543210', role: 'operator',
    password: 'panel-hash', activeToken: 'panel-session', googleId: undefined,
    async save() { throw Error('App auth must not save the panel identity'); } };
  const docs = [panel], queries = [];
  function matches(doc, q) {
    return Object.entries(q).every(([key, value]) => {
      if (key === '$or') return value.some(c => matches(doc, c));
      if (key === '$and') return value.every(c => matches(doc, c));
      if (value && typeof value === 'object') {
        if ('$in' in value) return value.$in.includes(doc[key]);
        if ('$exists' in value) return (doc[key] !== undefined) === value.$exists;
      }
      return doc[key] === value;
    });
  }
  class User {
    constructor(data) { Object.assign(this, { role: 'user', isDeleted: false }, data); }
    async save() { if (!docs.includes(this)) docs.push(this); return this; }
    static findOne(q) {
      queries.push(q);
      const result = docs.find(d => matches(d, q)) || null;
      return { sort() { return this; }, select() { return this; }, then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
    }
  }
  const auth = load('controllers/authController.ts', {
    '../models/user.model': { User }, '../utils/accountScope': scope, '../utils/reponse': send,
    '../utils/generator': { generateUniqueId: async () => 202, generateToken: (id, kind) => `${kind}-${id}` },
    '../utils/googleIdToken': { verifyGoogleIdToken: async () => ({ getPayload: () => ({ email: panel.email, name: 'Test User', sub: 'google-subject', email_verified: true }) }), GoogleIdTokenVerificationError: class extends Error {} },
    '../utils/firebasePhoneVerification': { verifyFirebasePhoneToken: async () => ({ success: true }) },
    '../utils/passwordHelper': { generateSecureHash: async () => 'app-hash', verifySecureHash: async (p, h) => p === 'app-password' && h === 'app-hash' },
    '../services/namePolicy.service': { getNamePolicy: async () => ({}), getDefaultNameForPolicy: n => n, validateNameAgainstPolicy: () => null },
    '../services/deviceLimitService': { checkAndLockDeviceRegistration: async () => ({ allowed: true }) },
    '../utils/logger': { Logger: async () => {} }, '../constants/user': { UserRole: { USER: 'user' }, Gender: {}, AuthType: {} },
  });
  return { panel, docs, queries, auth };
}

test('Google app signup creates a separate account and repeated login leaves panel role/password/session untouched', async () => {
  const f = fixture();
  const req = { body: { googleIdToken: 'verified-token', userFrom: 'app', deviceId: 'device', gender: 'female', age: 25, language: ['en', 'hi'], country: { name: 'India' } } };
  for (let i = 0; i < 2; i++) {
    const res = {};
    await f.auth.userGoogleAuth(req, res);
    assert.equal(res.success, true);
    assert.equal(res.data.role, 'user');
    assert.equal(res.data.accessToken, 'access-202');
  }
  assert.equal(f.docs.length, 2);
  assert.equal(f.panel.role, 'operator');
  assert.equal(f.panel.password, 'panel-hash');
  assert.equal(f.panel.activeToken, 'panel-session');
  assert.equal(f.panel.googleId, undefined);
});

test('incomplete Google app signup cannot return a session for a matching panel email', async () => {
  const f = fixture(), res = {};
  await f.auth.userGoogleAuth({ body: { googleIdToken: 'token' } }, res);
  assert.equal(res.status, 428);
  assert.equal(f.docs.length, 1);
  assert.equal(f.panel.activeToken, 'panel-session');
});

test('phone app signup allows the panel phone once and rejects the second app account', async () => {
  const f = fixture();
  const req = { body: { phoneNumber: f.panel.phoneNumber, password: 'app-password', gender: 'male', age: 25,
    firebaseIdToken: 'verified', name: 'Test User', userFrom: 'app', deviceId: 'device' } };
  const first = {}, second = {};
  await f.auth.userRegister(req, first);
  await f.auth.userRegister(req, second);
  assert.equal(first.status, 201);
  assert.equal(second.status, 400);
  assert.equal(f.docs.length, 2);
  assert.equal(f.panel.role, 'operator');
});

test('identity constraints cover one app and one panel across all roles, ignoring missing identifiers', () => {
  assert.equal(scope.ACCOUNT_IDENTITY_INDEXES.length, 4);
  for (const index of scope.ACCOUNT_IDENTITY_INDEXES) {
    const field = Object.keys(index.key)[0];
    assert.equal(index.options.unique, true);
    assert.equal(index.options.partialFilterExpression[field].$gt, '');
    const roles = index.options.partialFilterExpression.role.$in;
    if (index.options.name.includes('_app_')) {
      assert.ok(roles.includes('user') && roles.includes('host'));
      assert.ok(!roles.includes('operator'));
    } else {
      assert.ok(roles.includes('operator') && roles.includes('admin') && roles.includes('agency'));
      assert.ok(!roles.includes('user') && !roles.includes('host'));
    }
  }
});

test('a legacy panel token cannot turn an operator into a host through host status', async () => {
  const panel = { _id: 'panel', userId: 101, role: 'operator', email: 'same@example.com' };
  const host = load('controllers/hostController.ts', {
    '../models/user.model': { User: { findById: async () => panel } },
    '../utils/accountScope': scope, '../utils/reponse': send,
    '../utils/logger': { Logger: async () => {} },
  });
  const res = {};
  await host.getMyHostStatus({ user: { id: 'panel' } }, res);
  assert.equal(res.status, 403);
  assert.equal(panel.role, 'operator');
});
