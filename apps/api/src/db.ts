import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { pokerClubPrisma?: PrismaClient };

export const prisma = globalForPrisma.pokerClubPrisma ?? new PrismaClient();
globalForPrisma.pokerClubPrisma = prisma;
