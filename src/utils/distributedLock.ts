import { randomBytes } from 'crypto';

export interface RedisLockClient {
  set: (...args: any[]) => Promise<any>;
  eval: (...args: any[]) => Promise<any>;
}

export class LockUnavailableError extends Error {
  constructor(key: string) {
    super(`Could not acquire lock: ${key}`);
    this.name = 'LockUnavailableError';
  }
}

export interface DistributedLockOptions {
  ttlMs?: number;
  waitMs?: number;
  retryDelayMs?: number;
}

export const withDistributedLock = async <T>(
  redis: RedisLockClient,
  key: string,
  task: () => Promise<T>,
  { ttlMs = 15_000, waitMs = 0, retryDelayMs = 25 }: DistributedLockOptions = {},
): Promise<T> => {
  const token = randomBytes(16).toString('hex');
  const deadline = Date.now() + Math.max(0, waitMs);
  let acquired = false;

  while (!acquired) {
    acquired = (await redis.set(key, token, 'PX', ttlMs, 'NX')) === 'OK';
    if (acquired) break;
    if (Date.now() >= deadline) throw new LockUnavailableError(key);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  try {
    return await task();
  } finally {
    try {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        key,
        token,
      );
    } catch {
      // The key expires on its own if Redis becomes unavailable during release.
    }
  }
};
