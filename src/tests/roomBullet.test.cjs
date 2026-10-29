const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function fixture(balance = 2) {
  let wallet = balance, records = [], queue = Promise.resolve(), failRecord = false;
  const query = value => ({ session() { return this; }, select() { return this; }, lean: async () => value() });
  const mocks = {
    '../models/user.model': { User: {
      findById: () => query(() => ({ diamonds: wallet })),
      findOneAndUpdate: (filter, update) => query(() => {
        if (wallet < filter.diamonds.$gte) return null;
        wallet += update.$inc.diamonds;
        return { diamonds: wallet };
      }),
    } },
    '../models/roomBulletCharge.model': { RoomBulletCharge: {
      findOne: filter => query(() => records.find(row => row.senderId === filter.senderId && row.requestId === filter.requestId)),
      create: async rows => { if (failRecord) throw Error('ledger unavailable'); records.push(...rows); },
    } },
    '../economy/service': { atomic: work => {
      const result = queue.then(async () => {
        const before = wallet, oldRecords = [...records];
        try { return await work({}); }
        catch (error) { wallet = before; records = oldRecords; throw error; }
      });
      queue = result.catch(() => {});
      return result;
    } },
  };
  const source = fs.readFileSync(require.resolve('../services/roomBullet.service.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: key => mocks[key] });
  return { send: module.exports.chargeRoomBullet, balance: () => wallet, records: () => records, fail: () => { failRecord = true; } };
}

test('bullet costs exactly one diamond and retry never charges twice', async () => {
  const f = fixture();
  const first = await f.send('user', 'room', 'bullet-123', 'Hello');
  const retry = await f.send('user', 'room', 'bullet-123', 'Hello');
  assert.equal(first.diamonds, 1);
  assert.equal(retry.duplicate, true);
  assert.equal(f.balance(), 1);
  assert.equal(f.records().length, 1);
});
test('concurrent messages cannot overspend the last diamond', async () => {
  const f = fixture(1);
  const results = await Promise.allSettled([
    f.send('user', 'room', 'bullet-123', 'One'),
    f.send('user', 'room', 'bullet-456', 'Two'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.balance(), 0);
  assert.equal(f.records().length, 1);
});
test('ledger failure rolls back the charge', async () => {
  const f = fixture(); f.fail();
  await assert.rejects(f.send('user', 'room', 'bullet-123', 'Hello'), /ledger unavailable/);
  assert.equal(f.balance(), 2);
});
test('insufficient balance and changed retry payload are rejected', async () => {
  await assert.rejects(fixture(0).send('user', 'room', 'bullet-123', 'Hello'), /INSUFFICIENT_DIAMONDS/);
  const f = fixture();
  await f.send('user', 'room', 'bullet-123', 'Hello');
  await assert.rejects(f.send('user', 'other-room', 'bullet-123', 'Changed'), /already used/);
  assert.equal(f.balance(), 1);
});
