ALTER TABLE "User" ADD COLUMN "nickname" TEXT;
ALTER TABLE "User" ADD COLUMN "profilePhotoData" TEXT;

CREATE UNIQUE INDEX "User_nickname_lower_key"
ON "User" (LOWER("nickname"))
WHERE "nickname" IS NOT NULL;

-- Telegram profile photos were previously copied into photoUrl on every login.
-- From this version photoUrl is reserved for a photo explicitly chosen in Poker Club.
UPDATE "User" SET "photoUrl" = NULL;
