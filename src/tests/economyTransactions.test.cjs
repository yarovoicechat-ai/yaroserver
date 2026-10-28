// Executes the real service with a serializable, rollback-capable in-memory adapter.
// This is not a replacement for the separate MongoDB replica-set integration suite.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), ts = require('typescript');
function moduleAt(file, mocks, environment = {}, Clock = Date) {
  const filename = path.resolve(__dirname, '../economy', file), module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, process: { env: environment }, Date: Clock,
    console: { log() {}, warn() {}, error() {} }, structuredClone,
    require: key => Object.hasOwn(mocks, key) ? mocks[key] : (() => { throw new Error('Unexpected dependency ' + key); })() });
  return module.exports;
}
function fixture(Clock = Date) {
  const rules = moduleAt('rules.ts', {});
  let db = { User: [{ _id: 'caller', diamonds: 1000, coins: 777 }, { _id: 'host', diamonds: 0, coins: 123 }, { _id: 'agency', diamonds: 0, coins: 0 }],
    EconomyAccount: [], EconomyJournal: [], EconomyVersion: [], EconomyRollout: [], EconomyHostMonth: [], EconomyHostingMinute: [], EconomyValidation: [], AuditLog: [], GiftTransaction: [], CoinsTransaction: [], HostLevel: [{ level: 1, coinPerMinute: 25 }] };
  let queue = Promise.resolve(), failJournal = false, serial = 0;
  const matches = (doc, query) => Object.entries(query).every(([key, value]) => {
    if (typeof value === 'object' && value !== null) {
      if ('$ne' in value) return doc[key] !== value.$ne;
      if ('$exists' in value) return (doc[key] !== undefined) === value.$exists;
      if ('$gte' in value) return doc[key] >= value.$gte;
    }
    return doc[key] === value;
  });
  const docs = (table, session) => (session?.data || db)[table];
  const query = (table, predicate, multiple) => {
    let session;
    const value = () => {
      const found = docs(table, session).filter(d => matches(d, predicate));
      const decorate = d => {
        if (!d) return null;
        Object.defineProperties(d, { save: { configurable: true, value: async () => d }, toObject: { configurable: true, value: () => structuredClone(d) } });
        return d;
      };
      return multiple ? found.map(decorate) : decorate(found[0]);
    };
    const q = { session(s) { session = s; return q; }, select() { return q; }, sort() { return q; },
      lean() { return Promise.resolve(structuredClone(value())); }, then(resolve, reject) { return Promise.resolve(value()).then(resolve, reject); } };
    return q;
  };
  const models = {};
  for (const table of Object.keys(db)) models[table] = {
    findOne: filter => query(table, filter, false), findById: id => query(table, { _id: id }, false),
    find: filter => query(table, filter, true),
    create: async (input, options = {}) => {
      if (table === 'EconomyJournal' && failJournal) { failJournal = false; throw new Error('Injected ledger failure'); }
      const created = [];
      for (const item of Array.isArray(input) ? input : [input]) {
        const row = { _id: `row${++serial}`, ...structuredClone(item) }, target = docs(table, options.session);
        const unique = table === 'EconomyVersion' ? 'version' : 'key';
        if (row[unique] && target.some(d => d[unique] === row[unique])) throw Object.assign(new Error('duplicate'), { code: 11000 });
        target.push(row); created.push(row);
      }
      return Array.isArray(input) ? created : created[0];
    },
    updateOne: async (filter, update, options = {}) => {
      const target = docs(table, options.session); let row = target.find(d => matches(d, filter));
      if (!row && options.upsert) { row = { _id: `row${++serial}`, ...Object.fromEntries(Object.entries(filter).filter(([, v]) => typeof v !== 'object')) }; target.push(row); }
      if (!row) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(row, update.$set);
      for (const [key, amount] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + amount;
      return { matchedCount: 1, modifiedCount: 1 };
    },
  };
  models.User.findByIdAndUpdate = async (id, update, options) => {
    await models.User.updateOne({ _id: id }, update, options);
    return models.User.findById(id).session(options?.session);
  };
  models.User.findOneAndUpdate = async (filter, update, options) => {
    await models.User.updateOne(filter, update, options);
    return models.User.findOne(filter).session(options?.session);
  };
  const mongoose = { startSession: async () => ({
    startTransaction() { this.data = structuredClone(db); this.active = true; },
    async commitTransaction() { db = this.data; this.active = false; },
    async abortTransaction() { this.active = false; },
    inTransaction() { return this.active; },
    async withTransaction(fn) {
      const previous = queue; let unlock; queue = new Promise(resolve => unlock = resolve); await previous;
      this.data = structuredClone(db);
      try { const result = await fn(); db = this.data; return result; } finally { unlock(); }
    }, endSession: async () => {},
  }) };
  const env = {};
  const service = moduleAt('service.ts', { mongoose, crypto: require('node:crypto'), '../models/user.model': { User: models.User },
    '../models/auditLog.model': { AuditLog: models.AuditLog },
    '../gift/gift.model': { GiftTransaction: models.GiftTransaction },
    '../models/spentCoinModel': { CoinsTransaction: models.CoinsTransaction },
    '../constants/user': { CallStatus: { ENDED: 'ended', CANCELLED: 'cancelled', MISSED: 'missed', REJECTED: 'rejected', EXPIRED: 'expired' } }, './models': models, './rules': rules }, env, Clock);
  const pinned = { version: 'v2', rules: rules.NEW_ECONOMY, digest: service.digest(rules.NEW_ECONOMY) };
  db.EconomyVersion.push({ version: 'v2', rules: structuredClone(pinned.rules), digest: pinned.digest, effectiveAt: new Date(0) });
  const account = key => db.EconomyAccount.find(a => a.key === key)?.balance || 0;
  const statuses = Object.fromEntries(['accepted', 'connecting', 'connected', 'ended', 'missed', 'rejected', 'cancelled', 'expired'].map(s => [s.toUpperCase(), s]));
  const billing = () => moduleAt('../services/billing.service.ts', {
    mongoose, '../economy/service': service, '../economy/rules': rules,
    '../models/spentCoinModel': { CoinsTransaction: models.CoinsTransaction }, '../models/user.model': { User: models.User },
    '../constants/user': { CallStatus: statuses, TransactionType: { VOICE_CALL: 'voice_call' } },
    './chat.service': { getOrCreateConversation: async () => {} }, '../models/hostLevel.model': models.HostLevel,
    './user.service': { recalculateAndUpdateHostLevel: async () => 1 },
    './level.service': { LevelService: { addWealthExp: async () => {}, addCharmExp: async () => {} } },
    '../controllers/settingsController': { getCachedSettings: async () => ({ callRatePerMinute: 100 }) },
    '../sockets': { getIO: () => ({ to: () => ({ emit() {} }) }), getUserRoom: () => '' },
    '../configs/monetization': { CALL_DIAMONDS_PER_MINUTE: 100, HOST_LEVEL_COINS_PER_MINUTE: { 1: 25 } },
    './agora/agoraUsage.service': { AgoraUsageService: { recordSessionEnd: async () => {} } },
    './referralMilestoneService': { evaluateReferralCallMilestone: async () => {} },
  }).BillingService;
  return { service, rules, pinned, account, env, billing, db: () => db, failJournal: () => failJournal = true };
}
test('simulated concurrent minute replay debits 492 units and credits 205 Beans once', async () => {
  const f = fixture(), s = f.service;
  await Promise.all(Array.from({ length: 20 }, () => s.atomic(tx => s.billCallMinute('call', 'caller', 'host', 1, false, f.pinned, tx))));
  assert.equal(f.db().User[0].diamonds, 995.08);
  assert.equal(f.account(s.availableAccount('host', 'v2')), 205);
  assert.equal(f.db().EconomyJournal.length, 1);
  assert.equal(f.db().User[0].coins, 777); assert.equal(f.db().User[1].coins, 123);
});
test('simulated video, concurrent gifts and complete journal conservation', async () => {
  const f = fixture(), s = f.service;
  await s.atomic(tx => s.billCallMinute('video', 'caller', 'host', 1, true, f.pinned, tx));
  assert.equal(f.db().User[0].diamonds, 990.16); assert.equal(f.account(s.availableAccount('host', 'v2')), 410);
  const gift = { key: 'gift', sender: 'caller', receivers: [{ id: 'host', agency: 'agency' }], unitsPerReceiver: 10000, giftId: 'g', roomId: 'r' };
  await Promise.all(Array.from({ length: 20 }, () => s.atomic(tx => s.processRoomGift(gift, f.pinned, tx))));
  assert.equal(f.db().User[0].diamonds, 890.16);
  assert.equal(f.account(s.availableAccount('host', 'v2')), 4910);
  assert.equal(f.account(s.availableAccount('agency', 'v2')), 1000);
  assert.equal(f.account('platform:retained'), 3000);
  assert.equal(f.db().EconomyHostMonth[0].reserveBeans, 1500);
  for (const entry of f.db().EconomyJournal) f.rules.assertBalanced(entry.postings);
  for (const account of f.db().EconomyAccount) {
    const expected = f.db().EconomyJournal.flatMap(j => j.postings).filter(p => p.asset === 'BEAN' && p.account === account.key).reduce((a, p) => a + p.delta, 0);
    assert.equal(account.balance, expected);
  }
});
test('journal failure rolls back wallet debit and every earned balance', async () => {
  const f = fixture(), s = f.service; f.failJournal();
  await assert.rejects(s.atomic(tx => s.billCallMinute('failed', 'caller', 'host', 1, false, f.pinned, tx)), /Injected ledger failure/);
  assert.equal(f.db().User[0].diamonds, 1000); assert.equal(f.db().EconomyAccount.length, 0); assert.equal(f.db().EconomyJournal.length, 0);
});
test('gift compensation is idempotent and historical Beans stay untouched', async () => {
  const f = fixture(), s = f.service;
  await s.atomic(tx => s.processRoomGift({ key: 'gift', sender: 'caller', receivers: [{ id: 'host' }], unitsPerReceiver: 10000, giftId: 'g', roomId: 'r' }, f.pinned, tx));
  await s.reverseOperation('gift:gift', 'owner', 'canceled'); await s.reverseOperation('gift:gift', 'owner', 'retry');
  assert.equal(f.db().User[0].diamonds, 1000); assert.equal(f.account(s.availableAccount('host', 'v2')), 0);
  assert.equal(f.db().EconomyHostMonth[0].giftUnits, 0); assert.equal(f.db().User[1].coins, 123);
});
test('withdrawal consumes only earned Beans at the original version, rejection releases exact hold', async () => {
  const f = fixture(), s = f.service;
  for (let minute = 1; minute <= 80; minute++) await s.atomic(tx => s.billCallMinute('call', 'caller', 'host', minute, false, f.pinned, tx));
  assert.equal(f.account(s.availableAccount('host', 'v2')), 16400);
  const quote = await s.atomic(tx => s.holdWithdrawal('host', 16400, 'request_123', f.pinned, tx));
  assert.equal(quote.grossPaise, 20000); assert.equal(quote.netPaise, 19000);
  await s.atomic(tx => s.settleWithdrawal('host', 'request_123', false, f.pinned, tx));
  await s.atomic(tx => s.settleWithdrawal('host', 'request_123', false, f.pinned, tx));
  assert.equal(f.account(s.availableAccount('host', 'v2')), 16400); assert.equal(f.db().User[1].coins, 123);
});
test('idempotency conflicts, self-gifting and overspending do not mint earnings', async () => {
  const f = fixture(), s = f.service;
  await s.atomic(tx => s.billCallMinute('call', 'caller', 'host', 1, false, f.pinned, tx));
  await assert.rejects(s.atomic(tx => s.billCallMinute('call', 'caller', 'host', 1, true, f.pinned, tx)), /Idempotency key/);
  await assert.rejects(s.atomic(tx => s.processRoomGift({ key: 'self', sender: 'caller', receivers: [{ id: 'caller' }], unitsPerReceiver: 10000, giftId: 'g', roomId: 'r' }, f.pinned, tx)), /Self-gifting/);
  await assert.rejects(s.atomic(tx => s.processRoomGift({ key: 'over', sender: 'caller', receivers: [{ id: 'host' }], unitsPerReceiver: 99999999, giftId: 'g', roomId: 'r' }, f.pinned, tx)), /INSUFFICIENT/);
  assert.equal(f.db().EconomyJournal.length, 1); assert.equal(f.db().User[0].diamonds, 995.08);
});
test('missing rollout defaults to legacy and separate rate versions do not mix earnings', async () => {
  const f = fixture(), s = f.service;
  assert.equal(await s.effectiveEconomy(), null);
  await s.atomic(tx => s.billCallMinute('a', 'caller', 'host', 1, false, f.pinned, tx));
  const nextRules = structuredClone(f.pinned.rules); nextRules.beansPerInr = 90;
  const next = { version: 'v3', digest: s.digest(nextRules), rules: nextRules };
  await s.atomic(tx => s.billCallMinute('b', 'caller', 'host', 1, false, next, tx));
  assert.equal(f.account(s.availableAccount('host', 'v2')), 205); assert.equal(f.account(s.availableAccount('host', 'v3')), 205);
});
test('production cannot be enabled with an owner toggle alone; version tampering fails closed', async () => {
  const f = fixture(); f.env.NODE_ENV = 'production';
  await assert.rejects(f.service.changeRollout('v2', true, 0, 'owner', 'release request'), /Production release evidence/);
  assert.equal(f.db().EconomyRollout.length, 0);
  f.db().EconomyVersion[0].rules.beansPerInr = 2;
  await assert.rejects(f.service.getVersion('v2'), /missing or changed/);
});
test('hosting observations require a full connected minute and reset after gaps or room changes', () => {
  const { HostingObserver } = moduleAt('attendance.ts', { './models': {}, './service': {}, './rules': {} });
  const observer = new HostingObserver();
  const origin = Date.UTC(2026, 8, 1);
  assert.equal(observer.observe(origin, 'room', 'v2', true), null);
  for (let seconds = 15; seconds < 60; seconds += 15) assert.equal(observer.observe(origin + seconds * 1000, 'room', 'v2', true), null);
  assert.equal(observer.observe(origin + 60000, 'room', 'v2', true), origin / 60000);
  assert.equal(observer.observe(origin + 120000, 'room', 'v2', true), null);
  assert.equal(observer.observe(origin + 135000, 'another-room', 'v2', true), null);
  assert.equal(observer.observe(origin + 150000, 'another-room', 'v2', false), null);
  assert.equal(observer.observe(origin + 165000, 'another-room', 'v2', true), null);
});
test('actual call billing adapter pins voice/video rates and finalization does not double-credit hosts', async () => {
  for (const video of [false, true]) {
    const f = fixture(), Billing = f.billing(), now = Date.now();
    f.db().CoinsTransaction.push({ _id: 'call', userId: 'caller', hostId: 'host', status: 'connected',
      callStart: new Date(now - 1000), meta: { economyVersion: 'v2', isVideo: video, callDiamondsPerMinute: 100 } });
    assert.equal((await Billing.processActiveCallBilling('call')).success, true);
    const expectedUnits = video ? 984 : 492, expectedBeans = video ? 410 : 205;
    assert.equal(f.db().User[0].diamonds, (100000 - expectedUnits) / 100);
    assert.equal(f.account(f.service.availableAccount('host', 'v2')), expectedBeans);
    assert.equal((await Billing.processCallEnd('call', new Date(now))).success, true);
    assert.equal((await Billing.processCallEnd('call', new Date(now))).success, true);
    assert.equal(f.account(f.service.availableAccount('host', 'v2')), expectedBeans);
    assert.equal(f.db().User[1].coins, 123);
    assert.equal(f.db().CoinsTransaction[0].hostEarning, expectedBeans);
  }
});
test('actual call adapter preserves legacy 100-Diamond debit and level earning without version metadata', async () => {
  const f = fixture(), Billing = f.billing(), end = new Date();
  f.db().CoinsTransaction.push({ _id: 'old', userId: 'caller', hostId: 'host', status: 'connected',
    callStart: new Date(end.getTime() - 60000), meta: { callDiamondsPerMinute: 100 } });
  const result = await Billing.processCallEnd('old', end);
  assert.equal(result.success, true);
  assert.equal(f.db().User[0].diamonds, 900);
  assert.equal(f.db().User[1].coins, 148);
  assert.equal(f.db().EconomyJournal.length, 0);
});
test('monthly salary settles escrow once, combines full-month thresholds and releases unused reserve', async () => {
  let now = Date.UTC(2026, 8, 15);
  class Clock extends Date { constructor(value) { super(value === undefined ? now : value); } static now() { return now; } }
  const f = fixture(Clock), s = f.service;
  f.db().User[0].diamonds = 100000;
  const next = { version: 'v3', rules: structuredClone(f.pinned.rules), digest: f.pinned.digest };
  f.db().EconomyVersion.push({ version: 'v3', rules: structuredClone(next.rules), digest: next.digest });
  for (const pinned of [f.pinned, next]) await s.atomic(tx => s.processRoomGift({ key: 'salary_' + pinned.version,
    sender: 'caller', receivers: [{ id: 'host' }], unitsPerReceiver: 1500000, giftId: 'g', roomId: 'r' }, pinned, tx));
  for (let day = 1; day <= 15; day++) for (let minute = 0; minute < 120; minute++) {
    f.db().EconomyHostingMinute.push({ hostId: 'host', version: 'v2', minute: Date.UTC(2026, 8, day, 2) / 60000 + minute });
  }
  now = Date.UTC(2026, 9, 1);
  for (const pinned of [f.pinned, next]) {
    const paid = await s.settleSalary('host', '2026-09', pinned, 'owner');
    assert.equal(paid.paidBeans, 45000); assert.equal(paid.bps, 300);
    await s.settleSalary('host', '2026-09', pinned, 'owner');
    assert.equal(f.account(s.availableAccount('host', pinned.version)), 720000);
    assert.equal(f.account(s.salaryAccount('host', '2026-09', pinned.version)), 0);
  }
  await assert.rejects(s.reverseOperation('gift:salary_v2', 'owner', 'late refund'), /Settled salary/);
  for (const entry of f.db().EconomyJournal) f.rules.assertBalanced(entry.postings);
});
