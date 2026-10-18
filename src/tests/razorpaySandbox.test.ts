import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { RazorpayService } from '../services/razorpay.service';

test('Razorpay Sandbox Security Suite', async (t) => {
  const testSecret = 'rzp_test_secret_key_12345';
  const testWebhookSecret = 'whsec_test_webhook_secret_999';

  await t.test('1. Payment Signature Verification validates valid HMAC and rejects forged signatures', () => {
    const orderId = 'order_DA123456789';
    const paymentId = 'pay_XY987654321';

    // Generate valid HMAC-SHA256 signature
    const validSignature = crypto
      .createHmac('sha256', testSecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const origSecret = process.env.RAZORPAY_KEY_SECRET;
    try {
      process.env.RAZORPAY_KEY_SECRET = testSecret;

      // Valid signature must pass
      const isValid = RazorpayService.verifyPaymentSignature(
        {
          orderId,
          paymentId,
          signature: validSignature,
        },
        testSecret
      );
      assert.equal(isValid, true, 'Valid signature should verify successfully');

      // Forged / altered signature must be rejected
      const isForged = RazorpayService.verifyPaymentSignature(
        {
          orderId,
          paymentId,
          signature: 'bad_signature_0000000000000000000000000000000000000000000000000000000000000000',
        },
        testSecret
      );
      assert.equal(isForged, false, 'Forged signature must be rejected');

      // Tampered orderId must fail verification
      const isTamperedOrder = RazorpayService.verifyPaymentSignature(
        {
          orderId: 'order_TAMPERED',
          paymentId,
          signature: validSignature,
        },
        testSecret
      );
      assert.equal(isTamperedOrder, false, 'Tampered orderId must be rejected');

      // Tampered paymentId must fail verification
      const isTamperedPayment = RazorpayService.verifyPaymentSignature(
        {
          orderId,
          paymentId: 'pay_TAMPERED',
          signature: validSignature,
        },
        testSecret
      );
      assert.equal(isTamperedPayment, false, 'Tampered paymentId must be rejected');
    } finally {
      process.env.RAZORPAY_KEY_SECRET = origSecret;
    }
  });

  await t.test('2. Webhook Signature Verification validates raw payload and rejects altered body', () => {
    const rawPayload = JSON.stringify({
      entity: 'event',
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_123',
            amount: 50000,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    });

    const validSignature = crypto
      .createHmac('sha256', testWebhookSecret)
      .update(rawPayload)
      .digest('hex');

    // Valid webhook payload and signature
    const verified = RazorpayService.verifyWebhookSignature(rawPayload, validSignature, testWebhookSecret);
    assert.equal(verified, true, 'Authentic webhook signature must verify');

    // Altered payload (e.g. attacker changing amount) must fail
    const alteredPayload = rawPayload.replace('50000', '10000');
    const rejected = RazorpayService.verifyWebhookSignature(alteredPayload, validSignature, testWebhookSecret);
    assert.equal(rejected, false, 'Altered payload must be rejected');

    // Wrong webhook secret must fail
    const wrongSecret = RazorpayService.verifyWebhookSignature(rawPayload, validSignature, 'wrong_webhook_secret');
    assert.equal(wrongSecret, false, 'Wrong webhook secret must be rejected');
  });

  await t.test('3. Order Creation Validation enforces positive amounts and requires userId', async () => {
    await assert.rejects(
      async () => {
        await RazorpayService.createOrder({
          amountInr: 0,
          userId: 'user_123',
          diamonds: 100,
        });
      },
      /Invalid order amount/
    );

    await assert.rejects(
      async () => {
        await RazorpayService.createOrder({
          amountInr: -50,
          userId: 'user_123',
          diamonds: 100,
        });
      },
      /Invalid order amount/
    );

    await assert.rejects(
      async () => {
        await RazorpayService.createOrder({
          amountInr: 100,
          userId: '',
          diamonds: 100,
        });
      },
      /User ID is required/
    );
  });

  await t.test('4. Configuration Status detects sandbox vs live mode without exposing secrets', () => {
    const origKey = process.env.RAZORPAY_KEY_ID;
    const origSecret = process.env.RAZORPAY_KEY_SECRET;
    try {
      process.env.RAZORPAY_KEY_ID = 'rzp_test_AbCdEf123456';
      process.env.RAZORPAY_KEY_SECRET = 'valid_secret_sample_key_123';
      const statusTest = RazorpayService.getConfigurationStatus();
      assert.equal(statusTest.isTestMode, true);
      assert.equal(statusTest.isConfigured, true);
      assert.equal(statusTest.status, 'SANDBOX_CONFIGURED');
      assert.equal(statusTest.keyIdPrefix.includes('rzp_test_'), true);
      assert.equal(statusTest.keyIdPrefix.includes('AbCdEf'), false, 'Key ID must be masked');

      process.env.RAZORPAY_KEY_ID = 'rzp_live_XyZ123456789';
      process.env.RAZORPAY_KEY_SECRET = 'valid_secret_sample_key_123';
      const statusLive = RazorpayService.getConfigurationStatus();
      assert.equal(statusLive.isTestMode, false);
      assert.equal(statusLive.status, 'LIVE_CONFIGURED');
    } finally {
      if (origKey !== undefined) process.env.RAZORPAY_KEY_ID = origKey;
      if (origSecret !== undefined) process.env.RAZORPAY_KEY_SECRET = origSecret;
    }
  });
});
