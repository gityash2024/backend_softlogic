-- Preserve original identity values while freeing active uniques during safe delete/archive.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "archivedEmail" TEXT;

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "archivedSlug" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "archivedSupportEmail" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "organizations_deletedAt_idx" ON "organizations"("deletedAt");
