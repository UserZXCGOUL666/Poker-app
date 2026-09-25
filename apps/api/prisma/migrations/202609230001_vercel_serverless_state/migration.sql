CREATE TABLE "BroadcastDraft" (
  "telegramId" BIGINT NOT NULL,
  "audience" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "text" TEXT,
  "chatId" BIGINT NOT NULL,
  "promptMessageId" BIGINT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BroadcastDraft_pkey" PRIMARY KEY ("telegramId")
);

CREATE TABLE "RateLimitBucket" (
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "BroadcastDraft_expiresAt_idx" ON "BroadcastDraft"("expiresAt");
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
