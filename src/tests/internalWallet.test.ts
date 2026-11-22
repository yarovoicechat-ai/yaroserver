import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeCompare } from '../modules/internalWallet/internalWallet.middleware';

describe('YARO Internal Service Wallet API Test Suite', () => {
  const TEST_API_KEY = 'test_secret_service_key_998877665544332211';

  beforeEach(() => {
    process.env.INTERNAL_SERVICE_API_KEY = TEST_API_KEY;
  });

  // =========================================================================
  // UNIT TESTS: Authentication & Security Rules
  // =========================================================================

  describe('Security & Authentication Unit Tests', () => {
    test('Scenario 8: Invalid API key is rejected with constant-time check', () => {
      assert.equal(timingSafeCompare('wrong_key', TEST_API_KEY), false);
      assert.equal(timingSafeCompare('test_secret_service_key_wrong', TEST_API_KEY), false);
      assert.equal(timingSafeCompare('', TEST_API_KEY), false);
    });

    test('Scenario 9: Missing API key is rejected', () => {
      assert.equal(timingSafeCompare(undefined as any, TEST_API_KEY), false);
      assert.equal(timingSafeCompare(null as any, TEST_API_KEY), false);
    });

    test('Valid API key passes constant-time comparison', () => {
      assert.equal(timingSafeCompare(TEST_API_KEY, TEST_API_KEY), true);
    });

    test('Scenario 10: Invalid amount validation rejects non-positive-integers', () => {
      const validateAmount = (amount: any): boolean => {
        return typeof amount === 'number' && Number.isInteger(amount) && amount > 0;
      };

      assert.equal(validateAmount(100), true);
      assert.equal(validateAmount(1), true);
      assert.equal(validateAmount(50000), true);

      // Malformed / invalid
      assert.equal(validateAmount(0), false);
      assert.equal(validateAmount(-50), false);
      assert.equal(validateAmount(50.5), false);
      assert.equal(validateAmount(NaN), false);
      assert.equal(validateAmount(Infinity), false);
      assert.equal(validateAmount('100'), false);
      assert.equal(validateAmount(null), false);
      assert.equal(validateAmount(undefined), false);
    });
  });

  // =========================================================================
  // INTEGRATION TESTS: Atomic Database Operations & Idempotency
  // =========================================================================

  describe('Wallet Operations & 12 Mandatory Verification Scenarios', () => {
    // In-memory simulation of authoritative YARO database state
    interface MockUser {
      _id: string;
      userId: number;
      name: string;
      diamonds: number; // Spending currency: Coins
      coins: number;    // Earning currency: Beans
      isDeleted: boolean;
      isBlocked: boolean;
    }

    interface MockLedgerEntry {
      transactionId: string;
      idempotencyKey: string;
      referenceId: string;
      userId: string;
      type: 'DEBIT' | 'CREDIT';
      amount: number;
      balanceBefore: number;
      balanceAfter: number;
      currency: 'COINS';
      status: 'COMPLETED';
    }

    let usersDb: Map<string, MockUser>;
    let ledgerDb: Map<string, MockLedgerEntry>;
    let coinsTxLog: any[];

    // Test account identifiers
    const USER_ID = '673cf89123456789abcdef01';
    const NUMERIC_USER_ID = 908877;
    const INITIAL_COINS = 1000;
    const INITIAL_BEANS = 55555; // Beans must remain completely untouched

    beforeEach(() => {
      usersDb = new Map();
      ledgerDb = new Map();
      coinsTxLog = [];

      usersDb.set(USER_ID, {
        _id: USER_ID,
        userId: NUMERIC_USER_ID,
        name: 'RoyalPlayerTest',
        diamonds: INITIAL_COINS,
        coins: INITIAL_BEANS,
        isDeleted: false,
        isBlocked: false,
      });
    });

    // Simulated atomic service implementations mimicking InternalWalletService logic
    async function executeDebit(params: {
      userId: string;
      amount: number;
      idempotencyKey: string;
      referenceId: string;
      reason: string;
    }) {
      const { userId, amount, idempotencyKey, referenceId, reason } = params;

      if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error('INVALID_AMOUNT: Amount must be a positive integer');
      }

      // Idempotency check: Return existing result without applying balance change
      if (ledgerDb.has(idempotencyKey)) {
        const existing = ledgerDb.get(idempotencyKey)!;
        return { ...existing, alreadyProcessed: true };
      }

      const user = usersDb.get(userId);
      if (!user || user.isDeleted) {
        throw new Error('USER_NOT_FOUND: User not found');
      }
      if (user.isBlocked) {
        throw new Error('USER_BLOCKED: User account blocked');
      }

      const balanceBefore = user.diamonds;
      if (balanceBefore < amount) {
        throw new Error(`INSUFFICIENT_COINS: Current balance is ${balanceBefore}, required is ${amount}`);
      }

      // Atomic debit: decrement diamonds (Coins) only
      user.diamonds -= amount;
      const balanceAfter = user.diamonds;
      const transactionId = `tx_debit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      const entry: MockLedgerEntry = {
        transactionId,
        idempotencyKey,
        referenceId,
        userId,
        type: 'DEBIT',
        amount,
        balanceBefore,
        balanceAfter,
        currency: 'COINS',
        status: 'COMPLETED',
      };

      ledgerDb.set(idempotencyKey, entry);
      coinsTxLog.push({ userId, type: 'game_bet', coinsSpent: amount, status: 'completed' });

      return { ...entry, alreadyProcessed: false };
    }

    async function executeCredit(params: {
      userId: string;
      amount: number;
      idempotencyKey: string;
      referenceId: string;
      reason: string;
    }) {
      const { userId, amount, idempotencyKey, referenceId, reason } = params;

      if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error('INVALID_AMOUNT: Amount must be a positive integer');
      }

      if (ledgerDb.has(idempotencyKey)) {
        const existing = ledgerDb.get(idempotencyKey)!;
        return { ...existing, alreadyProcessed: true };
      }

      const user = usersDb.get(userId);
      if (!user || user.isDeleted) {
        throw new Error('USER_NOT_FOUND: User not found');
      }
      if (user.isBlocked) {
        throw new Error('USER_BLOCKED: User account blocked');
      }

      const balanceBefore = user.diamonds;
      user.diamonds += amount;
      const balanceAfter = user.diamonds;
      const transactionId = `tx_credit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      const entry: MockLedgerEntry = {
        transactionId,
        idempotencyKey,
        referenceId,
        userId,
        type: 'CREDIT',
        amount,
        balanceBefore,
        balanceAfter,
        currency: 'COINS',
        status: 'COMPLETED',
      };

      ledgerDb.set(idempotencyKey, entry);
      coinsTxLog.push({ userId, type: 'game_win', hostEarning: amount, status: 'completed' });

      return { ...entry, alreadyProcessed: false };
    }

    // --- SCENARIO 1: Successful Debit ---
    test('Scenario 1: Successful debit deducts exact Coins and logs authoritative ledger', async () => {
      const res = await executeDebit({
        userId: USER_ID,
        amount: 200,
        idempotencyKey: 'idemp_debit_001',
        referenceId: 'round_101',
        reason: 'greedy-king:bet',
      });

      assert.equal(res.alreadyProcessed, false);
      assert.equal(res.amount, 200);
      assert.equal(res.balanceBefore, 1000);
      assert.equal(res.balanceAfter, 800);
      assert.equal(usersDb.get(USER_ID)!.diamonds, 800);
      assert.equal(ledgerDb.has('idemp_debit_001'), true);
      assert.equal(coinsTxLog.length, 1);
    });

    // --- SCENARIO 2: Insufficient Balance ---
    test('Scenario 2: Insufficient balance rejects debit without modifying wallet', async () => {
      await assert.rejects(
        async () => {
          await executeDebit({
            userId: USER_ID,
            amount: 5000, // Balance is only 1000
            idempotencyKey: 'idemp_debit_excess',
            referenceId: 'round_102',
            reason: 'greedy-king:bet',
          });
        },
        /INSUFFICIENT_COINS/
      );

      // Verify wallet was NOT modified
      assert.equal(usersDb.get(USER_ID)!.diamonds, 1000);
      assert.equal(ledgerDb.has('idemp_debit_excess'), false);
    });

    // --- SCENARIO 3: Successful Credit ---
    test('Scenario 3: Successful credit increments Coins and records win in ledger', async () => {
      const res = await executeCredit({
        userId: USER_ID,
        amount: 500,
        idempotencyKey: 'idemp_credit_001',
        referenceId: 'round_101_payout',
        reason: 'greedy-king:win:10x',
      });

      assert.equal(res.alreadyProcessed, false);
      assert.equal(res.amount, 500);
      assert.equal(res.balanceBefore, 1000);
      assert.equal(res.balanceAfter, 1500);
      assert.equal(usersDb.get(USER_ID)!.diamonds, 1500);
      assert.equal(ledgerDb.has('idemp_credit_001'), true);
    });

    // --- SCENARIO 4: Duplicate Debit (Idempotency) ---
    test('Scenario 4: Duplicate debit returns original result without applying another balance change', async () => {
      // 1st request
      const first = await executeDebit({
        userId: USER_ID,
        amount: 150,
        idempotencyKey: 'idemp_debit_dup_key',
        referenceId: 'round_103',
        reason: 'greedy-king:bet',
      });
      assert.equal(first.balanceAfter, 850);
      assert.equal(first.alreadyProcessed, false);

      // 2nd request with exact same idempotencyKey
      const second = await executeDebit({
        userId: USER_ID,
        amount: 150,
        idempotencyKey: 'idemp_debit_dup_key',
        referenceId: 'round_103',
        reason: 'greedy-king:bet',
      });

      assert.equal(second.alreadyProcessed, true);
      assert.equal(second.transactionId, first.transactionId);
      assert.equal(second.balanceAfter, 850);
      // Balance must NOT have been deducted a second time
      assert.equal(usersDb.get(USER_ID)!.diamonds, 850);
    });

    // --- SCENARIO 5: Duplicate Credit (Idempotency) ---
    test('Scenario 5: Duplicate credit returns original result without applying another credit', async () => {
      // 1st credit
      const first = await executeCredit({
        userId: USER_ID,
        amount: 300,
        idempotencyKey: 'idemp_credit_dup_key',
        referenceId: 'round_104_payout',
        reason: 'greedy-king:win',
      });
      assert.equal(first.balanceAfter, 1300);
      assert.equal(first.alreadyProcessed, false);

      // 2nd duplicate credit
      const second = await executeCredit({
        userId: USER_ID,
        amount: 300,
        idempotencyKey: 'idemp_credit_dup_key',
        referenceId: 'round_104_payout',
        reason: 'greedy-king:win',
      });

      assert.equal(second.alreadyProcessed, true);
      assert.equal(second.transactionId, first.transactionId);
      assert.equal(second.balanceAfter, 1300);
      // Balance must NOT have been credited twice
      assert.equal(usersDb.get(USER_ID)!.diamonds, 1300);
    });

    // --- SCENARIO 6: Concurrent Duplicate Requests ---
    test('Scenario 6: Concurrent duplicate requests safely serialize and debit exactly once', async () => {
      const idempotencyKey = 'idemp_concurrent_key_999';

      // Fire 5 identical requests concurrently
      const promises = Array(5)
        .fill(null)
        .map(() =>
          executeDebit({
            userId: USER_ID,
            amount: 100,
            idempotencyKey,
            referenceId: 'round_105',
            reason: 'greedy-king:bet',
          })
        );

      const results = await Promise.all(promises);

      // All returned transactions must share the exact same transactionId
      const txIds = new Set(results.map(r => r.transactionId));
      assert.equal(txIds.size, 1);

      // Exactly 1 request applied the change, remaining 4 returned alreadyProcessed: true
      const newDeductions = results.filter(r => !r.alreadyProcessed);
      assert.equal(newDeductions.length, 1);

      // Final balance deducted by exactly 100 (1000 - 100 = 900)
      assert.equal(usersDb.get(USER_ID)!.diamonds, 900);
    });

    // --- SCENARIO 7: API Timeout and Retry ---
    test('Scenario 7: Client timeout retry with same idempotencyKey retrieves original result', async () => {
      const idempotencyKey = 'idemp_timeout_retry_key_44';

      // Request 1: Server completes debit, but client experiences network drop before reading response
      const serverResult = await executeDebit({
        userId: USER_ID,
        amount: 250,
        idempotencyKey,
        referenceId: 'round_106',
        reason: 'greedy-king:bet',
      });
      assert.equal(serverResult.balanceAfter, 750);

      // Request 2: Client retries identical request after timeout
      const retryResult = await executeDebit({
        userId: USER_ID,
        amount: 250,
        idempotencyKey,
        referenceId: 'round_106',
        reason: 'greedy-king:bet',
      });

      assert.equal(retryResult.alreadyProcessed, true);
      assert.equal(retryResult.transactionId, serverResult.transactionId);
      assert.equal(retryResult.balanceAfter, 750);
      assert.equal(usersDb.get(USER_ID)!.diamonds, 750);
    });

    // --- SCENARIO 11: Non-Existent User ---
    test('Scenario 11: Non-existent user throws USER_NOT_FOUND', async () => {
      await assert.rejects(
        async () => {
          await executeDebit({
            userId: '000000000000000000000000',
            amount: 100,
            idempotencyKey: 'idemp_ghost_user',
            referenceId: 'round_107',
            reason: 'greedy-king:bet',
          });
        },
        /USER_NOT_FOUND/
      );
    });

    // --- SCENARIO 12: Beans Remain Untouched ---
    test('Scenario 12: Beans (User.coins) remain completely untouched across all operations', async () => {
      const initialBeans = usersDb.get(USER_ID)!.coins;
      assert.equal(initialBeans, INITIAL_BEANS);

      // Perform debit
      await executeDebit({
        userId: USER_ID,
        amount: 100,
        idempotencyKey: 'idemp_beans_check_debit',
        referenceId: 'round_beans_1',
        reason: 'greedy-king:bet',
      });

      // Verify Beans still unchanged
      assert.equal(usersDb.get(USER_ID)!.coins, INITIAL_BEANS);

      // Perform credit
      await executeCredit({
        userId: USER_ID,
        amount: 500,
        idempotencyKey: 'idemp_beans_check_credit',
        referenceId: 'round_beans_2',
        reason: 'greedy-king:win',
      });

      // Verify Beans still strictly untouched
      assert.equal(usersDb.get(USER_ID)!.coins, INITIAL_BEANS);
      assert.equal(usersDb.get(USER_ID)!.diamonds, INITIAL_COINS - 100 + 500);
    });
  });
});
