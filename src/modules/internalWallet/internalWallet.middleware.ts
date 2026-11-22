import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// In-memory rate limiting tracker for internal service-to-service calls
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 3000;   // High throughput for live betting/settlement

interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitEntry>();

// Periodic cleanup of rate limit tracker
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}, 60 * 1000).unref();

/**
 * Constant-time string comparison to prevent timing attack side-channels.
 */
export function timingSafeCompare(provided: string, expected: string): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const bufA = Buffer.from(provided, 'utf8');
  const bufB = Buffer.from(expected, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Internal Service Authentication Middleware
 * Enforces x-service-api-key header and validates against server environment secret.
 */
export function internalServiceAuth(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = process.env.INTERNAL_SERVICE_API_KEY || process.env.SERVICE_API_KEY;

  if (!configuredKey || configuredKey.trim().length === 0) {
    console.error('[InternalWalletAuth] FATAL: INTERNAL_SERVICE_API_KEY is not configured in server environment');
    res.status(500).json({
      success: false,
      error: 'Service authentication unconfigured on server',
    });
    return;
  }

  const providedKey = req.headers['x-service-api-key'] as string | undefined;

  if (!providedKey || providedKey.trim().length === 0) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized: Missing x-service-api-key header',
    });
    return;
  }

  const isValid = timingSafeCompare(providedKey.trim(), configuredKey.trim());
  if (!isValid) {
    res.status(403).json({
      success: false,
      error: 'Forbidden: Invalid service API key',
    });
    return;
  }

  // Service Rate Limiting
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let rateEntry = rateLimitMap.get(clientIp);

  if (!rateEntry || now > rateEntry.resetAt) {
    rateEntry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(clientIp, rateEntry);
  } else {
    rateEntry.count++;
    if (rateEntry.count > MAX_REQUESTS_PER_WINDOW) {
      res.status(429).json({
        success: false,
        error: 'Too many requests from internal service. Slow down.',
      });
      return;
    }
  }

  next();
}
