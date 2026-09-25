import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

type AuditDb = Prisma.TransactionClient | typeof prisma;

export type AuditInput = {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
};

export function writeAudit(db: AuditDb, input: AuditInput) {
  return db.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      summary: input.summary,
      before: input.before,
      after: input.after,
      metadata: input.metadata
    }
  });
}
