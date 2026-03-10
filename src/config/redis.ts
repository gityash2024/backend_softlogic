import { env } from './env';

// Redis client placeholder — will use ioredis when Redis is needed
// For Phase 1, we use a simple in-memory fallback

export interface RedisConfig {
  url: string;
}

export const redisConfig: RedisConfig = {
  url: env.REDIS_URL,
};

// TODO: Initialize actual Redis client for Phase 2 (real-time features)
console.log('ℹ️  Redis config loaded (connection deferred to when needed)');
