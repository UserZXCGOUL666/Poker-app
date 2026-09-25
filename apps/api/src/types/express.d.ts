import type { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        telegramId: string | null;
        role: UserRole;
        method: 'telegram' | 'browser' | 'email';
        sessionId?: string;
      };
    }
  }
}

export {};
