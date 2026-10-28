import { User } from '../models/user.model';
import { Withdrawal } from '../models/withdrawal.model';
import { RechargeHistory } from '../models/RechargeHistory';
import { CoinsTransaction } from '../models/spentCoinModel';
import { GiftTransaction } from '../gift/gift.model';
import { EconomyAccount, EconomyJournal } from './models';
import { assertBalanced, diamondUnits } from './rules';
import { atomic, databaseFingerprint, digest, getVersion } from './service';

/** Read-only snapshot. Historical uncertainty is reported, never filled with invented opening entries. */
export async function reconciliationReport() {
  return atomic(async session => {
    let users = 0, invalidWallets = 0, diamondTotal = 0n, legacyBeans = 0n;
    for await (const user of User.find({}).select('diamonds coins').session(session).lean().cursor()) {
      users++;
      try { diamondTotal += BigInt(diamondUnits(user.diamonds ?? 0)); } catch { invalidWallets++; }
      if (Number.isSafeInteger(user.coins ?? 0) && (user.coins ?? 0) >= 0) legacyBeans += BigInt(user.coins ?? 0);
      else invalidWallets++;
    }
    const reconstructed = new Map<string, bigint>();
    let journals = 0, unbalancedJournals = 0;
    for await (const entry of EconomyJournal.find({}).session(session).lean().cursor()) {
      journals++;
      try { assertBalanced(entry.postings); } catch { unbalancedJournals++; }
      for (const p of entry.postings) if (p.asset === 'BEAN') reconstructed.set(p.account, (reconstructed.get(p.account) || 0n) + BigInt(p.delta));
    }
    let accountMismatches = 0, earnedBeans = 0n, reserves = 0n, withdrawalHolds = 0n;
    const liabilities = new Map<string, bigint>();
    for await (const account of EconomyAccount.find({}).session(session).lean().cursor()) {
      const expected = reconstructed.get(account.key) || 0n;
      if (BigInt(account.balance) !== expected) accountMismatches++;
      reconstructed.delete(account.key);
      if (account.key.startsWith('user:')) earnedBeans += BigInt(account.balance);
      if (account.key.startsWith('salary:')) reserves += BigInt(account.balance);
      if (account.key.startsWith('hold:')) withdrawalHolds += BigInt(account.balance);
      if (['user:', 'salary:', 'hold:'].some(prefix => account.key.startsWith(prefix))) {
        const version = account.key.split(':').slice(-1)[0];
        liabilities.set(version, (liabilities.get(version) || 0n) + BigInt(account.balance));
      }
    }
    accountMismatches += [...reconstructed.values()].filter(n => n !== 0n).length;
    const recharges = await RechargeHistory.countDocuments({}).session(session);
    const callsAndLegacyGifts = await CoinsTransaction.countDocuments({}).session(session);
    const roomGifts = await GiftTransaction.countDocuments({}).session(session);
    const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' }).session(session);
    let legacyPendingWithdrawalPaise = 0n;
    for await (const withdrawal of Withdrawal.find({ status: 'pending', economyVersion: { $exists: false } }).session(session).lean().cursor()) {
      try { legacyPendingWithdrawalPaise += BigInt(diamondUnits(withdrawal.amount)); } catch { invalidWallets++; }
    }
    const liabilityByVersion = [];
    for (const [version, beans] of liabilities) {
      const pinned = await getVersion(version, session);
      liabilityByVersion.push({ version, beans: beans.toString(), beansPerInr: pinned.rules.beansPerInr,
        referencePaise: (beans * 100n / BigInt(pinned.rules.beansPerInr)).toString() });
    }
    const report = {
      generatedAt: new Date().toISOString(), databaseFingerprint: databaseFingerprint(), users, invalidWallets, legacyDiamondUnits: diamondTotal.toString(),
      legacyBeans: legacyBeans.toString(), legacyBeansBasis: 'Unchanged: legacy withdrawals use 2 Beans/INR; historical grants require review',
      legacyReferenceLiabilityPaise: (legacyBeans * 100n / 2n).toString(),
      legacyPendingWithdrawalPaise: legacyPendingWithdrawalPaise.toString(),
      legacyWalletAndPendingLiabilityPaise: (legacyBeans * 100n / 2n + legacyPendingWithdrawalPaise).toString(),
      newEarnedBeans: earnedBeans.toString(), salaryReserveBeans: reserves.toString(), withdrawalHoldBeans: withdrawalHolds.toString(),
      liabilityByVersion,
      journals, unbalancedJournals, accountMismatches, recharges, callsAndLegacyGifts, roomGifts, pendingWithdrawals,
      v2LedgerReconciles: !unbalancedJournals && !accountMismatches,
      historicalLedgerVerified: false,
      productionEligible: false,
      reason: 'Legacy records lack complete opening-balance journals. Requires finance reconciliation and staging integration evidence before release.',
    };
    return { ...report, digest: digest(report) };
  });
}
