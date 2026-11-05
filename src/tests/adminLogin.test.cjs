const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup(account, verify = async (p, h) => p === 'actual-password' && h === 'stored-hash') {
  const writes = [], logs = [], queries = [];
  class AppError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
  const mocks = {
    '../models/user.model': { User: {
      findOne(query) { queries.push(query); return { select: async () => account }; },
      async findByIdAndUpdate(id, update) { writes.push(update); },
      create() { throw Error('Login must not create accounts'); },
    } },
    '../utils/passwordHelper': { verifySecureHash: verify, generateSecureHash() { throw Error('Login must not reset passwords'); } },
    '../utils/generator': { generateToken: (id, type) => `${type}-${id}` },
    '../utils/reponse': { default: (res, status, success, message, data) => Object.assign(res, { status, success, message, data }), __esModule: true },
    '../utils/errorHandler': { default: AppError, __esModule: true },
    '../utils/logger': { Logger: async () => {} },
    '../utils/accountScope': { PANEL_ACCOUNT_ROLES: ['owner', 'operator', 'admin'] },
    '../models/loginHistory.model': { LoginHistory: { create: async log => logs.push(log) } },
  };
  const filename = path.resolve(__dirname, '../controllers/adminAuthController.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: id => mocks[id] || {}, console,
  });
  return { writes, logs, queries, async login(password, email = '  OPERATOR@EXAMPLE.COM  ') {
    const res = {}, errors = [];
    await module.exports.adminLogin({ body: { email, password }, headers: {}, socket: {} }, res, err => errors.push(err));
    return { res, error: errors[0] };
  } };
}
function account(extra = {}) {
  return { _id: 'operator-id', userId: 42, role: 'operator', password: 'stored-hash',
    toObject() { return { ...this }; }, ...extra };
}

test('correct operator password succeeds repeatedly without changing password', async () => {
  const s = setup(account());
  for (let i = 0; i < 2; i++) {
    const { res, error } = await s.login('actual-password');
    assert.equal(error, undefined);
    assert.equal(res.success, true);
    assert.equal(res.data.user.password, undefined);
  }
  assert.equal(s.queries[0].$or[0].email, 'operator@example.com');
  assert.equal(s.writes.length, 2);
  for (const write of s.writes) assert.deepEqual(Object.keys(write.$set).sort(), ['activeToken', 'lastLogin', 'refreshToken']);
});

test('wrong and former default passwords cannot authenticate or overwrite the hash', async () => {
  for (const password of ['wrong-password', 'OpPass@123', 'Pass@1234', 'Operator@123']) {
    const s = setup(account());
    assert.equal((await s.login(password)).error.statusCode, 401);
    assert.equal(s.writes.length, 0);
    assert.equal(s.logs[0].failureReason, 'Incorrect password');
  }
});

test('unknown account is rejected without provisioning from applications or app users', async () => {
  const s = setup(null);
  assert.equal((await s.login('anything')).error.statusCode, 401);
  assert.equal(s.queries.length, 1);
  assert.equal(s.writes.length, 0);
});

test('blocked account stays blocked and malformed credentials return validation errors', async () => {
  const s = setup(account({ isBlocked: true }));
  assert.equal((await s.login('actual-password')).error.statusCode, 403);
  assert.equal(s.writes.length, 0);
  for (const [email, password] of [[{}, 'password'], [' ', 'password'], ['a@b.com', {}]]) {
    assert.equal((await s.login(password, email)).error.statusCode, 400);
  }
});

test('invalid stored hash fails closed and passwords preserve whitespace', async () => {
  const bad = setup(account(), async () => { throw Error('Malformed hash'); });
  assert.equal((await bad.login('actual-password')).error.statusCode, 401);
  const s = setup(account(), async p => p === ' password ');
  assert.equal((await s.login(' password ')).res.success, true);
  assert.equal((await s.login('password')).error.statusCode, 401);
});
