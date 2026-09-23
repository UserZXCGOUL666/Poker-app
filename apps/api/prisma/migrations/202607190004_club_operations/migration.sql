CREATE TYPE "TournamentRegistrationStatus" AS ENUM ('REGISTERED', 'WAITLISTED', 'CHECKED_IN', 'PLAYED', 'CANCELLED');
CREATE TYPE "ReasonPresetKind" AS ENUM ('AWARD', 'DEDUCTION', 'BOTH');

ALTER TABLE "User" ADD COLUMN "adminNote" TEXT;

ALTER TABLE "Season"
  ADD COLUMN "finalizedAt" TIMESTAMP(3),
  ADD COLUMN "finalizedById" TEXT;

ALTER TABLE "Tournament"
  ADD COLUMN "registrationClosed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "registrationDeadline" TIMESTAMP(3),
  ADD COLUMN "templateId" TEXT;

ALTER TABLE "PointTransaction"
  ADD COLUMN "batchId" TEXT,
  ADD COLUMN "reversalOfId" TEXT;

CREATE TABLE "PointBatch" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT,
  "createdById" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PointBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TournamentRegistration" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "TournamentRegistrationStatus" NOT NULL DEFAULT 'REGISTERED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "promotedAt" TIMESTAMP(3),
  "checkedInAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "TournamentRegistration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TournamentTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "location" TEXT,
  "capacity" INTEGER NOT NULL DEFAULT 48,
  "recurrenceEnabled" BOOLEAN NOT NULL DEFAULT false,
  "nextStartsAt" TIMESTAMP(3),
  "weeksAhead" INTEGER NOT NULL DEFAULT 4,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReasonPreset" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "kind" "ReasonPresetKind" NOT NULL DEFAULT 'BOTH',
  "defaultAmount" INTEGER,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReasonPreset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerTag" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '#3b8cff',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerTag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserTag" (
  "userId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  CONSTRAINT "UserTag_pkey" PRIMARY KEY ("userId", "tagId")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "summary" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeasonStanding" (
  "id" TEXT NOT NULL,
  "seasonId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "points" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeasonStanding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PointBatch_idempotencyKey_key" ON "PointBatch"("idempotencyKey");
CREATE UNIQUE INDEX "PointBatch_tournamentId_key" ON "PointBatch"("tournamentId");
CREATE INDEX "PointBatch_createdById_createdAt_idx" ON "PointBatch"("createdById", "createdAt");

CREATE UNIQUE INDEX "TournamentRegistration_tournamentId_userId_key" ON "TournamentRegistration"("tournamentId", "userId");
CREATE INDEX "TournamentRegistration_tournamentId_status_createdAt_idx" ON "TournamentRegistration"("tournamentId", "status", "createdAt");
CREATE INDEX "TournamentRegistration_userId_createdAt_idx" ON "TournamentRegistration"("userId", "createdAt");

CREATE INDEX "TournamentTemplate_recurrenceEnabled_isActive_nextStartsAt_idx" ON "TournamentTemplate"("recurrenceEnabled", "isActive", "nextStartsAt");
CREATE INDEX "ReasonPreset_isActive_sortOrder_idx" ON "ReasonPreset"("isActive", "sortOrder");
CREATE UNIQUE INDEX "PlayerTag_name_key" ON "PlayerTag"("name");
CREATE INDEX "UserTag_tagId_userId_idx" ON "UserTag"("tagId", "userId");

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

CREATE UNIQUE INDEX "SeasonStanding_seasonId_userId_key" ON "SeasonStanding"("seasonId", "userId");
CREATE UNIQUE INDEX "SeasonStanding_seasonId_rank_key" ON "SeasonStanding"("seasonId", "rank");
CREATE INDEX "SeasonStanding_userId_createdAt_idx" ON "SeasonStanding"("userId", "createdAt");

CREATE UNIQUE INDEX "PointTransaction_reversalOfId_key" ON "PointTransaction"("reversalOfId");
CREATE INDEX "PointTransaction_batchId_createdAt_idx" ON "PointTransaction"("batchId", "createdAt");
CREATE INDEX "Tournament_templateId_startsAt_idx" ON "Tournament"("templateId", "startsAt");
CREATE UNIQUE INDEX "Tournament_templateId_startsAt_key" ON "Tournament"("templateId", "startsAt");

ALTER TABLE "Season" ADD CONSTRAINT "Season_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TournamentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PointBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "PointTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PointBatch" ADD CONSTRAINT "PointBatch_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PointBatch" ADD CONSTRAINT "PointBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentRegistration" ADD CONSTRAINT "TournamentRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTag" ADD CONSTRAINT "UserTag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTag" ADD CONSTRAINT "UserTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "PlayerTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SeasonStanding" ADD CONSTRAINT "SeasonStanding_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeasonStanding" ADD CONSTRAINT "SeasonStanding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "ReasonPreset" ("id", "label", "reason", "kind", "sortOrder", "updatedAt") VALUES
  ('reason-participation', 'Участие', 'Участие в турнире', 'AWARD', 10, CURRENT_TIMESTAMP),
  ('reason-podium', 'Призовое место', 'Призовое место', 'AWARD', 20, CURRENT_TIMESTAMP),
  ('reason-bonus', 'Бонус', 'Бонус клуба', 'AWARD', 30, CURRENT_TIMESTAMP),
  ('reason-correction', 'Корректировка', 'Корректировка результата', 'BOTH', 40, CURRENT_TIMESTAMP),
  ('reason-violation', 'Нарушение', 'Нарушение регламента', 'DEDUCTION', 50, CURRENT_TIMESTAMP);
