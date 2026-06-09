ALTER TYPE "AiCreditScope" ADD VALUE IF NOT EXISTS 'MASTER';
ALTER TYPE "AiCreditLedgerType" ADD VALUE IF NOT EXISTS 'MASTER_TOP_UP';
ALTER TYPE "AiCreditLedgerType" ADD VALUE IF NOT EXISTS 'ALLOCATION';
ALTER TYPE "AiCreditLedgerType" ADD VALUE IF NOT EXISTS 'RESERVATION';
ALTER TYPE "AiCreditLedgerType" ADD VALUE IF NOT EXISTS 'USAGE_COMMIT';
ALTER TYPE "AiCreditLedgerType" ADD VALUE IF NOT EXISTS 'RESERVATION_REFUND';

ALTER TABLE "ai_credit_accounts"
ADD COLUMN IF NOT EXISTS "parentAccountId" TEXT,
ADD COLUMN IF NOT EXISTS "allocatedTokens" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "usedTokens" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "reservedTokens" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "childAllocatedTokens" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "unlimited" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ai_credit_ledger_entries"
ADD COLUMN IF NOT EXISTS "amountTokens" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "oldTokenBalance" BIGINT,
ADD COLUMN IF NOT EXISTS "newTokenBalance" BIGINT;

CREATE TABLE IF NOT EXISTS "ai_master_configs" (
  "id" TEXT NOT NULL DEFAULT 'master',
  "provider" TEXT NOT NULL DEFAULT 'gemini',
  "geminiApiKeyEncrypted" TEXT,
  "geminiApiKeyFingerprint" TEXT,
  "geminiApiKeyLast4" TEXT,
  "geminiTextModel" TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
  "geminiImageModel" TEXT NOT NULL DEFAULT 'imagen-4.0-generate-001',
  "geminiTtsModel" TEXT NOT NULL DEFAULT 'gemini-2.5-flash-preview-tts',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "lastTestedAt" TIMESTAMP(3),
  "lastTestStatus" TEXT,
  "lastTestMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_master_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_credit_accounts_parentAccountId_idx" ON "ai_credit_accounts"("parentAccountId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_credit_accounts_parentAccountId_fkey'
  ) THEN
    ALTER TABLE "ai_credit_accounts"
    ADD CONSTRAINT "ai_credit_accounts_parentAccountId_fkey"
    FOREIGN KEY ("parentAccountId") REFERENCES "ai_credit_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "ai_master_configs" ("id", "provider", "enabled", "createdAt", "updatedAt")
VALUES ('master', 'gemini', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ai_credit_accounts" ("id", "scope", "allocatedTokens", "status", "createdAt", "updatedAt")
VALUES ('master', 'MASTER', 0, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
