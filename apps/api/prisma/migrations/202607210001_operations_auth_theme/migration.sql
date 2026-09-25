-- One-time browser codes are created only from an authenticated Telegram chat.
CREATE TABLE "BrowserLoginCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrowserLoginCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrowserLoginCode_codeHash_key" ON "BrowserLoginCode"("codeHash");
CREATE INDEX "BrowserLoginCode_userId_expiresAt_idx" ON "BrowserLoginCode"("userId", "expiresAt");
CREATE INDEX "BrowserLoginCode_usedAt_expiresAt_idx" ON "BrowserLoginCode"("usedAt", "expiresAt");

ALTER TABLE "BrowserLoginCode"
ADD CONSTRAINT "BrowserLoginCode_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The accent is global: one administrator choice is used by every client.
ALTER TABLE "ClubSettings"
ADD COLUMN "accentColor" TEXT NOT NULL DEFAULT '#3B8CFF';
