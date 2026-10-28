const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function load(relative, mocks) {
  const filename = path.resolve(__dirname, '..', relative);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: id => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      throw new Error('Unexpected dependency ' + id);
    },
    console: { log() {}, warn() {}, error() {} }, process: { env: {}, cwd: () => path.resolve(__dirname, '../..') }, __dirname: path.dirname(filename), Buffer, Date,
  });
  return module.exports;
}
function response() {
  return { statusCode: 200, status(n) { this.statusCode = n; return this; },
    json(data) { this.data = data; return this; }, send(data) { this.data = data; return this; } };
}
const send = (res, n, success, message, data) => res.status(n).json({ success, message, data });

test('seller routes preserve eight operations and enforce existing roles', () => {
  const middleware = [], routes = [];
  const router = { use: f => middleware.push(f) };
  for (const method of ['get', 'post']) router[method] = (url, handler) => routes.push({ method, url, handler });
  const names = ['verifyUserForSeller', 'rechargeUserBySeller', 'getSellerDashboard', 'getSellerHistory',
    'getSellerLedger', 'requestStockBySeller', 'getSellerStockRequests', 'getSellerConfig'];
  load('routes/sellerRoutes.ts', {
    express: { Router: () => router },
    '../middlewares/authorize.middleware': { verifyToken() {} },
    '../utils/reponse': send,
    '../controllers/sellerController': Object.fromEntries(names.map(name => [name, () => {}])),
  });
  assert.equal(routes.length, 8);
  assert.deepEqual(routes.map(r => r.url), ['/config', '/users/:userId', '/recharge', '/dashboard', '/history', '/ledger', '/stock/request', '/stock/requests']);
  for (const role of [undefined, 'user', 'host', 'agency', 'operator']) {
    let allowed = false;
    const res = response();
    middleware[1]({ user: role ? { role } : undefined }, res, () => allowed = true);
    assert.equal(allowed, false);
    assert.equal(res.statusCode, 403);
  }
  for (const role of ['coinSeller', 'admin', 'superAdmin', 'owner']) {
    let allowed = false;
    middleware[1]({ user: { role } }, response(), () => allowed = true);
    assert.equal(allowed, true);
  }
});

test('public package DTO excludes private configuration without database reads', () => {
  const api = load('controllers/coinPriceController.ts', {
    '../constants/googlePlayProducts': {
      GOOGLE_PLAY_PRODUCT_IDS: ['public'],
      GOOGLE_PLAY_PRODUCTS: { public: { diamonds: 72, offlineRate: 82, sellerPayment: 'private' } },
    },
    '../utils/logger': { Logger() {} },
    '../models/coinsPrice.model': { PricePlan: new Proxy({}, { get() { throw new Error('Private DB read'); } }) },
    '../utils/reponse': send,
    '../constants/user': { UserRole: {} },
  });
  const res = response();
  api.getPublicPricePlans({ query: { type: 'offline', all: 'true' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(res.data.data.plans)), [
    { productId: 'public', diamonds: 72, type: 'google_play', billingProvider: 'google_play' },
  ]);
});

function paymentFixture(existing, state = 'PURCHASED', account = '42') {
  let record = existing && { userId: 42, productId: 'diamonds_72', diamonds: 72, ...existing };
  let balance = 0, providerCalls = 0;
  const publisher = { purchases: {
    productsv2: { getproductpurchasev2: async () => {
      providerCalls++;
      return { data: { purchaseStateContext: { purchaseState: state },
        productLineItem: [{ productId: 'diamonds_72' }], obfuscatedExternalAccountId: account } };
    } },
    products: { consume: async () => ({}) },
    voidedpurchases: { list: async () => ({ data: { voidedPurchases: [{ purchaseToken: 'token' }] } }) },
  } };
  const session = { startTransaction() {}, inTransaction: () => true, abortTransaction: async () => {},
    commitTransaction: async () => {}, endSession: async () => {}, withTransaction: async fn => fn() };
  const history = {
    findOne: () => Object.assign(Promise.resolve(record), { session: async () => record }),
    findOneAndUpdate: async (filter, update) => {
      if (filter.status && record?.status !== filter.status) {
        if (filter.status === 'COMPLETED') return null;
      }
      record = { ...record, ...(update.$set || update) };
      return { _id: 'history', ...record };
    },
  };
  const api = load('controllers/paymentController.ts', {
    '../utils/reponse': send,
    '../models/user.model': { User: {
      findOne: async () => ({ diamonds: balance }),
      findOneAndUpdate: async (_filter, update) => { balance += update.$inc.diamonds; return { diamonds: balance }; },
    } },
    '../models/RechargeHistory': { RechargeHistory: history },
    '../models/GooglePlayRTDN': { GooglePlayRTDN: {} },
    '../constants/user': { RechargeType: { GOOGLE_PLAY: 'google_play' } },
    '../utils/logger': { Logger() {} },
    googleapis: { google: { auth: { GoogleAuth: class {} }, androidpublisher: () => publisher } },
    path, fs: { existsSync: () => false },
    mongoose: { startSession: async () => session },
    '../constants/googlePlayProducts': {
      getProductConfig: id => id === 'diamonds_72' ? { diamonds: 72, priceInr: 100 } : null,
      GOOGLE_PLAY_PRODUCTS: {},
    },
  });
  return { api, balance: () => balance, providerCalls: () => providerCalls,
    verify: async (userId = 42) => {
      const res = response();
      await api.verifyGooglePurchase({ user: { userId }, body: { purchaseToken: 'token', productId: 'diamonds_72' } }, res);
      return res;
    } };
}

test('completed purchase replay never credits twice', async () => {
  const f = paymentFixture({ status: 'COMPLETED' });
  const res = await f.verify();
  assert.equal(res.data.status, 'ALREADY_PROCESSED');
  assert.equal(f.balance(), 0);
  assert.equal(f.providerCalls(), 0);
});
test('other account and refunded token replay are rejected', async () => {
  const other = paymentFixture({ status: 'COMPLETED', userId: 99 });
  assert.equal((await other.verify()).statusCode, 403);
  const refunded = paymentFixture({ status: 'REFUNDED' });
  assert.equal((await refunded.verify()).statusCode, 400);
  assert.equal(refunded.balance(), 0);
});
test('explicit pending and canceled provider states cannot credit Diamonds', async () => {
  for (const state of ['PENDING', 'CANCELLED']) {
    const f = paymentFixture(null, state);
    const res = await f.verify();
    assert.equal(res.data.success, false);
    assert.equal(f.balance(), 0);
  }
});
test('provider account binding is validated before wallet credit', async () => {
  const f = paymentFixture(null, 'PURCHASED', '99');
  assert.equal((await f.verify()).statusCode, 403);
  assert.equal(f.balance(), 0);
});
test('new verified purchase credits server entitlement once', async () => {
  const f = paymentFixture(null);
  assert.equal((await f.verify()).data.status, 'COMPLETED');
  assert.equal(f.balance(), 72);
  assert.equal((await f.verify()).data.status, 'ALREADY_PROCESSED');
  assert.equal(f.balance(), 72);
});
test('refund synchronization reverses credit once and blocks replay', async () => {
  const f = paymentFixture({ status: 'COMPLETED' });
  await f.api.syncVoidedPurchases();
  await f.api.syncVoidedPurchases();
  assert.equal(f.balance(), -72);
  assert.equal((await f.verify()).statusCode, 400);
  assert.equal(f.balance(), -72);
});
