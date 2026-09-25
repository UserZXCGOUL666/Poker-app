import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';

type Options = {
  namespace: string;
  windowMs: number;
  limit: number;
  message: string;
};

function requestFingerprint(req: Request) {
  const raw = [req.ip || req.socket.remoteAddress || 'unknown', req.get('user-agent') || 'unknown'].join('|');
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

export function databaseRateLimit(options: Options) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const windowStartMs = Math.floor(now / options.windowMs) * options.windowMs;
    const resetAt = windowStartMs + options.windowMs;
    const key = `${options.namespace}:${requestFingerprint(req)}:${windowStartMs}`;

    try {
      const bucket = await prisma.rateLimitBucket.upsert({
        where: { key },
        create: {
          key,
          count: 1,
          expiresAt: new Date(resetAt + options.windowMs)
        },
        update: { count: { increment: 1 } }
      });

      const remaining = Math.max(0, options.limit - bucket.count);
      res.setHeader('RateLimit-Limit', String(options.limit));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

      if (bucket.count > options.limit) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
        return res.status(429).json({ message: options.message });
      }
      return next();
    } catch (error) {
      console.error('Database rate limiter failed open', error);
      return next();
    }
  };
}
