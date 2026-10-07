import { timingSafeEqual } from 'node:crypto';
import createHttpError from 'http-errors';

export const requireAdmin = (req, res, next) => {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return next(createHttpError(503, 'Catalog administration is not configured'));
  const supplied = req.get('authorization')?.replace(/^Bearer /, '') || '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return next(createHttpError(401, 'Unauthorized'));
  }
  next();
};
