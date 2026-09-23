CREATE TYPE "TournamentPlayerActionType" AS ENUM ('REBUY', 'REENTRY', 'ELIMINATION', 'BOUNTY', 'BONUS_XP');

CREATE TABLE "TournamentPlayerAction" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "createdById" TEXT NOT NULL,
    "type" "TournamentPlayerActionType" NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TournamentPlayerAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TournamentPlayerAction_tournamentId_createdAt_idx" ON "TournamentPlayerAction"("tournamentId", "createdAt");
CREATE INDEX "TournamentPlayerAction_tournamentId_userId_type_createdAt_idx" ON "TournamentPlayerAction"("tournamentId", "userId", "type", "createdAt");
CREATE INDEX "TournamentPlayerAction_targetUserId_createdAt_idx" ON "TournamentPlayerAction"("targetUserId", "createdAt");

ALTER TABLE "TournamentPlayerAction" ADD CONSTRAINT "TournamentPlayerAction_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentPlayerAction" ADD CONSTRAINT "TournamentPlayerAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentPlayerAction" ADD CONSTRAINT "TournamentPlayerAction_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TournamentPlayerAction" ADD CONSTRAINT "TournamentPlayerAction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
