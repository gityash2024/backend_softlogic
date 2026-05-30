ALTER TYPE "UserRole" ADD VALUE 'PARENT';

CREATE TYPE "BrandingMode" AS ENUM ('SOFTLOGIC', 'SOFTLOGIC_PARTNER', 'WHITE_LABEL', 'MULTI_BRAND');
CREATE TYPE "OrganizationStorageProvider" AS ENUM ('GOOGLE_DRIVE', 'DROPBOX', 'ONEDRIVE');
CREATE TYPE "OrganizationStorageStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'CONNECTED', 'INVALID');
CREATE TYPE "BillingMode" AS ENUM ('MANUAL_INVOICE', 'STRIPE', 'RAZORPAY');
CREATE TYPE "ParentStudentLinkStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'RAZORPAY', 'MANUAL');
CREATE TYPE "PaymentProviderMode" AS ENUM ('TEST', 'LIVE');
CREATE TYPE "CheckoutSessionStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELED');
CREATE TYPE "PaymentTransactionStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'MANUAL_APPROVED');
CREATE TYPE "HardwareLicensePool" AS ENUM ('TEACHER', 'STUDENT', 'PARENT');
CREATE TYPE "HardwareActivationKeyStatus" AS ENUM ('AVAILABLE', 'BOUND', 'DISABLED', 'EXPIRED');
CREATE TYPE "HardwareActivationStatus" AS ENUM ('ACTIVE', 'RESET_REQUESTED', 'RESET', 'DISABLED');
CREATE TYPE "AiCreditScope" AS ENUM ('ORGANIZATION', 'USER', 'HARDWARE');
CREATE TYPE "AiCreditAccountStatus" AS ENUM ('ACTIVE', 'EXHAUSTED', 'DISABLED');
CREATE TYPE "AiCreditLedgerType" AS ENUM ('INCLUDED', 'USAGE', 'MANUAL_EXTENSION', 'ADJUSTMENT');
CREATE TYPE "TermsDocumentType" AS ENUM ('TERMS', 'PRIVACY');

ALTER TABLE "organizations"
ADD COLUMN "brandingMode" "BrandingMode" NOT NULL DEFAULT 'SOFTLOGIC',
ADD COLUMN "studentLoginEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "parentLoginEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "sessionOnlyJoinEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "teacherOnlyMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "supportEmail" TEXT,
ADD COLUMN "supportPhone" TEXT,
ADD COLUMN "storageProvider" "OrganizationStorageProvider",
ADD COLUMN "storageStatus" "OrganizationStorageStatus" NOT NULL DEFAULT 'NOT_CONFIGURED';

ALTER TABLE "subscriptions"
ADD COLUMN "partnerOrganizationId" TEXT,
ADD COLUMN "billingMode" "BillingMode" NOT NULL DEFAULT 'MANUAL_INVOICE',
ADD COLUMN "brandingMode" "BrandingMode" NOT NULL DEFAULT 'SOFTLOGIC',
ADD COLUMN "totalTeacherLicenses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "usedTeacherLicenses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "totalStudentLicenses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "usedStudentLicenses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "totalParentLicenses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "usedParentLicenses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "storageLimitBytes" BIGINT,
ADD COLUMN "featureFlags" JSONB NOT NULL DEFAULT '{}';

UPDATE "subscriptions"
SET
  "totalTeacherLicenses" = GREATEST("seatLimit", 0),
  "usedTeacherLicenses" = GREATEST("seatUsage", 0)
WHERE "totalTeacherLicenses" = 0 AND "seatLimit" > 0;

