CREATE TYPE "AiFeatureUsageAttemptStatus" AS ENUM ('RESERVED', 'COMMITTED', 'FAILED');

CREATE TABLE IF NOT EXISTS "ai_feature_usage_attempts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "featureKey" TEXT NOT NULL,
  "status" "AiFeatureUsageAttemptStatus" NOT NULL DEFAULT 'RESERVED',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_feature_usage_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_feature_usage_attempts_userId_featureKey_status_createdAt_idx"
  ON "ai_feature_usage_attempts"("userId", "featureKey", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_feature_usage_attempts_featureKey_createdAt_idx"
  ON "ai_feature_usage_attempts"("featureKey", "createdAt");

ALTER TABLE "ai_feature_usage_attempts"
  ADD CONSTRAINT "ai_feature_usage_attempts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
