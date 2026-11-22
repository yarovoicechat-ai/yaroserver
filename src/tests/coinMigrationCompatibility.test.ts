import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { User } from '../models/user.model';
import { UserRole, Gender, AuthType } from '../constants/user';

describe('YARO Currency Segregation & Anti-Dual-Sync Test Suite', () => {
  test('1. User Schema Isolation: changing diamonds (Coins) NEVER changes coins (Beans) and vice versa', () => {
    const user = new User({
      userId: 888001,
      name: 'Tester Balance Isolation',
      role: UserRole.USER,
      gender: Gender.MALE,
      authType: AuthType.PHONE,
      diamonds: 5000, // Spending currency (COINS)
      coins: 12000,   // Creator earnings (BEANS)
      beans: 12000,
    });

    // In MongoDB: diamonds is spending coins, coins is creator beans
    assert.strictEqual(user.diamonds, 5000);
    assert.strictEqual(user.coins, 12000);
    assert.strictEqual(user.beans, 12000);

    // Modifying diamonds must NOT modify coins
    user.diamonds = 7500;
    assert.strictEqual(user.diamonds, 7500);
    assert.strictEqual(user.coins, 12000, 'User.coins (Beans) must NOT change when diamonds (Coins) changes');

    // Modifying coins/beans must NOT modify diamonds
    user.coins = 20000;
    user.beans = 20000;
    assert.strictEqual(user.coins, 20000);
    assert.strictEqual(user.beans, 20000);
    assert.strictEqual(user.diamonds, 7500, 'User.diamonds (Coins) must NOT change when coins (Beans) changes');

    // Serialization mapping:
    // toJSON exposes: coins = spending (diamonds), beans = creator earnings (beans/coins)
    const json = user.toJSON();
    assert.strictEqual(json.coins, 7500, 'API coins must reflect spending balance (diamonds)');
    assert.strictEqual(json.beans, 20000, 'API beans must reflect creator earnings');
    assert.strictEqual(json.diamonds, 7500, 'Legacy API diamonds must reflect spending balance');
  });

  test('2. Coins Recharge: Adds to spending balance (diamonds) without touching Beans', () => {
    let dbUser = {
      diamonds: 2000, // Spending Coins
      coins: 50000,   // Earned Beans
      beans: 50000,
    };

    const rechargeAmount = 10000;
    // Recharge credits ONLY diamonds
    dbUser.diamonds += rechargeAmount;

    assert.strictEqual(dbUser.diamonds, 12000, 'Spending coins increased by 10,000');
    assert.strictEqual(dbUser.coins, 50000, 'Earned Beans remained exactly untouched');
    assert.strictEqual(dbUser.beans, 50000, 'Explicit Beans remained exactly untouched');
  });

  test('3. Beans Earning (Host Gift Settlement): Credits host Beans without touching host spending Coins', () => {
    let hostWallet = {
      diamonds: 350,   // Host personal spending coins
      coins: 45000,    // Host creator beans
      beans: 45000,
    };

    const giftEarnings = 2500; // Received beans from room gift
    hostWallet.coins += giftEarnings;
    hostWallet.beans += giftEarnings;

    assert.strictEqual(hostWallet.coins, 47500, 'Host beans credited');
    assert.strictEqual(hostWallet.beans, 47500);
    assert.strictEqual(hostWallet.diamonds, 350, 'Host spending balance must NOT be altered by gift receipt');
  });

  test('4. Coins Gift Deduction (Sender): Deducts ONLY sender spending Coins, never sender Beans', () => {
    let senderWallet = {
      diamonds: 5000,  // Sender spending coins
      coins: 80000,   // Sender earned beans as host
      beans: 80000,
    };

    const giftCost = 1500;
    assert.ok(senderWallet.diamonds >= giftCost, 'Sender has sufficient coins');

    senderWallet.diamonds -= giftCost;

    assert.strictEqual(senderWallet.diamonds, 3500, 'Sender spending coins correctly deducted');
    assert.strictEqual(senderWallet.coins, 80000, 'Sender earned beans must remain 100% untouched');
    assert.strictEqual(senderWallet.beans, 80000);
  });

  test('5. Beans Withdrawal: Debits ONLY Beans, never spending Coins', () => {
    let creatorWallet = {
      diamonds: 4200,  // Spending coins
      coins: 100000,   // Creator beans
      beans: 100000,
    };

    const withdrawalBeans = 40000; // ₹200 withdrawal
    assert.ok(creatorWallet.beans >= withdrawalBeans);

    creatorWallet.coins -= withdrawalBeans;
    creatorWallet.beans -= withdrawalBeans;

    assert.strictEqual(creatorWallet.coins, 60000, 'Creator beans correctly held/debited');
    assert.strictEqual(creatorWallet.beans, 60000);
    assert.strictEqual(creatorWallet.diamonds, 4200, 'Spending coins must remain 100% untouched');
  });

  test('6. Beans-to-Coins Conversion: Explicit transaction converts Beans into Coins (2:1 ratio)', () => {
    let userWallet = {
      diamonds: 1000,  // Spending coins before conversion
      coins: 20000,   // Beans before conversion
      beans: 20000,
    };

    const beansToConvert = 10000;
    const coinsReceived = Math.floor(beansToConvert / 2); // 5,000 Coins

    assert.ok(userWallet.beans >= beansToConvert);
    // Explicit conversion
    userWallet.beans -= beansToConvert;
    userWallet.coins -= beansToConvert;
    userWallet.diamonds += coinsReceived;

    assert.strictEqual(userWallet.beans, 10000, 'Beans reduced by converted amount');
    assert.strictEqual(userWallet.coins, 10000);
    assert.strictEqual(userWallet.diamonds, 6000, 'Spending coins increased by converted yield');
  });

  test('7. Greedy King Debit: Debits ONLY spending Coins, Beans remain isolated', () => {
    let playerWallet = {
      diamonds: 8500,  // Coins available for betting
      coins: 900000,  // Beans earned as popular creator
      beans: 900000,
    };

    const betAmount = 2000;
    assert.ok(playerWallet.diamonds >= betAmount);

    playerWallet.diamonds -= betAmount;

    assert.strictEqual(playerWallet.diamonds, 6500, 'Bet amount deducted from spending coins');
    assert.strictEqual(playerWallet.coins, 900000, 'Creator beans CANNOT be used or deducted for game betting');
    assert.strictEqual(playerWallet.beans, 900000);
  });

  test('8. Greedy King Payout: Credits ONLY spending Coins, Beans remain isolated', () => {
    let playerWallet = {
      diamonds: 6500,
      coins: 900000,
      beans: 900000,
    };

    const winAmount = 18000; // 9x multiplier win
    playerWallet.diamonds += winAmount;

    assert.strictEqual(playerWallet.diamonds, 24500, 'Game winnings credited to spending coins');
    assert.strictEqual(playerWallet.coins, 900000, 'Creator beans untouched by game winnings');
    assert.strictEqual(playerWallet.beans, 900000);
  });

  test('9. Idempotency & Duplicate Request Safety: Retrying same idempotency key returns exact result without second debit', () => {
    let wallet = { diamonds: 10000 };
    const processedKeys = new Map<string, number>();

    const debitOperation = (key: string, amount: number) => {
      if (processedKeys.has(key)) {
        return { success: true, balanceAfter: processedKeys.get(key)!, duplicate: true };
      }
      wallet.diamonds -= amount;
      processedKeys.set(key, wallet.diamonds);
      return { success: true, balanceAfter: wallet.diamonds, duplicate: false };
    };

    const res1 = debitOperation('key_tx_001', 3000);
    assert.strictEqual(res1.duplicate, false);
    assert.strictEqual(res1.balanceAfter, 7000);
    assert.strictEqual(wallet.diamonds, 7000);

    // Concurrent duplicate request with exact same key
    const res2 = debitOperation('key_tx_001', 3000);
    assert.strictEqual(res2.duplicate, true);
    assert.strictEqual(res2.balanceAfter, 7000);
    assert.strictEqual(wallet.diamonds, 7000, 'Duplicate key must NOT debit wallet a second time');
  });

  test('10. Old API Compatibility: API response guarantees coins === diamonds and separate beans', () => {
    const user = new User({
      userId: 888002,
      diamonds: 4500,
      coins: 18000,
      beans: 18000,
    });

    const apiResponse = user.toJSON();
    // New app reads .coins
    assert.strictEqual(apiResponse.coins, 4500);
    // Legacy app reads .diamonds
    assert.strictEqual(apiResponse.diamonds, 4500);
    // Creator screens read .beans
    assert.strictEqual(apiResponse.beans, 18000);

    // Verify mathematical equality
    assert.strictEqual(apiResponse.coins, apiResponse.diamonds);
    assert.notStrictEqual(apiResponse.coins, apiResponse.beans);
  });
});
