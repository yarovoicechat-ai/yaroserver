const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const mod = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    module: mod, exports: mod.exports, console: { log() {}, warn() {}, error() {} },
    require: name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  return mod.exports;
}
const settlement = load('utils/giftSettlement.ts');

test('gift earnings are 45% Beans, rounded down, with no amount lost', () => {
  for (const amount of [0, 1, 2, 3, 99, 100, 1000, Number.MAX_SAFE_INTEGER]) {
    const result = settlement.giftSettlement(amount);
    assert.equal(result.receiverBeans, Number(BigInt(amount) * 45n / 100n));
    assert.equal(result.receiverBeans + result.platformCoins, amount);
  }
  for (const amount of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => settlement.giftSettlement(amount));
  }
});

function fixture(senderCoins = 1000) {
  const sender = { _id: 'a'.repeat(24), userId: 1, diamonds: senderCoins, coins: 333, name: 'Sender' };
  const receiver = { _id: 'b'.repeat(24), userId: 2, diamonds: 12, coins: 5, name: 'Receiver' };
  const gift = { _id: 'c'.repeat(24), name: 'Gift', price: 100, isActive: true };
  let transaction;
  const broadcasts = [];
  const q = value => ({ select() { return this; }, populate() { return this; }, lean: async () => value });
  const users = new Map([[sender._id, sender], [receiver._id, receiver]]);
  const { GiftService } = load('gift/gift.service.ts', {
    '../economy/service': { effectiveEconomy: async () => null },
    '../economy/giftAdapter': {}, mongoose: { Types: { ObjectId: { isValid: id => /^[a-f0-9]{24}$/.test(id) } } },
    '../services/roomPk.service': { capturePKGift: async () => ({}), notifyPKGift: async () => {} },
    './gift.model': {
      Gift: { findById: async () => gift }, GiftCategory: {},
      GiftTransaction: { findOne: () => q(transaction), create: async data => (transaction = { ...data, _id: 'tx' }) },
    },
    '../models/user.model': { User: {
      findById: id => q(users.get(String(id))),
      findOneAndUpdate: async (filter, update) => {
        const user = users.get(String(filter._id));
        if (!user || user.diamonds < filter.diamonds.$gte) return null;
        for (const [key, delta] of Object.entries(update.$inc)) user[key] += delta;
        return user;
      },
      findByIdAndUpdate: (id, update) => {
        const user = users.get(String(id));
        for (const [key, delta] of Object.entries(update.$inc)) user[key] += delta;
        return q(user);
      },
    } },
    '../models/spentCoinModel': { CoinsTransaction: { create: async () => ({}) } },
    '../constants/user': { TransactionType: {} }, '../utils/giftSettlement': settlement,
    './gift.socket': { broadcastGiftSuccess: payload => broadcasts.push(payload) },
    '../services/level.service': { LevelService: { addWealthExp: async () => {}, addCharmExp: async () => {} } },
    '../services/roomTask.service': {}, '../services/roomContribution.service': {},
    './gift.eligibility': { canSendVipGift: () => true },
  });
  const dto = { requestId: 'gift-request', giftId: gift._id, receiverId: receiver._id, quantity: 1 };
  return { sender, receiver, broadcasts, send: () => GiftService.sendGift(sender._id, dto) };
}

test('real gift engine debits sender Coins and credits only receiver Beans once', async () => {
  const f = fixture();
  const first = await f.send();
  assert.equal(f.sender.diamonds, 900);
  assert.equal(f.sender.coins, 333);
  assert.equal(f.receiver.diamonds, 12);
  assert.equal(f.receiver.coins, 50);
  assert.equal(first.transaction.commissionPercent, 55);
  assert.equal(first.transaction.hostEarning, 45);
  assert.equal(first.data.receiverBalances[0].diamonds, 12);
  assert.equal(first.data.receiverBalances[0].coins, 50);
  const replay = await f.send();
  assert.equal(replay.isReplay, true);
  assert.equal(f.sender.diamonds, 900);
  assert.equal(f.receiver.coins, 50);
  assert.equal(f.broadcasts.length, 1);
});

test('earned Beans cannot fund a gift when purchased Coins are insufficient', async () => {
  const f = fixture(0);
  await assert.rejects(f.send(), /Insufficient Diamonds/);
  assert.equal(f.sender.coins, 333);
  assert.equal(f.receiver.coins, 5);
  assert.equal(f.receiver.diamonds, 12);
  assert.equal(f.broadcasts.length, 0);
});

test('legacy direct/call gift route also spends only Coins and pays 45% Beans', async () => {
  for (const balance of [1000, 0]) {
    const sender = { _id: 'a'.repeat(24), userId: 1, diamonds: balance, coins: 333 };
    const receiver = { _id: 'b'.repeat(24), userId: 2, diamonds: 12, coins: 5 };
    const users = new Map([[sender._id, sender], [receiver._id, receiver]]);
    const q = value => ({ session() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
    const session = { startTransaction() {}, abortTransaction: async () => {}, commitTransaction: async () => {}, endSession() {} };
    const { sendGift } = load('controllers/giftController.ts', {
      '../models/gift.model': { Gift: { findById: () => q({ _id: 'gift', cost: 100, isActive: true }) } },
      '../models/user.model': { User: {
        findById: id => q(users.get(String(id))),
        findOneAndUpdate: async (filter, update) => {
          const user = users.get(String(filter._id));
          if (user.diamonds < filter.diamonds.$gte) return null;
          for (const [key, delta] of Object.entries(update.$inc)) user[key] += delta;
          return user;
        },
        findByIdAndUpdate: async (id, update) => {
          const user = users.get(String(id));
          for (const [key, delta] of Object.entries(update.$inc)) user[key] += delta;
          return user;
        },
      } },
      '../utils/reponse': (res, status, success, message, data) => Object.assign(res, { status, success, message, data }),
      '../models/spentCoinModel': { CoinsTransaction: { create: async () => ({}) } },
      '../constants/user': { TransactionType: {}, CallStatus: { ENDED: 'ended' } },
      mongoose: { Types: { ObjectId: { isValid: () => true } }, startSession: async () => session },
      '../sockets': { getIO: () => ({ to: () => ({ emit() {} }) }) },
      '../utils/giftSettlement': settlement,
    });
    const res = {};
    await sendGift({ user: { id: sender._id }, body: { giftId: 'gift', receiverId: receiver._id, count: 1 } }, res);
    assert.equal(res.status, balance ? 200 : 400);
    assert.equal(sender.diamonds, balance ? 900 : 0);
    assert.equal(sender.coins, 333);
    assert.equal(receiver.diamonds, 12);
    assert.equal(receiver.coins, balance ? 50 : 5);
  }
});
