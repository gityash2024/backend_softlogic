ALTER TABLE "organizations"
ADD COLUMN IF NOT EXISTS "primaryAdminUserId" TEXT,
ADD COLUMN IF NOT EXISTS "storageProviders" "OrganizationStorageProvider"[] NOT NULL DEFAULT ARRAY[]::"OrganizationStorageProvider"[];

UPDATE "organizations"
SET "storageProviders" = ARRAY["storageProvider"]::"OrganizationStorageProvider"[]
WHERE "storageProvider" IS NOT NULL
  AND COALESCE(cardinality("storageProviders"), 0) = 0;

CREATE INDEX IF NOT EXISTS "organizations_primaryAdminUserId_idx"
ON "organizations"("primaryAdminUserId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organizations_primaryAdminUserId_fkey'
  ) THEN
    ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_primaryAdminUserId_fkey"
    FOREIGN KEY ("primaryAdminUserId")
    REFERENCES "users"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;
