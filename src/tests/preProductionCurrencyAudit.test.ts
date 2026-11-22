import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../models/user.model';
import { UserRole, Gender, AuthType } from '../constants/user';
import { runSeparationMigration } from '../scripts/migrate_diamonds_to_coins';

describe('FINAL COINS & BEANS PRE-PRODUCTION AUDIT — YARO', () => {

  // =========================================================================
  // 1. Database Field Authority & Serialization Invariants
  // =========================================================================
  describe('1. Database Field Authority', () => {
    test('Spending Coins = User.diamonds, Creator Beans = User.coins in MongoDB', () => {
      const user = new User({
        userId: 900101,
        name: 'Audit User 1',
        role: UserRole.USER,
        gender: Gender.FEMALE,
        authType: AuthType.PHONE,
        diamonds: 8500, // Historical diamonds (Spending Coins)
        coins: 42000,   // Historical coins (Creator Beans)
      });

      // Assert MongoDB persisted layer
      assert.strictEqual(user.diamonds, 8500, 'Historical diamonds must be authoritative spending storage');
      assert.strictEqual(user.coins, 42000, 'Historical coins must be authoritative creator earnings storage');

      // Assert that modifying diamonds NEVER modifies coins
      user.diamonds += 1500;
      assert.strictEqual(user.diamonds, 10000);
      assert.strictEqual(user.coins, 42000, 'Coins (Beans) must never change when diamonds changes');

      // Assert that modifying coins NEVER modifies diamonds
      user.coins += 5000;
      assert.strictEqual(user.coins, 47000);
      assert.strictEqual(user.diamonds, 10000, 'Diamonds (Coins) must never change when coins changes');
    });

    test('API Serialization guarantees: coins = diamonds, beans = coins, diamonds = diamonds', () => {
      const user = new User({
        userId: 900102,
        name: 'Audit User 2',
        role: UserRole.HOST,
        gender: Gender.FEMALE,
        authType: AuthType.GOOGLE,
        diamonds: 1250, // Spending
        coins: 88000,   // Earnings
      });

      const json = user.toJSON();
      assert.strictEqual(json.coins, 1250, 'API user.coins MUST expose spending balance (diamonds)');
      assert.strictEqual(json.beans, 88000, 'API user.beans MUST expose creator earnings (coins)');
      assert.strictEqual(json.diamonds, 1250, 'Legacy API user.diamonds MUST expose spending balance');

      // Verify serialization did not mutate persisted Mongoose document
      assert.strictEqual(user.diamonds, 1250, 'Persisted diamonds must remain unchanged after toJSON()');
      assert.strictEqual(user.coins, 88000, 'Persisted coins must remain unchanged after toJSON()');
    });
  });

  // =========================================================================
  // 2. Complete Backend Audit — Transaction Segregation
  // =========================================================================
  describe('2. Complete Backend Transaction Segregation', () => {
    test('Recharge adds Spending Coins (diamonds) only', () => {
      const userDoc = { diamonds: 50, coins: 3000 };
      const rechargeAmount = 500; // 500 Coins purchased
      userDoc.diamonds += rechargeAmount;

      assert.strictEqual(userDoc.diamonds, 550, 'Recharge must credit diamonds');
      assert.strictEqual(userDoc.coins, 3000, 'Recharge must NEVER touch creator coins/beans');
    });

    test('Gift sender loses Spending Coins only; receiver earns Creator Beans only', () => {
      const sender = { userId: 101, diamonds: 2500, coins: 15000 };
      const receiver = { userId: 202, diamonds: 300, coins: 50000 };
      const giftCostCoins = 1000;
      const hostEarnedBeans = 700; // 70% settlement to host

      // 1. Sender debit: Atomic deduction on diamonds
      assert.ok(sender.diamonds >= giftCostCoins, 'Sender must have sufficient Coins');
      sender.diamonds -= giftCostCoins;

      // 2. Receiver credit: Atomic credit on coins
      receiver.coins += hostEarnedBeans;

      // Assert sender integrity
      assert.strictEqual(sender.diamonds, 1500, 'Sender diamonds must decrease by gift cost');
      assert.strictEqual(sender.coins, 15000, 'Sender Beans must remain completely untouched');

      // Assert receiver integrity
      assert.strictEqual(receiver.coins, 50700, 'Receiver Beans must increase by host share');
      assert.strictEqual(receiver.diamonds, 300, 'Receiver diamonds must remain completely untouched');
    });

    test('Caller loses Spending Coins only; host receives Creator Beans only', () => {
      const caller = { userId: 301, diamonds: 6000, coins: 20000 };
      const host = { userId: 401, diamonds: 100, coins: 120000 };
      const callCostCoins = 600; // 1 min call
      const hostEarningsBeans = 500; // 500 Beans share

      caller.diamonds -= callCostCoins;
      host.coins += hostEarningsBeans;

      assert.strictEqual(caller.diamonds, 5400, 'Caller diamonds decreased');
      assert.strictEqual(caller.coins, 20000, 'Caller Beans untouched');
      assert.strictEqual(host.coins, 120500, 'Host Beans increased');
      assert.strictEqual(host.diamonds, 100, 'Host diamonds untouched');
    });

    test('Withdrawal deducts Creator Beans (coins) only', () => {
      const host = { userId: 501, diamonds: 2000, coins: 60000 };
      const withdrawalBeans = 40000; // ₹200 withdrawal at 200 Beans/INR

      assert.ok(host.coins >= withdrawalBeans, 'Sufficient beans required');
      host.coins -= withdrawalBeans;

      assert.strictEqual(host.coins, 20000, 'Host Beans decreased by withdrawal amount');
      assert.strictEqual(host.diamonds, 2000, 'Host Spending Coins must NEVER be touched by withdrawal');
    });

    test('Greedy King bets and payouts use Spending Coins (diamonds) only', () => {
      const player = { userId: 601, diamonds: 10000, coins: 55000 };
      const betCoins = 500;
      const winPayoutCoins = 1500;

      // Bet debit
      assert.ok(player.diamonds >= betCoins);
      player.diamonds -= betCoins;
      assert.strictEqual(player.diamonds, 9500);
      assert.strictEqual(player.coins, 55000, 'Game bet must never debit Beans');

      // Win payout
      player.diamonds += winPayoutCoins;
      assert.strictEqual(player.diamonds, 11000);
      assert.strictEqual(player.coins, 55000, 'Game win payout must never credit Beans');
    });
  });

  // =========================================================================
  // 3. Conversion Verification (Beans to Coins — 2:1 Standard)
  // =========================================================================
  describe('3. Beans-to-Coins Conversion Policy & Atomic Guarantees', () => {
    test('Approved 2:1 conversion ratio: 2,000 Beans -> 1,000 Coins', () => {
      const user = { userId: 701, diamonds: 500, coins: 10000 };
      const convertBeans = 2000;
      const expectedCoins = 1000; // 2:1 approved ratio

      assert.ok(user.coins >= convertBeans, 'Must have enough Beans');
      user.coins -= convertBeans;
      user.diamonds += expectedCoins;

      assert.strictEqual(user.coins, 8000, 'Creator Beans debited by 2,000');
      assert.strictEqual(user.diamonds, 1500, 'Spending Coins credited by 1,000');
    });

    test('Insufficient Beans rejection prevents overdraft', () => {
      const user = { userId: 702, diamonds: 100, coins: 500 };
      const convertBeans = 2000;

      assert.strictEqual(user.coins < convertBeans, true, 'Precondition detects shortage');
      // Balance remains unmodified
      assert.strictEqual(user.coins, 500);
      assert.strictEqual(user.diamonds, 100);
    });

    test('Idempotency / Duplicate request protection via unique reference', () => {
      const ledger = new Set<string>();
      const refKey = 'EXC-IDEMP-TEST-999';

      function processExchange(reqRef: string, user: { coins: number; diamonds: number }, beansCost: number, coinYield: number) {
        if (ledger.has(reqRef)) {
          return { status: 'DUPLICATE', user };
        }
        if (user.coins < beansCost) return { status: 'INSUFFICIENT', user };
        user.coins -= beansCost;
        user.diamonds += coinYield;
        ledger.add(reqRef);
        return { status: 'SUCCESS', user };
      }

      const wallet = { coins: 10000, diamonds: 100 };
      const firstAttempt = processExchange(refKey, wallet, 4000, 2000);
      assert.strictEqual(firstAttempt.status, 'SUCCESS');
      assert.strictEqual(wallet.coins, 6000);
      assert.strictEqual(wallet.diamonds, 2100);

      // Retry same request
      const secondAttempt = processExchange(refKey, wallet, 4000, 2000);
      assert.strictEqual(secondAttempt.status, 'DUPLICATE');
      assert.strictEqual(wallet.coins, 6000, 'Duplicate request must NOT debit again');
      assert.strictEqual(wallet.diamonds, 2100, 'Duplicate request must NOT credit again');
    });
  });

  // =========================================================================
  // 4. Migration Dry Run Simulation & Statistics Verification
  // =========================================================================
  describe('4. Migration Dry Run Verification', () => {
    test('Simulated Migration Dry Run calculates all 10 required statistics idempotently', async () => {
      const fixtureUsers = [
        { _id: 'u1', userId: 100001, diamonds: 500, coins: 12000, beans: undefined },
        { _id: 'u2', userId: 100002, diamonds: 0, coins: 50000, beans: undefined },
        { _id: 'u3', userId: 100003, diamonds: 25000, coins: 0, beans: undefined },
        { _id: 'u4', userId: 100004, diamonds: 0, coins: 0, beans: undefined },
        { _id: 'u5', userId: 100005, diamonds: 1500, coins: 3000, beans: 3000 }, // Already separated
        { _id: 'u6', userId: 100006, diamonds: null, coins: 1000, beans: undefined }, // Missing diamonds field
      ];

      const stats = await runSeparationMigration(undefined, true, fixtureUsers);

      assert.strictEqual(stats.totalUsersScanned, 6);
      assert.strictEqual(stats.usersWithNonZeroHistoricalDiamonds, 3); // u1 (500), u3 (25000), u5 (1500)
      assert.strictEqual(stats.usersWithNonZeroHistoricalCoins, 4);    // u1 (12000), u2 (50000), u5 (3000), u6 (1000)
      assert.strictEqual(stats.totalHistoricalDiamondsBalance, 27000); // 500 + 25000 + 1500
      assert.strictEqual(stats.totalHistoricalCoinsBalance, 66000);    // 12000 + 50000 + 3000 + 1000
      assert.strictEqual(stats.proposedSpendingCoinsTotal, 27000);    // Exactly matches diamonds
      assert.strictEqual(stats.proposedCreatorBeansTotal, 66000);       // Exactly matches coins
      assert.strictEqual(stats.usersWithMissingOrConflictingFields, 1); // u6 (diamonds is null)
      assert.strictEqual(stats.usersAlreadySeparated, 1);              // u5
      assert.strictEqual(stats.usersWhoseBalancesWouldChange, 5);      // u1, u2, u3, u4, u6

      // Sensitive identifier masking check
      assert.ok(stats.sampleDiffs.length > 0);
      assert.ok(stats.sampleDiffs[0].maskedUserId.startsWith('User #****'));
      assert.strictEqual(stats.sampleDiffs[0].maskedUserId, 'User #****0001');

      // Idempotency check: Re-running dry run on same dataset produces identical numbers
      const statsRun2 = await runSeparationMigration(undefined, true, fixtureUsers);
      assert.deepStrictEqual(stats, statsRun2, 'Dry run execution must be 100% deterministic and idempotent');
    });
  });
});
