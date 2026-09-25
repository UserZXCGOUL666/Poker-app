CREATE TABLE "BrowserAccessInvite" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrowserAccessInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrowserSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrowserSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrowserAccessInvite_tokenHash_key" ON "BrowserAccessInvite"("tokenHash");
CREATE INDEX "BrowserAccessInvite_userId_expiresAt_idx" ON "BrowserAccessInvite"("userId", "expiresAt");
CREATE INDEX "BrowserAccessInvite_createdById_createdAt_idx" ON "BrowserAccessInvite"("createdById", "createdAt");
CREATE INDEX "BrowserSession_userId_expiresAt_idx" ON "BrowserSession"("userId", "expiresAt");
CREATE INDEX "BrowserSession_revokedAt_expiresAt_idx" ON "BrowserSession"("revokedAt", "expiresAt");

ALTER TABLE "BrowserAccessInvite" ADD CONSTRAINT "BrowserAccessInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrowserAccessInvite" ADD CONSTRAINT "BrowserAccessInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BrowserSession" ADD CONSTRAINT "BrowserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
