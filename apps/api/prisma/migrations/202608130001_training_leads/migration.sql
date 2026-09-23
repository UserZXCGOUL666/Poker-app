ALTER TABLE "ClubSettings"
  ADD COLUMN "trainingSheetUrl" TEXT,
  ADD COLUMN "trainingLeadPopupEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TrainingLead" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "preferredContactAt" TEXT NOT NULL,
  "preferredVisitAt" TEXT NOT NULL,
  "sheetSyncedAt" TIMESTAMP(3),
  "sheetSyncError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrainingLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrainingLead_userId_createdAt_idx" ON "TrainingLead"("userId", "createdAt");
CREATE INDEX "TrainingLead_createdAt_idx" ON "TrainingLead"("createdAt");
CREATE INDEX "TrainingLead_sheetSyncedAt_createdAt_idx" ON "TrainingLead"("sheetSyncedAt", "createdAt");

ALTER TABLE "TrainingLead"
  ADD CONSTRAINT "TrainingLead_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
