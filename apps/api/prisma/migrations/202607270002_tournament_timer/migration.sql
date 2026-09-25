-- CreateEnum
CREATE TYPE "TournamentTimerStatus" AS ENUM ('READY', 'RUNNING', 'PAUSED', 'FINISHED');

-- CreateEnum
CREATE TYPE "TournamentTimerLevelKind" AS ENUM ('LEVEL', 'BREAK');

-- CreateTable
CREATE TABLE "TournamentTimer" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "status" "TournamentTimerStatus" NOT NULL DEFAULT 'READY',
    "currentLevelIndex" INTEGER NOT NULL DEFAULT 0,
    "remainingSeconds" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentTimer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentTimerLevel" (
    "id" TEXT NOT NULL,
    "timerId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "TournamentTimerLevelKind" NOT NULL DEFAULT 'LEVEL',
    "durationSeconds" INTEGER NOT NULL,
    "smallBlind" INTEGER,
    "bigBlind" INTEGER,
    "ante" INTEGER,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentTimerLevel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TournamentTimer_tournamentId_key" ON "TournamentTimer"("tournamentId");

-- CreateIndex
CREATE INDEX "TournamentTimer_status_updatedAt_idx" ON "TournamentTimer"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentTimerLevel_timerId_position_key" ON "TournamentTimerLevel"("timerId", "position");

-- CreateIndex
CREATE INDEX "TournamentTimerLevel_timerId_position_idx" ON "TournamentTimerLevel"("timerId", "position");

-- AddForeignKey
ALTER TABLE "TournamentTimer" ADD CONSTRAINT "TournamentTimer_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentTimerLevel" ADD CONSTRAINT "TournamentTimerLevel_timerId_fkey" FOREIGN KEY ("timerId") REFERENCES "TournamentTimer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
