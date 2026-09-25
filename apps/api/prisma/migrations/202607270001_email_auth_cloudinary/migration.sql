ALTER TABLE "User" ALTER COLUMN "telegramId" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "profilePhotoPublicId" TEXT;

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- Email is always normalized to lowercase by the API. This index also protects
-- against case-only duplicates created by direct database access.
CREATE UNIQUE INDEX "User_email_lower_key"
ON "User" (LOWER("email"))
WHERE "email" IS NOT NULL;
