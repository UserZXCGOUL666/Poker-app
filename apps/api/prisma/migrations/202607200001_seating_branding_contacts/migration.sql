-- Player contact is stored only after an explicit Telegram confirmation.
ALTER TABLE "User"
ADD COLUMN "phoneNumber" TEXT,
ADD COLUMN "phoneSharedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- Publication state is kept on the tournament so unpublished drafts stay private.
ALTER TABLE "Tournament"
ADD COLUMN "seatingPublishedAt" TIMESTAMP(3),
ADD COLUMN "seatingVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "TournamentTable" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TournamentTable_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TournamentSeat" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seatNumber" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TournamentSeat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClubSettings" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "ratingBannerImageData" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClubSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TournamentTable_tournamentId_number_key" ON "TournamentTable"("tournamentId", "number");
CREATE INDEX "TournamentTable_tournamentId_number_idx" ON "TournamentTable"("tournamentId", "number");
CREATE UNIQUE INDEX "TournamentSeat_tournamentId_userId_key" ON "TournamentSeat"("tournamentId", "userId");
CREATE UNIQUE INDEX "TournamentSeat_tableId_seatNumber_key" ON "TournamentSeat"("tableId", "seatNumber");
CREATE INDEX "TournamentSeat_tournamentId_tableId_idx" ON "TournamentSeat"("tournamentId", "tableId");
CREATE INDEX "TournamentSeat_userId_assignedAt_idx" ON "TournamentSeat"("userId", "assignedAt");

ALTER TABLE "TournamentTable"
ADD CONSTRAINT "TournamentTable_tournamentId_fkey"
FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TournamentSeat"
ADD CONSTRAINT "TournamentSeat_tournamentId_fkey"
FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TournamentSeat"
ADD CONSTRAINT "TournamentSeat_tableId_fkey"
FOREIGN KEY ("tableId") REFERENCES "TournamentTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TournamentSeat"
ADD CONSTRAINT "TournamentSeat_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
