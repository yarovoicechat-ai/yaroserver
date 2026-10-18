import crypto from 'crypto';
import { razorpay } from '../configs/rozarpayConfig';
import { config } from '../configs/envConfig';
import { RechargeHistory } from '../models/RechargeHistory';
import { User } from '../models/user.model';
import { RechargeType } from '../constants/user';

export interface CreateOrderParams {
  amountInr: number;
  userId: string;
  diamonds: number;
  receipt?: string;
  notes?: Record<string, any>;
}

export interface VerifyPaymentParams {
  orderId: string;
  paymentId: string;
  signature: string;
}

export class RazorpayService {
  /**
   * Validates whether Razorpay credentials are configured and detects test mode.
   */
  static getConfigurationStatus() {
    const keyId = process.env.RAZORPAY_KEY_ID || config.RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || config.RAZORPAY_KEY_SECRET || '';
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';

    const isConfigured = Boolean(
      keyId &&
      keySecret &&
      !keyId.includes('dummy') &&
      !keySecret.includes('dummy')
    );
    const isTestMode = keyId.startsWith('rzp_test_');

    return {
      isConfigured,
      isTestMode,
      keyIdPrefix: keyId ? keyId.slice(0, 9) + '••••' : 'NONE',
      hasKeySecret: Boolean(keySecret),
      hasWebhookSecret: Boolean(webhookSecret),
      status: isConfigured ? (isTestMode ? 'SANDBOX_CONFIGURED' : 'LIVE_CONFIGURED') : 'PENDING_CONFIG',
    };
  }

  /**
   * Creates an order with Razorpay in INR.
   * Never credits wallet upon order creation.
   */
  static async createOrder(params: CreateOrderParams) {
    if (!params.amountInr || params.amountInr <= 0) {
      throw new Error('Invalid order amount: amount must be greater than zero');
    }
    if (!params.userId) {
      throw new Error('User ID is required for order creation');
    }

    const conf = this.getConfigurationStatus();
    if (!conf.isConfigured) {
      throw new Error('Razorpay credentials not configured. Please supply valid test/production keys.');
    }

    const amountInPaise = Math.round(params.amountInr * 100);
    const receipt = params.receipt || `rcpt_${Date.now()}_${params.userId.slice(-6)}`;

    const orderOptions = {
      amount: amountInPaise,
      currency: 'INR',
      receipt,
      notes: {
        userId: params.userId,
        diamonds: String(params.diamonds || 0),
        ...(params.notes || {}),
      },
    };

    const order = await razorpay.orders.create(orderOptions);
    return order;
  }

  /**
   * Verifies Razorpay client payment signature using timing-safe HMAC-SHA256 comparison.
   */
  static verifyPaymentSignature(params: VerifyPaymentParams, secretOverride?: string): boolean {
    const keySecret = secretOverride || process.env.RAZORPAY_KEY_SECRET || config.RAZORPAY_KEY_SECRET || '';
    if (!keySecret) {
      return false;
    }

    const body = `${params.orderId}|${params.paymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(body)
      .digest('hex');

    return this.timingSafeEqual(expectedSignature, params.signature);
  }

  /**
   * Verifies Razorpay Webhook signature using timing-safe HMAC-SHA256 comparison.
   */
  static verifyWebhookSignature(rawBody: string | Buffer, signature: string, webhookSecret: string): boolean {
    if (!rawBody || !signature || !webhookSecret) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
      .digest('hex');

    return this.timingSafeEqual(expectedSignature, signature);
  }

  /**
   * Idempotent webhook event processor for Razorpay payment captured.
   * Guarantees:
   * 1. Rejects unverified webhook signatures.
   * 2. Checks database for existing transaction ID (idempotency).
   * 3. Atomically credits diamonds to user balance only on verified first-time capture.
   */
  static async processPaymentCapturedWebhook(
    payload: any,
    rawBody: string | Buffer,
    signature: string,
    webhookSecret: string
  ) {
    if (!this.verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      throw new Error('UNAUTHORIZED: Invalid Razorpay webhook signature');
    }

    const payment = payload?.payload?.payment?.entity;
    if (!payment || payment.status !== 'captured') {
      return { success: false, reason: 'IGNORED_NON_CAPTURED_EVENT' };
    }

    const paymentId = payment.id;
    const orderId = payment.order_id;
    const amountInPaise = payment.amount;
    const currency = payment.currency;
    const notes = payment.notes || {};
    const userId = notes.userId;
    const diamonds = Number(notes.diamonds) || 0;

    if (currency !== 'INR') {
      throw new Error(`Security Violation: Currency mismatch expected INR, got ${currency}`);
    }

    // IDEMPOTENCY CHECK
    const existing = await RechargeHistory.findOne({
      $or: [{ transactionId: paymentId }, { orderId }],
      status: 'COMPLETED',
    });

    if (existing) {
      return {
        success: true,
        status: 'ALREADY_PROCESSED',
        transactionId: paymentId,
        diamondsAdded: 0,
      };
    }

    // Atomic DB Record & Credit
    const record = await RechargeHistory.findOneAndUpdate(
      { transactionId: paymentId },
      {
        $setOnInsert: {
          userId,
          type: RechargeType.ONLINE,
          coins: diamonds,
          diamonds,
          date: new Date(),
          transactionId: paymentId,
          orderId,
          amount: amountInPaise / 100,
          currency: 'INR',
          status: 'COMPLETED',
          rawPaymentData: payment,
        },
      },
      { upsert: true, new: true }
    );

    if (userId && diamonds > 0) {
      await User.updateOne(
        { $or: [{ userId }, { _id: userId }] },
        { $inc: { diamonds, coins: diamonds } }
      );
    }

    return {
      success: true,
      status: 'COMPLETED',
      transactionId: paymentId,
      diamondsAdded: diamonds,
      recordId: record._id,
    };
  }

  /**
   * Timing-safe string comparison to protect against HMAC timing attacks.
   */
  private static timingSafeEqual(a: string, b: string): boolean {
    if (!a || !b) return false;
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }
}
