import { test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { User } from '../models/user.model';
import { EconomyAccount, EconomyHostMonth, EconomyJournal, EconomyVersion } from '../economy/models';
import { NEW_ECONOMY } from '../economy/rules';
import { atomic, availableAccount, billCallMinute, digest, holdWithdrawal, processRoomGift, reverseOperation, settleWithdrawal } from '../economy/service';

const uri = process.env.ECONOMY_TEST_URI;
test('replica-set integration: concurrent calls/gifts, rollback, replay, withdrawals and legacy preservation', { skip: !uri && 'Set ECONOMY_TEST_URI to an isolated local yaro_economy_test replica set' }, async () => {
  const parsed = new URL(uri!);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.pathname !== '/yaro_economy_test') throw new Error('Integration tests refuse nonlocal/non-test databases');
  await mongoose.connect(uri!);
  const version = `test_${Date.now()}`, sender = new mongoose.Types.ObjectId(), host = new mongoose.Types.ObjectId(), agency = new mongoose.Types.ObjectId();
  const fixtureRules = { ...NEW_ECONOMY, withdrawal: { ...NEW_ECONOMY.withdrawal, minimumPaise: 100 } };
  const pinned = { version, digest: digest(fixtureRules), rules: fixtureRules };
  try {
    await Promise.all([EconomyVersion.init(), EconomyAccount.init(), EconomyJournal.init(), EconomyHostMonth.init()]);
    await EconomyVersion.create({ version, effectiveAt: new Date(0), rules: fixtureRules, digest: pinned.digest, createdBy: sender, reason: 'isolated integration fixture' });
    await User.collection.insertMany([
      { _id: sender, userId: Date.now(), diamonds: 1000, coins: 777 },
      { _id: host, userId: Date.now() + 1, diamonds: 0, coins: 123 },
      { _id: agency, userId: Date.now() + 2, diamonds: 0, coins: 0 },
    ]);
    const call = `test_${version}`;
    await Promise.all(Array.from({ length: 8 }, () => atomic(s => billCallMinute(call, String(sender), String(host), 1, false, pinned, s))));
    assert.equal((await User.findById(sender).lean())!.diamonds, 995.08);
    assert.equal((await EconomyAccount.findOne({ key: availableAccount(String(host), version) }).lean())!.balance, 205);
    await atomic(s => billCallMinute(call + '_video', String(sender), String(host), 1, true, pinned, s));
    const gift = { key: `test_${version}_gift`, sender: String(sender), receivers: [{ id: String(host), agency: String(agency) }], unitsPerReceiver: 10000, giftId: 'fixture', roomId: 'fixture' };
    await Promise.all(Array.from({ length: 8 }, () => atomic(s => processRoomGift(gift, pinned, s))));
    assert.equal((await User.findById(sender).lean())!.diamonds, 885.24);
    assert.equal((await User.findById(host).lean())!.coins, 123);
    assert.equal((await User.findById(sender).lean())!.coins, 777);
    assert.equal((await EconomyAccount.findOne({ key: availableAccount(String(host), version) }).lean())!.balance, 5115);
    await assert.rejects(atomic(async s => { await billCallMinute(call + '_abort', String(sender), String(host), 1, false, pinned, s); throw new Error('forced abort'); }));
    assert.equal((await User.findById(sender).lean())!.diamonds, 885.24);
    await reverseOperation(`gift:${gift.key}`, String(sender), 'integration cancellation');
    await reverseOperation(`gift:${gift.key}`, String(sender), 'integration duplicate');
    assert.equal((await User.findById(sender).lean())!.diamonds, 985.24);
    const all = await EconomyJournal.find({ version }).lean();
    for (const j of all) {
      const totals = j.postings.reduce((a: Record<string, number>, p: any) => { a[p.asset] = (a[p.asset] || 0) + p.delta; return a; }, {});
      for (const amount of Object.values(totals)) assert.equal(amount, 0);
    }
    const wd = 'test_withdrawal';
    const quote = await atomic(s => holdWithdrawal(String(host), 82, wd, pinned, s));
    assert.equal(quote.grossPaise, 100);
    await atomic(s => settleWithdrawal(String(host), wd, false, pinned, s));
    assert.equal((await EconomyAccount.findOne({ key: availableAccount(String(host), version) }).lean())!.balance, 615);
    await assert.rejects(atomic(s => holdWithdrawal(String(host), 1000000, 'test_insufficient', pinned, s)));
  } finally {
    // Remove only fixture effects, including their net changes to shared platform accounts.
    // Deleting journals alone would leave unreconciled platform balances in the test database.
    await atomic(async session => {
      const entries = await EconomyJournal.find({ version }).session(session).lean();
      const deltas = new Map<string, number>();
      for (const entry of entries) for (const p of entry.postings) if (p.asset === 'BEAN') deltas.set(p.account, (deltas.get(p.account) || 0) + p.delta);
      for (const [key, delta] of deltas) await EconomyAccount.updateOne({ key }, { $inc: { balance: -delta } }, { session });
    });
    await EconomyJournal.deleteMany({ version }); await EconomyHostMonth.deleteMany({ version });
    await EconomyAccount.deleteMany({ key: { $regex: version } }); await EconomyVersion.deleteMany({ version });
    await User.deleteMany({ _id: { $in: [sender, host, agency] } });
    await mongoose.disconnect();
  }
});
