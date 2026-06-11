CREATE TABLE IF NOT EXISTS "ai_google_billing_configs" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "projectId" TEXT NOT NULL DEFAULT 'softlogic-496310',
  "billingTableProjectId" TEXT,
  "billingDatasetId" TEXT,
  "billingTableName" TEXT,
  "monthlyCapMicros" BIGINT NOT NULL DEFAULT 50000000,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "lastSyncAt" TIMESTAMP(3),
  "lastSyncStatus" TEXT,
  "lastSyncMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_google_billing_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ai_google_billing_sync_runs" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "billingTable" TEXT,
  "googleSpendMicros" BIGINT NOT NULL DEFAULT 0,
  "softlogicSpendMicros" BIGINT NOT NULL DEFAULT 0,
  "varianceMicros" BIGINT NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ai_google_billing_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_google_billing_sync_runs_month_idx" ON "ai_google_billing_sync_runs"("month");
CREATE INDEX IF NOT EXISTS "ai_google_billing_sync_runs_status_idx" ON "ai_google_billing_sync_runs"("status");

CREATE TABLE IF NOT EXISTS "ai_google_billing_daily_costs" (
  "id" TEXT NOT NULL,
  "usageDate" TIMESTAMP(3) NOT NULL,
  "month" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "serviceDescription" TEXT NOT NULL,
  "skuDescription" TEXT NOT NULL,
  "costMicros" BIGINT NOT NULL DEFAULT 0,
  "creditsMicros" BIGINT NOT NULL DEFAULT 0,
  "netCostMicros" BIGINT NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "usageAmount" DOUBLE PRECISION,
  "usageUnit" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_google_billing_daily_costs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_google_billing_daily_costs_usageDate_projectId_serviceDescription_skuDescription_key"
  ON "ai_google_billing_daily_costs"("usageDate", "projectId", "serviceDescription", "skuDescription");
CREATE INDEX IF NOT EXISTS "ai_google_billing_daily_costs_month_idx" ON "ai_google_billing_daily_costs"("month");
CREATE INDEX IF NOT EXISTS "ai_google_billing_daily_costs_projectId_idx" ON "ai_google_billing_daily_costs"("projectId");

INSERT INTO "ai_google_billing_configs" (
  "id",
  "enabled",
  "projectId",
  "monthlyCapMicros",
  "currency",
  "createdAt",
  "updatedAt"
)
VALUES (
  'default',
  false,
  'softlogic-496310',
  50000000,
  'USD',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
