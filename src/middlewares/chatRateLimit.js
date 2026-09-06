import { CHAT_RATE_LIMIT, redis } from '../config/redis.js';

export const chatRateLimit = async (req, res, next) => {
  try {
    const forwarded = req.headers['x-forwarded-for'];

    const ip = forwarded ? forwarded.split(',')[0].trim() : req.ip;

    const key = `chat-rate-limit:${ip}`;

    const count = Number(await redis.get(key)) || 0;

    if (count >= CHAT_RATE_LIMIT) {
      const ttl = await redis.ttl(key);

      return res.status(429).json({
        message: `Ви використали ${CHAT_RATE_LIMIT} запитів. Спробуйте знову через ${Math.ceil(
          ttl / 60,
        )} хв.`,
        products: [],
        rateLimited: true,
        retryAfterSeconds: ttl,
      });
    }

    req.chatRateLimitKey = key;

    next();
  } catch (error) {
    console.error('Chat rate limit error:', error);
    next();
  }
};
