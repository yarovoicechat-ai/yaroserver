import Redis from 'ioredis';
import { config } from './envConfig';

const redis = new Redis(config.REDIS_URL, {
  keyPrefix: config.REDIS_PREFIX,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on('connect', () => {
  console.log('Redis Connected');
});

redis.on('error', (err) => {
  console.error('Redis Error:', err);
});

export default redis;