CREATE TYPE "PointTransactionType" AS ENUM ('AWARD', 'DEDUCTION', 'CORRECTION');

CREATE TABLE "PointTransaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seasonId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "type" "PointTransactionType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PointTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PointTransaction_amount_nonzero" CHECK ("amount" <> 0),
  CONSTRAINT "PointTransaction_balance_nonnegative" CHECK ("balanceAfter" >= 0),
  CONSTRAINT "PointTransaction_reason_length" CHECK (char_length("reason") BETWEEN 3 AND 160),
  CONSTRAINT "PointTransaction_type_matches_amount" CHECK (
    ("type" = 'AWARD' AND "amount" > 0) OR
    ("type" = 'DEDUCTION' AND "amount" < 0) OR
    ("type" = 'CORRECTION' AND "amount" <> 0)
  )
);

ALTER TABLE "User" ADD CONSTRAINT "User_points_nonnegative" CHECK ("points" >= 0);
ALTER TABLE "TournamentResult" ALTER COLUMN "points" SET DEFAULT 0;

CREATE UNIQUE INDEX "PointTransaction_idempotencyKey_key" ON "PointTransaction"("idempotencyKey");
CREATE INDEX "User_points_createdAt_idx" ON "User"("points", "createdAt");
CREATE INDEX "Season_isActive_startsAt_idx" ON "Season"("isActive", "startsAt");
CREATE INDEX "Tournament_status_startsAt_idx" ON "Tournament"("status", "startsAt");
CREATE INDEX "PointTransaction_userId_seasonId_createdAt_idx" ON "PointTransaction"("userId", "seasonId", "createdAt");
CREATE INDEX "PointTransaction_seasonId_createdAt_idx" ON "PointTransaction"("seasonId", "createdAt");
CREATE INDEX "PointTransaction_createdById_createdAt_idx" ON "PointTransaction"("createdById", "createdAt");

ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
