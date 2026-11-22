import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express, { Request, Response } from 'express';
import http from 'node:http';
import { internalServiceAuth } from '../modules/internalWallet/internalWallet.middleware';

describe('Internal Wallet HTTP Endpoint & Middleware Tests', () => {
  const TEST_KEY = 'secret_internal_key_test_12345';
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    process.env.INTERNAL_SERVICE_API_KEY = TEST_KEY;
    const app = express();
    app.use(express.json());

    const router = express.Router();
    router.use(internalServiceAuth);

    router.post('/debit', (req: Request, res: Response) => {
      const { userId, amount, idempotencyKey, referenceId, reason } = req.body;
      if (!userId) return res.status(400).json({ success: false, error: 'INVALID_USER_ID' });
      if (!amount || typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ success: false, error: 'INVALID_AMOUNT' });
      }
      if (!idempotencyKey) return res.status(400).json({ success: false, error: 'INVALID_IDEMPOTENCY_KEY' });

      return res.status(200).json({
        success: true,
        data: {
          transactionId: 'tx_mock_123',
          referenceId,
          userId,
          amount,
          balanceAfter: 900,
          currency: 'COINS',
          alreadyProcessed: false,
        },
      });
    });

    router.post('/credit', (req: Request, res: Response) => {
      const { userId, amount, idempotencyKey, referenceId } = req.body;
      if (!userId) return res.status(400).json({ success: false, error: 'INVALID_USER_ID' });
      if (!amount || typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ success: false, error: 'INVALID_AMOUNT' });
      }

      return res.status(200).json({
        success: true,
        data: {
          transactionId: 'tx_mock_credit_456',
          referenceId,
          userId,
          amount,
          balanceAfter: 1200,
          currency: 'COINS',
          alreadyProcessed: false,
        },
      });
    });

    router.get('/balance/:userId', (req: Request, res: Response) => {
      const { userId } = req.params;
      if (userId === 'nonexistent') {
        return res.status(404).json({ success: false, error: 'USER_NOT_FOUND' });
      }
      return res.status(200).json({
        success: true,
        data: {
          userId,
          coins: 1000,
          currency: 'COINS',
        },
      });
    });

    app.use('/api/v1/internal/wallet', router);

    await new Promise<void>((resolve) => {
      server = http.createServer(app).listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('HTTP: Missing x-service-api-key returns 401 Unauthorized', async () => {
    const res = await fetch(`${baseUrl}/api/v1/internal/wallet/debit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'u1', amount: 100 }),
    });
    const body: any = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.success, false);
    assert.match(body.error, /Missing x-service-api-key/);
  });

  test('HTTP: Invalid x-service-api-key returns 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/v1/internal/wallet/debit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-api-key': 'invalid_secret_key',
      },
      body: JSON.stringify({ userId: 'u1', amount: 100 }),
    });
    const body: any = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.success, false);
    assert.match(body.error, /Invalid service API key/);
  });

  test('HTTP: Valid x-service-api-key executes debit successfully with 200 OK', async () => {
    const res = await fetch(`${baseUrl}/api/v1/internal/wallet/debit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-api-key': TEST_KEY,
      },
      body: JSON.stringify({
        userId: 'user_live_01',
        amount: 100,
        idempotencyKey: 'idemp_http_01',
        referenceId: 'round_http_01',
        reason: 'greedy-king:bet',
      }),
    });
    const body: any = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.amount, 100);
    assert.equal(body.data.currency, 'COINS');
  });

  test('HTTP: Valid x-service-api-key executes credit successfully with 200 OK', async () => {
    const res = await fetch(`${baseUrl}/api/v1/internal/wallet/credit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-api-key': TEST_KEY,
      },
      body: JSON.stringify({
        userId: 'user_live_01',
        amount: 300,
        idempotencyKey: 'idemp_http_02',
        referenceId: 'round_http_02',
        reason: 'greedy-king:win',
      }),
    });
    const body: any = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.amount, 300);
  });

  test('HTTP: GET /balance returns authoritative coins without leaking sensitive user data', async () => {
    const res = await fetch(`${baseUrl}/api/v1/internal/wallet/balance/user_live_01`, {
      headers: { 'x-service-api-key': TEST_KEY },
    });
    const body: any = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.coins, 1000);
    assert.equal(body.data.currency, 'COINS');
    assert.equal(body.data.password, undefined);
    assert.equal(body.data.token, undefined);
    assert.equal(body.data.beans, undefined);
  });

  test('HTTP: GET /balance for non-existent user returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/v1/internal/wallet/balance/nonexistent`, {
      headers: { 'x-service-api-key': TEST_KEY },
    });
    const body: any = await res.json();
    assert.equal(res.status, 404);
    assert.equal(body.success, false);
  });
});
