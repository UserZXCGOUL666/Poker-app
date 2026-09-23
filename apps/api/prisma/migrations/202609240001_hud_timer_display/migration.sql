-- HUD redesign: persistent tournament display messages and new default accent.
ALTER TABLE "TournamentTimer"
  ADD COLUMN "topTicker" TEXT,
  ADD COLUMN "bottomTicker" TEXT,
  ADD COLUMN "tickerSpeed" INTEGER NOT NULL DEFAULT 28;

ALTER TABLE "ClubSettings"
  ALTER COLUMN "accentColor" SET DEFAULT '#FF3D0A';

UPDATE "ClubSettings"
SET "accentColor" = '#FF3D0A'
WHERE "accentColor" = '#3B8CFF';