ALTER TABLE "subscriptions"
ADD CONSTRAINT "subscriptions_partnerOrganizationId_fkey"
FOREIGN KEY ("partnerOrganizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "subscriptions_partnerOrganizationId_idx" ON "subscriptions"("partnerOrganizationId");

CREATE TABLE "parent_student_links" (
  "id" TEXT NOT NULL,
  "parentUserId" TEXT NOT NULL,
  "studentUserId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "status" "ParentStudentLinkStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "parent_student_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "parent_student_links_parentUserId_studentUserId_organizationId_key" ON "parent_student_links"("parentUserId", "studentUserId", "organizationId");
CREATE INDEX "parent_student_links_organizationId_idx" ON "parent_student_links"("organizationId");
CREATE INDEX "parent_student_links_studentUserId_idx" ON "parent_student_links"("studentUserId");
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_studentUserId_fkey" FOREIGN KEY ("studentUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "parent_student_links" ADD CONSTRAINT "parent_student_links_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "organization_storage_connections" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" "OrganizationStorageProvider" NOT NULL,
  "status" "OrganizationStorageStatus" NOT NULL DEFAULT 'PENDING',
  "encryptedTokens" TEXT,
  "externalAccountEmail" TEXT,
  "rootFolderId" TEXT,
  "connectedById" TEXT,
  "validatedAt" TIMESTAMP(3),
  "disconnectedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_storage_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organization_storage_connections_organizationId_provider_key" ON "organization_storage_connections"("organizationId", "provider");
CREATE INDEX "organization_storage_connections_status_idx" ON "organization_storage_connections"("status");
ALTER TABLE "organization_storage_connections" ADD CONSTRAINT "organization_storage_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_storage_connections" ADD CONSTRAINT "organization_storage_connections_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payment_provider_configs" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "mode" "PaymentProviderMode" NOT NULL DEFAULT 'TEST',
  "publicKey" TEXT,
  "secretRef" TEXT,
  "webhookSecretRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_provider_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_provider_configs_provider_key" ON "payment_provider_configs"("provider");

CREATE TABLE "checkout_sessions" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "providerConfigId" TEXT,
  "organizationId" TEXT,
  "subscriptionId" TEXT,
  "status" "CheckoutSessionStatus" NOT NULL DEFAULT 'PENDING',
  "checkoutUrl" TEXT,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdById" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "checkout_sessions_organizationId_idx" ON "checkout_sessions"("organizationId");
CREATE INDEX "checkout_sessions_subscriptionId_idx" ON "checkout_sessions"("subscriptionId");
CREATE INDEX "checkout_sessions_status_idx" ON "checkout_sessions"("status");
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "payment_provider_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payment_transactions" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "providerConfigId" TEXT,
  "checkoutSessionId" TEXT,
  "organizationId" TEXT,
  "subscriptionId" TEXT,
  "status" "PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "externalPaymentId" TEXT,
  "referenceNote" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "recordedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payment_transactions_organizationId_idx" ON "payment_transactions"("organizationId");
CREATE INDEX "payment_transactions_subscriptionId_idx" ON "payment_transactions"("subscriptionId");
CREATE INDEX "payment_transactions_status_idx" ON "payment_transactions"("status");
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_providerConfigId_fkey" FOREIGN KEY ("providerConfigId") REFERENCES "payment_provider_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_checkoutSessionId_fkey" FOREIGN KEY ("checkoutSessionId") REFERENCES "checkout_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "hardware_activation_keys" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "licensePool" "HardwareLicensePool" NOT NULL DEFAULT 'TEACHER',
  "activationKeyHash" TEXT NOT NULL,
  "label" TEXT,
  "status" "HardwareActivationKeyStatus" NOT NULL DEFAULT 'AVAILABLE',
  "assignedUserId" TEXT,
  "createdById" TEXT NOT NULL,
  "boundActivationId" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hardware_activation_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hardware_activation_keys_activationKeyHash_key" ON "hardware_activation_keys"("activationKeyHash");
CREATE INDEX "hardware_activation_keys_organizationId_idx" ON "hardware_activation_keys"("organizationId");
CREATE INDEX "hardware_activation_keys_subscriptionId_idx" ON "hardware_activation_keys"("subscriptionId");
CREATE INDEX "hardware_activation_keys_status_idx" ON "hardware_activation_keys"("status");
ALTER TABLE "hardware_activation_keys" ADD CONSTRAINT "hardware_activation_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hardware_activation_keys" ADD CONSTRAINT "hardware_activation_keys_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hardware_activation_keys" ADD CONSTRAINT "hardware_activation_keys_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hardware_activation_keys" ADD CONSTRAINT "hardware_activation_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "hardware_activations" (
  "id" TEXT NOT NULL,
  "activationKeyId" TEXT NOT NULL,
  "userId" TEXT,
  "organizationId" TEXT NOT NULL,
  "deviceFingerprintHash" TEXT NOT NULL,
  "deviceLabel" TEXT,
  "status" "HardwareActivationStatus" NOT NULL DEFAULT 'ACTIVE',
  "resetRequestedAt" TIMESTAMP(3),
  "resetApprovedAt" TIMESTAMP(3),
  "resetApprovedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "hardware_activations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hardware_activations_activationKeyId_deviceFingerprintHash_key" ON "hardware_activations"("activationKeyId", "deviceFingerprintHash");
CREATE INDEX "hardware_activations_organizationId_idx" ON "hardware_activations"("organizationId");
CREATE INDEX "hardware_activations_userId_idx" ON "hardware_activations"("userId");
ALTER TABLE "hardware_activations" ADD CONSTRAINT "hardware_activations_activationKeyId_fkey" FOREIGN KEY ("activationKeyId") REFERENCES "hardware_activation_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hardware_activations" ADD CONSTRAINT "hardware_activations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hardware_activations" ADD CONSTRAINT "hardware_activations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hardware_activations" ADD CONSTRAINT "hardware_activations_resetApprovedById_fkey" FOREIGN KEY ("resetApprovedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hardware_activation_keys" ADD CONSTRAINT "hardware_activation_keys_boundActivationId_fkey" FOREIGN KEY ("boundActivationId") REFERENCES "hardware_activations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ai_credit_accounts" (
  "id" TEXT NOT NULL,
  "scope" "AiCreditScope" NOT NULL,
  "organizationId" TEXT,
  "userId" TEXT,
  "hardwareActivationKeyId" TEXT,
  "balanceMinor" INTEGER NOT NULL DEFAULT 0,
  "includedMinor" INTEGER NOT NULL DEFAULT 70000,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" "AiCreditAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_credit_accounts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_credit_accounts_organizationId_idx" ON "ai_credit_accounts"("organizationId");
CREATE INDEX "ai_credit_accounts_userId_idx" ON "ai_credit_accounts"("userId");
CREATE INDEX "ai_credit_accounts_scope_idx" ON "ai_credit_accounts"("scope");
ALTER TABLE "ai_credit_accounts" ADD CONSTRAINT "ai_credit_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_credit_accounts" ADD CONSTRAINT "ai_credit_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_credit_accounts" ADD CONSTRAINT "ai_credit_accounts_hardwareActivationKeyId_fkey" FOREIGN KEY ("hardwareActivationKeyId") REFERENCES "hardware_activation_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ai_credit_ledger_entries" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "type" "AiCreditLedgerType" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "oldBalanceMinor" INTEGER NOT NULL,
  "newBalanceMinor" INTEGER NOT NULL,
  "reason" TEXT,
  "referenceNote" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_credit_ledger_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_credit_ledger_entries_accountId_idx" ON "ai_credit_ledger_entries"("accountId");
CREATE INDEX "ai_credit_ledger_entries_actorUserId_idx" ON "ai_credit_ledger_entries"("actorUserId");
ALTER TABLE "ai_credit_ledger_entries" ADD CONSTRAINT "ai_credit_ledger_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ai_credit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_credit_ledger_entries" ADD CONSTRAINT "ai_credit_ledger_entries_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "terms_acceptances" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT,
  "documentType" "TermsDocumentType" NOT NULL,
  "documentVersion" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "terms_acceptances_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "terms_acceptances_userId_idx" ON "terms_acceptances"("userId");
CREATE INDEX "terms_acceptances_organizationId_idx" ON "terms_acceptances"("organizationId");
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "terms_acceptances" ADD CONSTRAINT "terms_acceptances_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "live_session_guest_participants" (
  "id" TEXT NOT NULL,
  "liveSessionId" TEXT NOT NULL,
  "organizationId" TEXT,
  "displayName" TEXT,
  "joinTokenHash" TEXT NOT NULL,
  "role" "LiveSessionParticipantRole" NOT NULL DEFAULT 'STUDENT',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "joinedAt" TIMESTAMP(3),
  "leftAt" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "live_session_guest_participants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "live_session_guest_participants_joinTokenHash_key" ON "live_session_guest_participants"("joinTokenHash");
CREATE INDEX "live_session_guest_participants_liveSessionId_idx" ON "live_session_guest_participants"("liveSessionId");
CREATE INDEX "live_session_guest_participants_organizationId_idx" ON "live_session_guest_participants"("organizationId");
ALTER TABLE "live_session_guest_participants" ADD CONSTRAINT "live_session_guest_participants_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "live_session_guest_participants" ADD CONSTRAINT "live_session_guest_participants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
