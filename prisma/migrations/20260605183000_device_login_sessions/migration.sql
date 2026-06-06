ALTER TABLE "sessions"
  ALTER COLUMN "refreshToken" DROP NOT NULL,
  ADD COLUMN "clientSessionId" TEXT,
  ADD COLUMN "lastSeenAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "sessions_userId_clientSessionId_key" ON "sessions"("userId", "clientSessionId");
CREATE INDEX "sessions_userId_revokedAt_expiresAt_idx" ON "sessions"("userId", "revokedAt", "expiresAt");
