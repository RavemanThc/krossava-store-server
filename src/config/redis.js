import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
export const CHAT_RATE_LIMIT = 6;
export const CHAT_RATE_LIMIT_WINDOW = 30 * 60;
