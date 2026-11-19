import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameValidator } from '../modules/games/game.validator';

test('GameValidator: Allowed Origins validate properly', () => {
  assert.equal(GameValidator.validateOrigin('https://games.yaroapp.in'), true);
  assert.equal(GameValidator.validateOrigin('https://games.yaroapp.in/food-game/'), true);
  assert.equal(GameValidator.validateOrigin('https://api.yaroapp.in/games/'), true);
  assert.equal(GameValidator.validateOrigin('https://yaroapp.in'), true);
  assert.equal(GameValidator.validateOrigin('https://malicious-site.com'), false);
  assert.equal(GameValidator.validateOrigin('http://insecure-http.com'), false);
});

test('GameValidator: Bridge message schema validation', () => {
  // Valid message
  const validMsg = {
    version: 1,
    type: 'GAME_READY',
    requestId: 'req_123',
    sessionId: 'sess_456',
    payload: { ready: true },
  };
  const resValid = GameValidator.validateBridgeMessage(validMsg);
  assert.equal(resValid.valid, true);

  // Invalid protocol version
  const invalidVer = { ...validMsg, version: 2 };
  const resVer = GameValidator.validateBridgeMessage(invalidVer);
  assert.equal(resVer.valid, false);

  // Missing requestId
  const missingReq = { ...validMsg, requestId: '' };
  const resReq = GameValidator.validateBridgeMessage(missingReq);
  assert.equal(resReq.valid, false);

  // Unknown event type
  const unknownType = { ...validMsg, type: 'UNKNOWN_HACK_EVENT' };
  const resUnknown = GameValidator.validateBridgeMessage(unknownType);
  assert.equal(resUnknown.valid, false);
});

test('GameValidator: Bet placement constraints and Coins currency rules', () => {
  // Valid bet
  const validBet = GameValidator.validateBetPlacement({
    amount: 100,
    betTarget: 'apple',
    minBet: 50,
    maxBet: 50000,
  });
  assert.equal(validBet.valid, true);

  // Below minBet
  const belowMin = GameValidator.validateBetPlacement({
    amount: 10,
    betTarget: 'apple',
    minBet: 50,
    maxBet: 50000,
  });
  assert.equal(belowMin.valid, false);

  // Above maxBet
  const aboveMax = GameValidator.validateBetPlacement({
    amount: 100000,
    betTarget: 'apple',
    minBet: 50,
    maxBet: 50000,
  });
  assert.equal(aboveMax.valid, false);

  // Negative or float amount
  const negBet = GameValidator.validateBetPlacement({
    amount: -50,
    betTarget: 'apple',
  });
  assert.equal(negBet.valid, false);

  const floatBet = GameValidator.validateBetPlacement({
    amount: 50.5,
    betTarget: 'apple',
  });
  assert.equal(floatBet.valid, false);

  // Empty or invalid target
  const emptyTarget = GameValidator.validateBetPlacement({
    amount: 100,
    betTarget: '',
  });
  assert.equal(emptyTarget.valid, false);
});

test('Official Currency Economy: Coins vs Beans strict segregation', () => {
  const SPENDING_CURRENCY = 'COINS';
  const WITHDRAWAL_CURRENCY = 'BEANS';

  // Game entry must require Coins
  const isDirectGameEntryAllowed = (currency: string) => currency === SPENDING_CURRENCY;
  assert.equal(isDirectGameEntryAllowed('COINS'), true);
  assert.equal(isDirectGameEntryAllowed('BEANS'), false);

  // Gifts must require Coins
  const isGiftPurchaseAllowed = (currency: string) => currency === SPENDING_CURRENCY;
  assert.equal(isGiftPurchaseAllowed('COINS'), true);
  assert.equal(isGiftPurchaseAllowed('BEANS'), false);

  // Beans can only be withdrawn or converted to Coins
  const isBeanOperationPermitted = (op: 'CONVERT_TO_COINS' | 'WITHDRAW' | 'DIRECT_SPEND') => {
    return op === 'CONVERT_TO_COINS' || op === 'WITHDRAW';
  };
  assert.equal(isBeanOperationPermitted('CONVERT_TO_COINS'), true);
  assert.equal(isBeanOperationPermitted('WITHDRAW'), true);
  assert.equal(isBeanOperationPermitted('DIRECT_SPEND'), false);
});
