const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const bcrypt = require('bcryptjs');

function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: id => mocks[id] || (id.startsWith('.') ? {} : require(id)),
    console,
    process: { env: {} },
  });
  return module.exports;
}

const send = {
  __esModule: true,
  default: (res, status, success, message, data) => Object.assign(res, { statusCode: status, success, message, data }),
};

function setup() {
  const users = [];

  class UserMock {
    constructor(data) {
      Object.assign(this, data);
    }
    async save() {
      if (!users.includes(this)) users.push(this);
      return this;
    }
    toObject() {
      return { ...this };
    }
    static findOne(query) {
      const found = users.find(u => {
        if (query.$or) {
          return query.$or.some(q => {
            if (q.phoneNumber instanceof RegExp) return q.phoneNumber.test(u.phoneNumber);
            if (q.phoneNumber) return u.phoneNumber === q.phoneNumber;
            return false;
          });
        }
        if (query.userId !== undefined) return u.userId === query.userId;
        if (query.email !== undefined) return u.email === query.email;
        return false;
      });
      return {
        select() { return this; },
        lean() { return Promise.resolve(found || null); },
        then(resolve, reject) { return Promise.resolve(found || null).then(resolve, reject); },
      };
    }
  }

  const adminAuth = load('controllers/adminAuthController.ts', {
    '../models/user.model': { User: UserMock },
    '../models/request.model': { Request: {} },
    '../models/RechargeHistory': { RechargeHistory: {} },
    '../utils/reponse': send,
    '../utils/logger': { Logger: async () => {} },
    '../utils/errorHandler': class extends Error {},
    '../utils/generator': {
      generateUniqueId: async () => 100055,
      generateToken: (id, kind) => `${kind}-${id}`,
    },
    '../utils/passwordHelper': {
      generateSecureHash: async (p) => bcrypt.hash(p, 4),
      verifySecureHash: async (p, h) => bcrypt.compare(p, h),
    },
    '../utils/accountScope': {
      getAccountRoleScope: () => ['user', 'host'],
      PANEL_ACCOUNT_ROLES: ['admin', 'superAdmin', 'owner', 'operator'],
      APP_ACCOUNT_ROLES: ['user', 'host', 'USER', 'HOST'],
    },
    '../constants/user': {
      UserRole: { USER: 'user' },
      AuthType: { PHONE: 'phone' },
      Gender: { MALE: 'male', FEMALE: 'female', OTHER: 'other' },
      RechargeType: {},
    },
    '../utils/applicantPassword': { generateApplicantPassword: () => 'pass' },
    '../utils/hiringScope': { deriveHiringScope: () => ({}), validateManagerDocuments: () => {} },
    '../utils/hierarchyScope': { HierarchyScopeService: {} },
  });

  return { adminAuth, users, UserMock };
}

test('createMockUser rejects non-admin users', async () => {
  const { adminAuth } = setup();
  const req = { user: { role: 'user', id: 'u1' }, body: {} };
  const res = {};
  await adminAuth.createMockUser(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.success, false);
});

test('createMockUser requires name, phone, and password', async () => {
  const { adminAuth } = setup();
  const req = { user: { role: 'admin', id: 'a1' }, body: { name: '', phoneNumber: '', password: '' } };
  const res = {};
  await adminAuth.createMockUser(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.success, false);
});

test('createMockUser creates user that can be authenticated with plain password', async () => {
  const { adminAuth, users } = setup();
  const req = {
    user: { role: 'admin', id: 'a1' },
    body: {
      name: 'Test Player',
      phoneNumber: '9876543210',
      password: 'mypassword123',
      gender: 'male',
      coins: 15000,
      diamonds: 500,
    },
  };
  const res = {};
  await adminAuth.createMockUser(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.success, true);
  assert.equal(res.data.name, 'Test Player');
  assert.equal(res.data.phoneNumber, '+919876543210');
  assert.equal(res.data.userId, 100055);
  assert.equal(res.data.coins, 15000);
  assert.equal(res.data.diamonds, 500);
  assert.equal(res.data.phoneVerified, true);
  assert.equal(res.data.profileCompleted, true);
  assert.equal(res.data.isFake, true);

  // Verify mobile app login password check matches stored hash
  const savedUser = users[0];
  assert.ok(savedUser);
  const isMatch = await bcrypt.compare('mypassword123', savedUser.password);
  assert.equal(isMatch, true, 'Plain password must verify against stored password hash');
});

test('createMockUser rejects duplicate phone number', async () => {
  const { adminAuth } = setup();
  const req1 = {
    user: { role: 'superAdmin', id: 'sa1' },
    body: {
      name: 'User One',
      phoneNumber: '+919876543210',
      password: 'password123',
    },
  };
  await adminAuth.createMockUser(req1, {});

  // Try creating another user with the same last 10 digits
  const req2 = {
    user: { role: 'superAdmin', id: 'sa1' },
    body: {
      name: 'User Two',
      phoneNumber: '9876543210',
      password: 'password123',
    },
  };
  const res2 = {};
  await adminAuth.createMockUser(req2, res2);

  assert.equal(res2.statusCode, 409);
  assert.equal(res2.success, false);
  assert.match(res2.message, /already in use/);
});
