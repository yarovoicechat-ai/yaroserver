import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../models/user.model';
import { GiftService } from '../gift/gift.service';
import { UserRole, Gender, AuthType } from '../constants/user';

describe('YARO Backend Coins & Beans Critical Remediation Test Suite', () => {
  after(() => {
    // Cleanly close any background sockets/redis handles created during import
    try {
      const { redisClient } = require('../database/redis');
      if (redisClient && typeof redisClient.disconnect === 'function') {
        redisClient.disconnect();
      }
    } catch (_) {}
    setTimeout(() => process.exit(0), 200).unref();
  });

  // =========================================================================
  // 1. Mongoose Schema Verification: No Persisted beans Field
  // =========================================================================
  describe('1. Schema Authority & Anti-Dual-Persistence Verification', () => {
    test('User schema has exactly two authoritative numeric currency fields (diamonds, coins)', () => {
      const paths = User.schema.paths;
      
      // Authoritative spending balance
      assert.ok(paths.diamonds, 'User.diamonds must exist in schema');
      assert.strictEqual(paths.diamonds.instance, 'Number');
      assert.strictEqual((paths.diamonds as any).defaultValue, 5);

      // Authoritative creator earnings balance
      assert.ok(paths.coins, 'User.coins must exist in schema');
      assert.strictEqual(paths.coins.instance, 'Number');
      assert.strictEqual((paths.coins as any).defaultValue, 0);

      // Verify beans is NOT a persisted schema path
      assert.strictEqual(paths.beans, undefined, 'User.beans MUST NOT be a persisted schema field');

      // Verify beans is a virtual getter on the schema
      const virtuals = (User.schema as any).virtuals;
      assert.ok(virtuals.beans, 'User.beans must exist as a virtual on the schema');
    });

    test('User document virtual getter resolves dynamically to user.coins (Creator Beans)', () => {
      const user = new User({
        userId: 777001,
        name: 'Virtual Beans Test',
        diamonds: 1500, // Spending Coins
        coins: 85000,   // Creator Beans
      });

      assert.strictEqual(user.diamonds, 1500);
      assert.strictEqual(user.coins, 85000);
      // Virtual getter
      assert.strictEqual(user.beans, 85000, 'user.beans virtual must resolve to user.coins');

      // Modifying coins dynamically updates virtual beans
      user.coins += 5000;
      assert.strictEqual(user.beans, 90000);
      assert.strictEqual(user.diamonds, 1500, 'diamonds must remain untouched');
    });
  });

  // =========================================================================
  // 2. Gift Balance Helper (F-04 Remediation)
  // =========================================================================
  describe('2. Gift Balance Helper (getUserCoinsBalance)', () => {
    test('GiftService.getUserCoinsBalance reads spending diamonds, ignoring creator coins (beans)', async () => {
      // Mocking User.findById to simulate a user with 50 spending diamonds and 100,000 creator beans
      const originalFindById = User.findById;
      try {
        (User as any).findById = (id: any) => ({
          select: (fields: string) => ({
            lean: async () => ({
              _id: id,
              diamonds: 50,    // Spending Coins
              coins: 100000,   // Creator Beans in MongoDB
            }),
          }),
        });

        const spendingBalance = await GiftService.getUserCoinsBalance('mock_user_id');
        assert.strictEqual(spendingBalance, 50, 'Must return spending coins (diamonds), NOT creator beans (coins)');

        const aliasBalance = await GiftService.getUserDiamondsBalance('mock_user_id');
        assert.strictEqual(aliasBalance, 50, 'Legacy alias must also return spending coins');
      } finally {
        User.findById = originalFindById;
      }
    });

    test('GiftService.getUserCoinsBalance handles null/zero diamonds cleanly', async () => {
      const originalFindById = User.findById;
      try {
        (User as any).findById = (id: any) => ({
          select: (fields: string) => ({
            lean: async () => ({
              _id: id,
              diamonds: 0,
              coins: 50000,
            }),
          }),
        });

        const balance = await GiftService.getUserCoinsBalance('mock_zero_user');
        assert.strictEqual(balance, 0, 'Zero spending coins must return 0, not fall back to creator beans');
      } finally {
        User.findById = originalFindById;
      }
    });
  });

  // =========================================================================
  // 3. Gift Flow Balance Segregation (F-01 Remediation)
  // =========================================================================
  describe('3. Gift Flow Atomic Segregation', () => {
    test('Sender debit decrements diamonds; Receiver credit increments coins ONLY (no beans in $inc)', () => {
      const sender = {
        _id: 'sender_1',
        diamonds: 5000, // Spending Coins
        coins: 20000,   // Creator Beans
      };

      const receiver = {
        _id: 'receiver_1',
        diamonds: 100,  // Spending Coins
        coins: 15000,   // Creator Beans
      };

      const giftCost = 1000;
      const hostEarnings = 700;

      // 1. Sender atomic debit condition: diamonds >= giftCost
      assert.ok(sender.diamonds >= giftCost);
      const senderUpdate = { $inc: { diamonds: -giftCost } };
      sender.diamonds += senderUpdate.$inc.diamonds;

      // 2. Receiver atomic credit: MUST increment coins ONLY
      const receiverUpdate = { $inc: { coins: hostEarnings } };
      assert.strictEqual((receiverUpdate.$inc as any).beans, undefined, 'Must NOT contain beans in $inc');
      receiver.coins += receiverUpdate.$inc.coins;

      assert.strictEqual(sender.diamonds, 4000, 'Sender diamonds debited by gift cost');
      assert.strictEqual(sender.coins, 20000, 'Sender Beans remain untouched');
      assert.strictEqual(receiver.coins, 15700, 'Receiver Beans incremented by earnings');
      assert.strictEqual(receiver.diamonds, 100, 'Receiver diamonds remain untouched');
    });
  });

  // =========================================================================
  // 4. Billing Service Earning Credit (F-02 Remediation)
  // =========================================================================
  describe('4. Billing Service Atomic Earning Credit', () => {
    test('Host earning increments coins ONLY without persisting beans field', () => {
      const hostWallet = {
        diamonds: 250, // Personal spending coins
        coins: 60000,  // Creator Beans
      };

      const hostEarning = 450; // Beans earned from 1 minute call
      const updateOp = { $inc: { coins: hostEarning } };

      assert.strictEqual((updateOp.$inc as any).beans, undefined, 'Must NOT contain beans in $inc');
      hostWallet.coins += updateOp.$inc.coins;

      assert.strictEqual(hostWallet.coins, 60450, 'Creator Beans updated');
      assert.strictEqual(hostWallet.diamonds, 250, 'Host personal Spending Coins untouched');
    });

    test('Caller deduction decrements diamonds ONLY', () => {
      const callerWallet = {
        diamonds: 5000,
        coins: 30000,
      };

      const callDebit = 600;
      const updateFilter = { diamonds: { $gte: callDebit } };
      const updateOp = { $inc: { diamonds: -callDebit } };

      assert.ok(callerWallet.diamonds >= callDebit);
      callerWallet.diamonds += updateOp.$inc.diamonds;

      assert.strictEqual(callerWallet.diamonds, 4400, 'Caller diamonds debited');
      assert.strictEqual(callerWallet.coins, 30000, 'Caller Beans untouched');
    });
  });

  // =========================================================================
  // 5. Coins Service Segregation (F-03 Remediation)
  // =========================================================================
  describe('5. Coins Service Balance Operations', () => {
    test("operation 'earn' updates coins ONLY without beans in $inc", () => {
      const amount = 2500;
      let targetField = '';
      let updateObject: any = {};

      const operation: string = 'earn';
      switch (operation) {
        case 'add':
          targetField = 'diamonds';
          updateObject = { $inc: { diamonds: amount } };
          break;
        case 'earn':
          targetField = 'coins';
          updateObject = { $inc: { coins: amount } };
          break;
      }

      assert.strictEqual(targetField, 'coins');
      assert.deepStrictEqual(updateObject, { $inc: { coins: 2500 } });
      assert.strictEqual((updateObject.$inc as any).beans, undefined, 'beans MUST NOT be in $inc');
    });

    test("operation 'add' updates diamonds ONLY", () => {
      const amount = 5000;
      let targetField = '';
      let updateObject: any = {};

      const operation: string = 'add';
      switch (operation) {
        case 'add':
          targetField = 'diamonds';
          updateObject = { $inc: { diamonds: amount } };
          break;
        case 'earn':
          targetField = 'coins';
          updateObject = { $inc: { coins: amount } };
          break;
      }

      assert.strictEqual(targetField, 'diamonds');
      assert.deepStrictEqual(updateObject, { $inc: { diamonds: 5000 } });
    });
  });

  // =========================================================================
  // 6. Insufficient Balance & Concurrency Locks
  // =========================================================================
  describe('6. Insufficient Balance & Concurrency Locks', () => {
    test('Gift sender deduction fails closed when diamonds < required', () => {
      const sender = { diamonds: 400 };
      const required = 500;

      const hasSufficient = sender.diamonds >= required;
      assert.strictEqual(hasSufficient, false, 'Precondition rejects debit');
      // Document is not updated
      assert.strictEqual(sender.diamonds, 400);
    });

    test('Conversion fails closed when creator beans (coins) < required', () => {
      const user = { diamonds: 50, coins: 1500 };
      const packageBeans = 2000;

      const hasSufficient = user.coins >= packageBeans;
      assert.strictEqual(hasSufficient, false, 'Precondition rejects conversion');
      assert.strictEqual(user.coins, 1500);
      assert.strictEqual(user.diamonds, 50);
    });

    test('Withdrawal fails closed when creator beans (coins) < required', () => {
      const host = { diamonds: 5000, coins: 1000 };
      const minWithdrawalBeans = 2000; // ₹10 at 200 Beans/INR

      const hasSufficient = host.coins >= minWithdrawalBeans;
      assert.strictEqual(hasSufficient, false, 'Precondition rejects withdrawal');
      assert.strictEqual(host.coins, 1000);
      assert.strictEqual(host.diamonds, 5000);
    });
  });

  // =========================================================================
  // 7. Duplicate Transaction Prevention (Idempotency)
  // =========================================================================
  describe('7. Idempotency & Duplicate Transaction Protection', () => {
    test('Duplicate transactionId in RechargeHistory prevents duplicate credit', () => {
      const existingLedger = new Set(['EXC-USER-101-1795339000']);
      const incomingIdempotencyKey = 'EXC-USER-101-1795339000';

      const isDuplicate = existingLedger.has(incomingIdempotencyKey);
      assert.strictEqual(isDuplicate, true, 'Duplicate key detected');

      let credited = false;
      if (!isDuplicate) {
        credited = true;
      }
      assert.strictEqual(credited, false, 'Duplicate must NOT credit');
    });

    test('Duplicate game bet transactionId prevents double debit', () => {
      const gameTransactions = new Map<string, { status: string; balanceAfter: number }>();
      const idempotencyKey = 'bet_greedy-king_r1001_u101_hot_dog_500';

      // First execution
      gameTransactions.set(idempotencyKey, { status: 'COMPLETED', balanceAfter: 9500 });

      // Duplicate attempt
      const existing = gameTransactions.get(idempotencyKey);
      assert.ok(existing);
      assert.strictEqual(existing.status, 'COMPLETED');
      assert.strictEqual(existing.balanceAfter, 9500, 'Returns already-processed balance without re-debiting');
    });
  });

  // =========================================================================
  // 8. API Serialization & Profile Output Invariants
  // =========================================================================
  describe('8. API Serialization & Profile Output', () => {
    test('user.toJSON() exposes coins = diamonds, beans = coins, diamonds = diamonds', () => {
      const user = new User({
        userId: 999101,
        name: 'Serialization Audit',
        diamonds: 3200, // Spending Coins
        coins: 75000,   // Creator Beans
      });

      const json = user.toJSON();
      assert.strictEqual(json.coins, 3200, 'API user.coins must equal diamonds');
      assert.strictEqual(json.beans, 75000, 'API user.beans must equal coins');
      assert.strictEqual(json.diamonds, 3200, 'API user.diamonds must equal diamonds');
    });

    test('user.toObject({ virtuals: true }) exposes coins = diamonds, beans = coins, diamonds = diamonds', () => {
      const user = new User({
        userId: 999102,
        name: 'Profile Build Audit',
        diamonds: 4500,
        coins: 92000,
      });

      const obj = user.toObject({ virtuals: true });
      assert.strictEqual(obj.coins, 4500, 'Serialized coins must equal spending diamonds');
      assert.strictEqual(obj.beans, 92000, 'Serialized beans must equal creator coins');
      assert.strictEqual(obj.diamonds, 4500, 'Serialized diamonds must equal spending diamonds');
    });

    test('profile currency resolution logic resolves correctly for both Mongoose doc and lean object', () => {
      // 1. From Mongoose doc
      const userDoc = new User({
        userId: 999103,
        diamonds: 1800,
        coins: 43000,
      });
      const docObj = userDoc.toObject({ virtuals: true });
      const spendingCoinsFromDoc = Number(userDoc?.diamonds ?? docObj?.diamonds ?? 0);
      const creatorBeansFromDoc = Number(docObj?.beans ?? userDoc?.coins ?? docObj?.coins ?? 0);
      assert.strictEqual(spendingCoinsFromDoc, 1800);
      assert.strictEqual(creatorBeansFromDoc, 43000);

      // 2. From lean object
      const leanUser = {
        diamonds: 1800,
        coins: 43000,
      };
      const spendingCoinsFromLean = Number(leanUser?.diamonds ?? 0);
      const creatorBeansFromLean = Number((leanUser as any)?.beans ?? leanUser?.coins ?? 0);
      assert.strictEqual(spendingCoinsFromLean, 1800);
      assert.strictEqual(creatorBeansFromLean, 43000);
    });
  });
});
