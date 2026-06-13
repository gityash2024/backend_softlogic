-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "StorageCredentialScope" AS ENUM ('GLOBAL', 'ORGANIZATION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "storage_credential_configs" (
  "id" TEXT NOT NULL,
  "provider" "OrganizationStorageProvider" NOT NULL,
  "scope" "StorageCredentialScope" NOT NULL,
  "organizationId" TEXT,
  "encryptedCredentials" TEXT NOT NULL,
  "configuredById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "storage_credential_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "storage_credential_configs_provider_scope_organizationId_key"
ON "storage_credential_configs"("provider", "scope", "organizationId");

CREATE UNIQUE INDEX IF NOT EXISTS "storage_credential_configs_global_provider_key"
ON "storage_credential_configs"("provider")
WHERE "scope" = 'GLOBAL' AND "organizationId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "storage_credential_configs_org_provider_key"
ON "storage_credential_configs"("provider", "organizationId")
WHERE "scope" = 'ORGANIZATION' AND "organizationId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "storage_credential_configs_scope_idx"
ON "storage_credential_configs"("scope");

CREATE INDEX IF NOT EXISTS "storage_credential_configs_organizationId_idx"
ON "storage_credential_configs"("organizationId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "storage_credential_configs"
  ADD CONSTRAINT "storage_credential_configs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
