-- Drop pool/payment-provider complexity and add cross-platform device-lock fields.
-- This migration is irreversible. Backups are assumed.

-- 1. Purge historical Stripe/Razorpay records before touching enums.
DELETE FROM "payment_transactions" WHERE "provider" IN ('STRIPE','RAZORPAY');
DELETE FROM "checkout_sessions" WHERE "provider" IN ('STRIPE','RAZORPAY');
DELETE FROM "payment_provider_configs" WHERE "provider" IN ('STRIPE','RAZORPAY');

-- 2. Coerce any lingering Stripe/Razorpay billing modes back to manual invoice.
UPDATE "subscriptions" SET "billingMode" = 'MANUAL_INVOICE' WHERE "billingMode" IN ('STRIPE','RAZORPAY');

-- 3. Drop the HardwareLicensePool column and its enum.
ALTER TABLE "hardware_activation_keys" DROP COLUMN "licensePool";
DROP TYPE "HardwareLicensePool";

-- 4. Recreate BillingMode enum without STRIPE/RAZORPAY.
ALTER TYPE "BillingMode" RENAME TO "BillingMode_old";
CREATE TYPE "BillingMode" AS ENUM ('MANUAL_INVOICE');
ALTER TABLE "subscriptions" ALTER COLUMN "billingMode" DROP DEFAULT;
ALTER TABLE "subscriptions"
  ALTER COLUMN "billingMode" TYPE "BillingMode"
  USING ("billingMode"::text::"BillingMode");
ALTER TABLE "subscriptions" ALTER COLUMN "billingMode" SET DEFAULT 'MANUAL_INVOICE';
DROP TYPE "BillingMode_old";

-- 5. Recreate PaymentProvider enum without STRIPE/RAZORPAY.
ALTER TYPE "PaymentProvider" RENAME TO "PaymentProvider_old";
CREATE TYPE "PaymentProvider" AS ENUM ('MANUAL');
ALTER TABLE "payment_provider_configs"
  ALTER COLUMN "provider" TYPE "PaymentProvider"
  USING ("provider"::text::"PaymentProvider");
ALTER TABLE "checkout_sessions"
  ALTER COLUMN "provider" TYPE "PaymentProvider"
  USING ("provider"::text::"PaymentProvider");
ALTER TABLE "payment_transactions"
  ALTER COLUMN "provider" TYPE "PaymentProvider"
  USING ("provider"::text::"PaymentProvider");
DROP TYPE "PaymentProvider_old";

-- 6. Drop teacher/student/parent pool columns from subscriptions.
ALTER TABLE "subscriptions"
  DROP COLUMN "totalTeacherLicenses",
  DROP COLUMN "usedTeacherLicenses",
  DROP COLUMN "totalStudentLicenses",
  DROP COLUMN "usedStudentLicenses",
  DROP COLUMN "totalParentLicenses",
  DROP COLUMN "usedParentLicenses";

-- 7. Add encrypted raw activation key column for reveal-from-admin flows.
ALTER TABLE "hardware_activation_keys"
  ADD COLUMN "activationKeyEncrypted" TEXT;

-- 8. Add cross-platform device-lock columns to hardware_activations.
ALTER TABLE "hardware_activations"
  ADD COLUMN "devicePlatform" TEXT,
  ADD COLUMN "deviceModel" TEXT,
  ADD COLUMN "deviceOsVersion" TEXT,
  ADD COLUMN "deviceMeta" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "firstBoundAt" TIMESTAMP(3),
  ADD COLUMN "lastVerifiedAt" TIMESTAMP(3);

-- 9. Backfill firstBoundAt from createdAt for existing activations.
UPDATE "hardware_activations" SET "firstBoundAt" = "createdAt" WHERE "firstBoundAt" IS NULL;
