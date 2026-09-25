import type { NextFunction, Request, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { adminTelegramIds, env } from '../config.js';
import { prisma } from '../db.js';

type TokenPayload = {
  sub: string;
  telegramId: string | null;
  role: 'PLAYER' | 'ADMIN';
  authMethod?: 'telegram' | 'browser' | 'email';
  sessionId?: string;
};

export function createAccessToken(payload: TokenPayload, expiresIn: SignOptions['expiresIn'] = '7d') {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ message: 'Требуется авторизация' });
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    if (payload.authMethod === 'browser' || payload.authMethod === 'email') {
      if (!payload.sessionId) return res.status(401).json({ message: 'Браузерная сессия недействительна' });
      const session = await prisma.browserSession.findFirst({
        where: { id: payload.sessionId, userId: payload.sub, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true }
      });
      if (!session) return res.status(401).json({ message: 'Браузерный доступ отозван или истёк' });
    }
    req.auth = {
      userId: payload.sub,
      telegramId: payload.telegramId,
      role: payload.role,
      method: payload.authMethod ?? 'telegram',
      sessionId: payload.sessionId
    };
    return next();
  } catch {
    return res.status(401).json({ message: 'Сессия истекла. Войдите повторно.' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.telegramId || !adminTelegramIds.has(req.auth.telegramId)) {
    return res.status(403).json({ message: 'Раздел доступен только администраторам' });
  }
  return next();
}
