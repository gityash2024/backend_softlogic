CREATE TABLE IF NOT EXISTS "ai_model_pricing" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'gemini',
  "modelId" TEXT NOT NULL,
  "billingType" TEXT NOT NULL DEFAULT 'token',
  "inputUsdMicrosPerMillion" INTEGER NOT NULL DEFAULT 0,
  "outputUsdMicrosPerMillion" INTEGER NOT NULL DEFAULT 0,
  "imageUsdMicrosEach" INTEGER NOT NULL DEFAULT 0,
  "searchUsdMicrosPerThousand" INTEGER NOT NULL DEFAULT 0,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_model_pricing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_model_pricing_modelId_key" ON "ai_model_pricing"("modelId");
CREATE INDEX IF NOT EXISTS "ai_model_pricing_provider_idx" ON "ai_model_pricing"("provider");
CREATE INDEX IF NOT EXISTS "ai_model_pricing_billingType_idx" ON "ai_model_pricing"("billingType");

ALTER TABLE "ai_credit_ledger_entries"
ADD COLUMN IF NOT EXISTS "inputTokens" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "outputTokens" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "thinkingTokens" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "totalTokens" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "imageCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "searchGroundingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "estimatedCostMicros" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "modelId" TEXT,
ADD COLUMN IF NOT EXISTS "pricingSnapshot" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "ai_credit_ledger_entries_modelId_idx" ON "ai_credit_ledger_entries"("modelId");

INSERT INTO "ai_model_pricing" (
  "id",
  "provider",
  "modelId",
  "billingType",
  "inputUsdMicrosPerMillion",
  "outputUsdMicrosPerMillion",
  "imageUsdMicrosEach",
  "searchUsdMicrosPerThousand",
  "enabled",
  "createdAt",
  "updatedAt"
)
VALUES
  ('pricing-gemini-3-5-flash', 'gemini', 'gemini-3.5-flash', 'token', 1500000, 9000000, 0, 14000000, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pricing-gemini-2-5-flash', 'gemini', 'gemini-2.5-flash', 'token', 300000, 2500000, 0, 35000000, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pricing-gemini-2-5-flash-preview-tts', 'gemini', 'gemini-2.5-flash-preview-tts', 'audio', 500000, 10000000, 0, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('pricing-imagen-4-0-generate-001', 'gemini', 'imagen-4.0-generate-001', 'image', 0, 0, 40000, 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("modelId") DO UPDATE SET
  "provider" = EXCLUDED."provider",
  "billingType" = EXCLUDED."billingType",
  "inputUsdMicrosPerMillion" = EXCLUDED."inputUsdMicrosPerMillion",
  "outputUsdMicrosPerMillion" = EXCLUDED."outputUsdMicrosPerMillion",
  "imageUsdMicrosEach" = EXCLUDED."imageUsdMicrosEach",
  "searchUsdMicrosPerThousand" = EXCLUDED."searchUsdMicrosPerThousand",
  "enabled" = EXCLUDED."enabled",
  "updatedAt" = CURRENT_TIMESTAMP;
