import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { writeAudit } from './audit.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function generateRecurringTournaments(actorId?: string) {
  const season = await prisma.season.findFirst({ where: { isActive: true, finalizedAt: null }, orderBy: { startsAt: 'desc' } });
  if (!season) return { created: 0, skipped: 'NO_ACTIVE_SEASON' as const };
  const templates = await prisma.tournamentTemplate.findMany({
    where: { recurrenceEnabled: true, isActive: true, nextStartsAt: { not: null } },
    orderBy: { nextStartsAt: 'asc' }
  });
  let created = 0;
  for (const template of templates) {
    if (!template.nextStartsAt) continue;
    const horizon = Date.now() + template.weeksAhead * WEEK_MS;
    let nextStartsAt = nextFutureWeeklyStart(template.nextStartsAt, new Date());
    let safety = 0;
    while (nextStartsAt.getTime() <= horizon && safety < 26) {
      safety += 1;
      const startsAt = nextStartsAt;
      const result = await withRecurringRetry(async (tx) => {
        const existing = await tx.tournament.findUnique({ where: { templateId_startsAt: { templateId: template.id, startsAt } } });
        if (!existing) {
          await tx.tournament.create({
            data: {
              templateId: template.id,
              seasonId: season.id,
              title: template.title,
              description: template.description,
              location: template.location,
              capacity: template.capacity,
              startsAt
            }
          });
        }
        const following = nextWeeklyStart(startsAt);
        await tx.tournamentTemplate.update({ where: { id: template.id }, data: { nextStartsAt: following } });
        if (!existing) {
          await writeAudit(tx, {
            actorId: actorId ?? null,
            action: 'RECURRING_TOURNAMENT_CREATED',
            entityType: 'TournamentTemplate',
            entityId: template.id,
            summary: `Автоматически создан турнир «${template.title}»`,
            after: { startsAt: startsAt.toISOString(), seasonId: season.id }
          });
        }
        return { wasCreated: !existing, following };
      });
      if (result.wasCreated) created += 1;
      nextStartsAt = result.following;
    }
  }
  return { created, skipped: null };
}

export function nextWeeklyStart(value: Date) {
  return new Date(value.getTime() + WEEK_MS);
}

export function nextFutureWeeklyStart(value: Date, now: Date) {
  let next = value;
  while (next < now) next = nextWeeklyStart(next);
  return next;
}

async function withRecurringRetry<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code);
      if (!retryable || attempt === 3) throw error;
    }
  }
  throw new Error('Recurring tournament generation conflict');
}
