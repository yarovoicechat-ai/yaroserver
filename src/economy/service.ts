import mongoose, { ClientSession } from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import { User } from '../models/user.model';
import { AuditLog } from '../models/auditLog.model';
import { GiftTransaction } from '../gift/gift.model';
import { CoinsTransaction } from '../models/spentCoinModel';
import { CallStatus } from '../constants/user';
import { EconomyAccount, EconomyHostingMinute, EconomyHostMonth, EconomyJournal, EconomyRollout, EconomyValidation, EconomyVersion } from './models';
import { assertBalanced, calendarKeys, diamondDisplay, diamondUnits, EconomyRules, giftAllocation, integer, mul, Posting, ratio, salaryQuote, sum, validateRules, withdrawalQuote } from './rules';

export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const databaseFingerprint = () => digest({ host: mongoose.connection.host, database: mongoose.connection.name });
export const availableAccount = (id: string, version: string) => `user:${id}:earned:${version}`;
export const salaryAccount = (host: string, month: string, version: string) => `salary:${host}:${month}:${version}`;
export interface PinnedEconomy { version: string; digest: string; rules: EconomyRules }
export async function getVersion(version: string, session?: ClientSession): Promise<PinnedEconomy> {
  if (typeof version !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(version)) throw new Error('Explicit valid economy version required');
  const doc = await EconomyVersion.findOne({ version }).session(session || null).lean();
  if (!doc || digest(doc.rules) !== doc.digest) throw new Error('Economy version missing or changed');
  return { version, digest: doc.digest, rules: validateRules(doc.rules) };
}
export async function effectiveEconomy(now = new Date()): Promise<PinnedEconomy | null> {
  const rollout = await EconomyRollout.findOne({ key: 'economy' }).lean();
  if (!rollout?.enabled) return null;
  if (process.env.ENABLE_TEST_DIAMONDS === 'true') throw new Error('Disable synthetic Diamond top-ups before using economy V2');
  if (typeof rollout.version !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(rollout.version)) throw new Error('Enabled economy has no valid version');
  const doc = await EconomyVersion.findOne({ version: rollout.version }).lean();
  if (!doc || !Number.isFinite(new Date(doc.effectiveAt).getTime())) throw new Error('Enabled economy version/effective date is invalid');
  if (doc.effectiveAt > now) return null;
  // A database toggle alone can never authorize a production release.
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.ECONOMY_V2_RELEASE_DECISION || process.env.ECONOMY_V2_RELEASE_DECISION !== rollout.releaseDecision ||
      process.env.ECONOMY_V2_PRODUCTION_VERSION !== rollout.version) throw new Error('Economy release decision is not installed');
  } else if (process.env.ECONOMY_V2_STAGING !== 'true') throw new Error('Economy V2 staging flag is not enabled');
  return getVersion(rollout.version);
}
export async function atomic<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const session = await mongoose.startSession();
    try {
      let result!: T;
      await session.withTransaction(async () => { result = await work(session); }, {
        readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' },
      });
      return result;
    } catch (error: any) {
      if (error.code !== 11000 || attempt >= 2) throw error;
    } finally { await session.endSession(); }
  }
}
/** Legacy purchased Diamonds stay spendable; no parallel balance is minted. */
async function debitDiamonds(id: string, units: number, session: ClientSession) {
  integer(units);
  const user = await User.findById(id).select('diamonds isDeleted isBlocked').session(session).lean();
  if (!user || user.isDeleted || user.isBlocked) throw new Error('Wallet user unavailable');
  const before = diamondUnits(user.diamonds ?? 0);
  if (before < units) throw new Error('INSUFFICIENT_DIAMONDS');
  const after = before - units;
  // Set a canonical display value, never accumulate fractional floating-point increments.
  const updated = await User.updateOne({ _id: id, diamonds: user.diamonds }, { $set: { diamonds: diamondDisplay(after) } }, { session });
  if (updated.modifiedCount !== 1 && units !== 0) throw new Error('Wallet conflict');
  return { beforeUnits: before, afterUnits: after };
}
async function creditDiamonds(id: string, units: number, session: ClientSession) {
  const user = await User.findById(id).select('diamonds').session(session).lean();
  if (!user) throw new Error('Wallet not found');
  const before = diamondUnits(user.diamonds ?? 0), after = sum(before, units);
  const result = await User.updateOne({ _id: id, diamonds: user.diamonds }, { $set: { diamonds: after / 100 } }, { session });
  if (result.modifiedCount !== 1 && units !== 0) throw new Error('Wallet conflict');
}
async function postBeans(postings: Posting[], session: ClientSession) {
  const deltas = new Map<string, bigint>();
  for (const p of postings.filter(p => p.asset === 'BEAN')) deltas.set(p.account, (deltas.get(p.account) || 0n) + BigInt(p.delta));
  // Stable ordering reduces conflicts for transfers involving the same accounts.
  for (const [key, delta] of [...deltas.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const account = await EconomyAccount.findOne({ key }).session(session);
    const before = BigInt(account?.balance ?? 0), after = before + delta;
    if (after > BigInt(Number.MAX_SAFE_INTEGER) || after < BigInt(-Number.MAX_SAFE_INTEGER)) throw new Error('Account overflow');
    if (!key.startsWith('platform:') && after < 0n) throw new Error('Insufficient earned Beans or reserved funds');
    if (account) {
      const update = await EconomyAccount.updateOne({ _id: account._id, balance: Number(before) }, { $set: { balance: Number(after) } }, { session });
      if (update.matchedCount !== 1) throw new Error('Account conflict');
    } else await EconomyAccount.create([{ key, asset: 'BEAN', balance: Number(after) }], { session });
  }
}
async function replay(key: string, fingerprint: string, session: ClientSession) {
  const existing = await EconomyJournal.findOne({ key }).session(session).lean();
  if (existing && existing.fingerprint !== fingerprint) throw new Error('Idempotency key reused with different operation');
  return existing;
}
async function journal(key: string, fingerprint: string, kind: string, pinned: PinnedEconomy, actor: string,
  postings: Posting[], metadata: any, result: any, session: ClientSession) {
  assertBalanced(postings);
  await postBeans(postings, session);
  const [doc] = await EconomyJournal.create([{ key, fingerprint, kind, version: pinned.version, actor, postings,
    metadata: { ...metadata, rulesDigest: pinned.digest }, result }], { session });
  return doc;
}
export async function billCallMinute(callId: string, caller: string, host: string, minute: number, video: boolean,
  pinned: PinnedEconomy, session: ClientSession) {
  if (caller === host) throw new Error('Self-calling cannot generate withdrawable Beans');
  integer(minute); if (!minute) throw new Error('Billable minute must start at one');
  const key = `call:${callId}:${minute}`, fingerprint = digest({ callId, caller, host, minute, video, version: pinned.version });
  const old = await replay(key, fingerprint, session); if (old) return old.result;
  if (!await User.findById(host).select('_id').session(session).lean()) throw new Error('Call host wallet record is missing');
  const rate = video ? pinned.rules.video : pinned.rules.voice;
  const referenceBeans = ratio(rate.referencePaisePerMinute, pinned.rules.beansPerInr, 100);
  const balance = await debitDiamonds(caller, rate.diamondUnitsPerMinute, session);
  const result = { diamondUnits: rate.diamondUnitsPerMinute, hostBeans: rate.hostBeansPerMinute, ...balance };
  await journal(key, fingerprint, 'CALL_MINUTE', pinned, caller, [
    { account: `user:${caller}`, asset: 'DIAMOND_UNIT', delta: -rate.diamondUnitsPerMinute },
    { account: 'platform:call', asset: 'DIAMOND_UNIT', delta: rate.diamondUnitsPerMinute },
    { account: 'platform:callReference', asset: 'BEAN', delta: -referenceBeans },
    { account: availableAccount(host, pinned.version), asset: 'BEAN', delta: rate.hostBeansPerMinute },
    { account: 'platform:callRetained', asset: 'BEAN', delta: referenceBeans - rate.hostBeansPerMinute },
  ], { callId, host, minute, video, referencePaise: rate.referencePaisePerMinute, referenceBeans }, result, session);
  return result;
}
export async function processRoomGift(input: { key: string; sender: string; receivers: Array<{ id: string; agency?: string; agencyBps?: number }>;
  unitsPerReceiver: number; giftId: string; roomId: string }, pinned: PinnedEconomy, session: ClientSession) {
  const fingerprint = digest({ ...input, version: pinned.version });
  const key = `gift:${input.key}`;
  const old = await replay(key, fingerprint, session); if (old) return { ...old.result, replay: true };
  if (!input.receivers.length || input.receivers.length > 100 || new Set(input.receivers.map(r => r.id)).size !== input.receivers.length) throw new Error('Invalid gift recipients');
  const totalUnits = mul(integer(input.unitsPerReceiver), input.receivers.length);
  const balance = await debitDiamonds(input.sender, totalUnits, session);
  const now = new Date(), { month } = calendarKeys(now, pinned.rules);
  const postings: Posting[] = [
    { account: `user:${input.sender}`, asset: 'DIAMOND_UNIT', delta: -totalUnits },
    { account: 'platform:gifts', asset: 'DIAMOND_UNIT', delta: totalUnits },
  ];
  const allocations = [];
  for (const receiver of input.receivers) {
    if (receiver.id === input.sender) throw new Error('Self-gifting cannot generate withdrawable Beans');
    const allocation = giftAllocation(input.unitsPerReceiver, pinned.rules, receiver.agency ? receiver.agencyBps ?? pinned.rules.gift.agencyMaxBps : 0);
    allocations.push({ host: receiver.id, ...allocation });
    const monthKey = `${receiver.id}:${month}:${pinned.version}`;
    const existing = await EconomyHostMonth.findOne({ key: monthKey }).session(session);
    if (existing?.settled) throw new Error('Gift accounting month is already closed');
    const giftUnits = sum(existing?.giftUnits || 0, input.unitsPerReceiver);
    const reserveBeans = sum(existing?.reserveBeans || 0, allocation.salaryReserve);
    await EconomyHostMonth.updateOne({ key: monthKey, settled: { $ne: true } }, { $set: {
      hostId: receiver.id, month, version: pinned.version, giftUnits, reserveBeans,
    } }, { upsert: true, session });
    postings.push(
      { account: 'platform:giftReference', asset: 'BEAN', delta: -allocation.baseBeans },
      { account: availableAccount(receiver.id, pinned.version), asset: 'BEAN', delta: allocation.instant },
      { account: salaryAccount(receiver.id, month, pinned.version), asset: 'BEAN', delta: allocation.salaryReserve },
      { account: 'platform:retained', asset: 'BEAN', delta: allocation.platform },
    );
    if (receiver.agency) postings.push({ account: availableAccount(receiver.agency, pinned.version), asset: 'BEAN', delta: allocation.agency });
  }
  const result = { ...balance, totalUnits, allocations, month };
  await journal(key, fingerprint, 'ROOM_GIFT', pinned, input.sender, postings, { ...input, month }, result, session);
  return result;
}
export async function holdWithdrawal(user: string, beans: number, requestId: string, pinned: PinnedEconomy, session: ClientSession) {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) throw new Error('Withdrawal requestId required');
  const key = `withdrawal:${user}:${requestId}`, fingerprint = digest({ user, beans, version: pinned.version });
  const old = await replay(key, fingerprint, session); if (old) return { ...old.result, replay: true };
  const quote = withdrawalQuote(beans, pinned.rules);
  if (quote.grossPaise < pinned.rules.withdrawal.minimumPaise || quote.netPaise <= 0) throw new Error('Withdrawal below minimum');
  await journal(key, fingerprint, 'WITHDRAWAL_HOLD', pinned, user, [
    { account: availableAccount(user, pinned.version), asset: 'BEAN', delta: -quote.beansToHold },
    { account: `hold:${user}:${requestId}:${pinned.version}`, asset: 'BEAN', delta: quote.beansToHold },
  ], { user, requestId }, quote, session);
  return quote;
}
export async function settleWithdrawal(user: string, requestId: string, approved: boolean, pinned: PinnedEconomy, session: ClientSession) {
  const hold = await EconomyJournal.findOne({ key: `withdrawal:${user}:${requestId}` }).session(session);
  if (!hold || hold.reversedBy) throw new Error('Withdrawal hold unavailable');
  const key = `withdrawal-close:${user}:${requestId}`, fingerprint = digest({ user, requestId, approved });
  const old = await replay(key, fingerprint, session); if (old) return;
  await journal(key, fingerprint, 'WITHDRAWAL_CLOSE', pinned, user, [
    { account: `hold:${user}:${requestId}:${pinned.version}`, asset: 'BEAN', delta: -hold.result.beansToHold },
    { account: approved ? 'platform:paidWithdrawals' : availableAccount(user, pinned.version), asset: 'BEAN', delta: hold.result.beansToHold },
  ], { user, requestId, approved, quote: hold.result }, { approved }, session);
}
export async function settleSalary(host: string, month: string, pinned: PinnedEconomy, actor = host) {
  if (!/^\d{4}-\d{2}$/.test(month) || month >= calendarKeys(new Date(), pinned.rules).month) throw new Error('Only closed months can settle');
  return atomic(async session => {
    const key = `salary:${host}:${month}:${pinned.version}`, fingerprint = digest({ host, month, version: pinned.version });
    const old = await replay(key, fingerprint, session); if (old) return old.result;
    const bucket = await EconomyHostMonth.findOne({ key: `${host}:${month}:${pinned.version}` }).session(session);
    if (!bucket || bucket.settled) throw new Error('Salary bucket missing or already closed');
    const evidence = await EconomyHostingMinute.find({ hostId: host }).session(session).lean();
    const days: Record<string, number> = {};
    for (const item of evidence) {
      const date = calendarKeys(new Date(item.minute * 60000), pinned.rules);
      if (date.month === month) days[date.day] = (days[date.day] || 0) + 1;
    }
    const monthlyBuckets = await EconomyHostMonth.find({ hostId: host, month }).session(session).lean();
    const monthlyUnits = monthlyBuckets.reduce((total: number, b: any) => sum(total, b.giftUnits), 0);
    const eligibility = salaryQuote(monthlyUnits, days, pinned.rules);
    const quote = { ...eligibility, beans: ratio(ratio(bucket.giftUnits, pinned.rules.giftBeansPerDiamond, 100), eligibility.bps, 10000) };
    const payout = Math.min(quote.beans, bucket.reserveBeans);
    await journal(key, fingerprint, 'MONTHLY_SALARY', pinned, actor, [
      { account: salaryAccount(host, month, pinned.version), asset: 'BEAN', delta: -bucket.reserveBeans },
      { account: availableAccount(host, pinned.version), asset: 'BEAN', delta: payout },
      { account: 'platform:retained', asset: 'BEAN', delta: bucket.reserveBeans - payout },
    ], { host, month, dailyMinutes: days }, { ...quote, paidBeans: payout, releasedBeans: bucket.reserveBeans - payout }, session);
    bucket.settled = true; await bucket.save({ session });
    return { ...quote, paidBeans: payout };
  });
}
/** Compensation is explicit, keeps the original journal, and refuses spent payouts. */
export async function reverseOperation(key: string, actor: string, reason: string) {
  if (typeof key !== 'string' || key.length > 200 || typeof reason !== 'string' || !reason.trim() || reason.length > 2000) throw new Error('Valid journal key and reversal reason required');
  return atomic(async session => {
    const original = await EconomyJournal.findOne({ key }).session(session);
    if (!original || !['CALL_MINUTE', 'ROOM_GIFT'].includes(original.kind)) throw new Error('Operation cannot be reversed here');
    if (original.reversedBy) return { key: original.reversedBy, replay: true };
    const pinned = await getVersion(original.version, session);
    if (original.kind === 'CALL_MINUTE') {
      const call = await CoinsTransaction.findById(original.metadata.callId).session(session);
      if (!call || ![CallStatus.ENDED, CallStatus.CANCELLED, CallStatus.MISSED, CallStatus.REJECTED, CallStatus.EXPIRED].includes(call.status)) throw new Error('End the call before posting a compensation');
    }
    if (original.kind === 'ROOM_GIFT') {
      for (const receiver of original.metadata.receivers) {
        const bucket = await EconomyHostMonth.findOne({ key: `${receiver.id}:${original.metadata.month}:${original.version}` }).session(session);
        if (!bucket || bucket.settled) throw new Error('Settled salary requires a separate reconciliation decision');
        const allocation = original.result.allocations.find((a: any) => a.host === receiver.id);
        bucket.giftUnits -= original.metadata.unitsPerReceiver;
        bucket.reserveBeans -= allocation.salaryReserve;
        await bucket.save({ session });
      }
    }
    const postings = original.postings.map((p: Posting) => ({ ...p, delta: -p.delta }));
    const refund = postings.find((p: Posting) => p.asset === 'DIAMOND_UNIT' && p.account === `user:${original.actor}`);
    if (refund) await creditDiamonds(original.actor, refund.delta, session);
    const reversalKey = `reverse:${key}`;
    await journal(reversalKey, digest({ key }), 'REVERSAL', pinned, actor, postings, { key, reason }, { reversed: key }, session);
    if (original.kind === 'ROOM_GIFT') await GiftTransaction.updateOne({ requestId: original.metadata.key,
      'meta.economyVersion': original.version }, { $set: { status: 'REFUNDED', 'meta.compensationKey': reversalKey } }, { session });
    original.reversedBy = reversalKey; await original.save({ session });
    return { key: reversalKey };
  });
}
export async function createVersion(input: { version: string; rules: EconomyRules; effectiveAt: string; reason: string }, actor: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(input.version) || !input.reason?.trim()) throw new Error('Version and reason required');
  const rules = JSON.parse(JSON.stringify(validateRules(input.rules)));
  const effectiveAt = new Date(input.effectiveAt);
  if (!Number.isFinite(effectiveAt.getTime()) || effectiveAt <= new Date()) throw new Error('New versions require a future effective date');
  return atomic(async session => {
    const [doc] = await EconomyVersion.create([{ ...input, effectiveAt, rules, digest: digest(rules), createdBy: actor }], { session });
    await AuditLog.create([{ adminId: actor, action: 'ECONOMY_VERSION_CREATE', target: input.version, details: input.reason, newValue: doc.toObject() }], { session });
    return doc;
  });
}
export async function changeRollout(version: string, enabled: boolean, revision: number, actor: string, reason: string, releaseDecision = '') {
  if (!reason.trim()) throw new Error('Release/rollback reason required');
  integer(revision);
  if (enabled) {
    if (process.env.ENABLE_TEST_DIAMONDS === 'true') throw new Error('Disable synthetic Diamond top-ups before enabling economy V2');
    const pinned = await getVersion(version);
    if (process.env.NODE_ENV === 'production') {
      const evidence = await EconomyValidation.findOne({ version, kind: 'PRODUCTION_RELEASE', digest: releaseDecision }).lean();
      const report = evidence?.report;
      const age = report ? Date.now() - new Date(report.generatedAt).getTime() : NaN;
      if (!report?.approved || report.rulesDigest !== pinned.digest || digest(report) !== releaseDecision ||
        report.databaseFingerprint !== databaseFingerprint() || !Number.isFinite(age) || age < 0 || age > 86400000 ||
        !report.walletSnapshotDigest || report.historicalLedgerVerified !== true || report.stagingIntegrationPassed !== true ||
        report.concurrencyPassed !== true || report.refundsAndSettlementsPassed !== true ||
        report.legacyCompatibilityPassed !== true ||
        report.accountMismatches !== 0 || report.unbalancedJournals !== 0 || report.invalidWallets !== 0 || report.v2LedgerReconciles !== true ||
        process.env.ECONOMY_V2_RELEASE_DECISION !== releaseDecision ||
        process.env.ECONOMY_V2_PRODUCTION_VERSION !== version) throw new Error('Production release evidence and explicit deployment decision required');
    } else if (process.env.ECONOMY_V2_STAGING !== 'true') throw new Error('Staging rollout requires ECONOMY_V2_STAGING=true');
  }
  return atomic(async session => {
    const previous = await EconomyRollout.findOne({ key: 'economy' }).session(session);
    if ((previous?.revision || 0) !== revision) throw new Error('Rollout revision conflict; reload settings');
    const doc = await EconomyRollout.findOneAndUpdate({ key: 'economy', revision: previous ? revision : { $exists: false } },
      { $set: { enabled, version, reason, releaseDecision, changedBy: actor }, $inc: { revision: 1 } }, { upsert: !previous, new: true, session });
    if (!doc) throw new Error('Rollout conflict');
    await AuditLog.create([{ adminId: actor, action: enabled ? 'ECONOMY_ENABLE' : 'ECONOMY_ROLLBACK', target: version,
      details: reason, oldValue: previous?.toObject(), newValue: doc.toObject() }], { session });
    return doc;
  });
}
export const reportId = () => randomUUID();
