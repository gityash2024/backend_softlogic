-- P4 CONTRACTION (destructive). Drops the dead Subscription + PaymentProviderConfig
-- fields that the new code no longer references.
--
-- ⚠️ Apply this ONLY after the new backend (which no longer reads/writes these
-- columns) is deployed. Idempotent guards (IF EXISTS / DROP TYPE IF EXISTS) make
-- re-runs safe. Adding a nullable column back would restore them if ever needed.

-- subscriptions.partnerOrganizationId (FK + index + column)
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_partnerOrganizationId_fkey";
DROP INDEX IF EXISTS "subscriptions_partnerOrganizationId_idx";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "partnerOrganizationId";

-- subscriptions dead config columns
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "billingMode";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "storageLimitBytes";
ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "featureFlags";

-- now-unused enum
DROP TYPE IF EXISTS "BillingMode";

-- unused payment-provider secret columns
ALTER TABLE "payment_provider_configs" DROP COLUMN IF EXISTS "publicKey";
ALTER TABLE "payment_provider_configs" DROP COLUMN IF EXISTS "secretRef";
ALTER TABLE "payment_provider_configs" DROP COLUMN IF EXISTS "webhookSecretRef";
