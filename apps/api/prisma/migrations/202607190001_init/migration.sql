CREATE TYPE "UserRole" AS ENUM ('PLAYER', 'ADMIN');
CREATE TYPE "TournamentStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'FINISHED', 'CANCELLED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "telegramId" BIGINT NOT NULL,
  "username" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT,
  "photoUrl" TEXT,
  "role" "UserRole" NOT NULL DEFAULT 'PLAYER',
  "points" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Season" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tournament" (
  "id" TEXT NOT NULL,
  "seasonId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "location" TEXT,
  "capacity" INTEGER NOT NULL DEFAULT 48,
  "participantCount" INTEGER NOT NULL DEFAULT 0,
  "status" "TournamentStatus" NOT NULL DEFAULT 'UPCOMING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TournamentResult" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "place" INTEGER NOT NULL,
  "points" INTEGER NOT NULL,
  "isFinalTable" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TournamentResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationLog" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "sentCount" INTEGER NOT NULL,
  "failedCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
CREATE INDEX "Tournament_seasonId_startsAt_idx" ON "Tournament"("seasonId", "startsAt");
CREATE UNIQUE INDEX "TournamentResult_tournamentId_userId_key" ON "TournamentResult"("tournamentId", "userId");
CREATE UNIQUE INDEX "TournamentResult_tournamentId_place_key" ON "TournamentResult"("tournamentId", "place");
CREATE INDEX "TournamentResult_userId_createdAt_idx" ON "TournamentResult"("userId", "createdAt");

ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentResult" ADD CONSTRAINT "TournamentResult_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentResult" ADD CONSTRAINT "TournamentResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
