-- Admin content S3 indexing: persist original import files and richer export metadata.

CREATE TYPE "ContentImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'CONVERTED', 'FAILED');

ALTER TABLE "exports"
  ADD COLUMN "storageKey" TEXT,
  ADD COLUMN "mimeType" TEXT,
  ADD COLUMN "fileName" TEXT;

CREATE TABLE "content_imports" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "userRole" "UserRole" NOT NULL,
  "organizationId" TEXT,
  "sourceName" TEXT NOT NULL,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "storageKey" TEXT,
  "publicUrl" TEXT,
  "status" "ContentImportStatus" NOT NULL DEFAULT 'PENDING',
  "error" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "convertedAt" TIMESTAMP(3),

  CONSTRAINT "content_imports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_imports_userId_idx" ON "content_imports"("userId");
CREATE INDEX "content_imports_organizationId_idx" ON "content_imports"("organizationId");
CREATE INDEX "content_imports_status_idx" ON "content_imports"("status");
CREATE INDEX "content_imports_storageKey_idx" ON "content_imports"("storageKey");

ALTER TABLE "content_imports"
  ADD CONSTRAINT "content_imports_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "content_imports"
  ADD CONSTRAINT "content_imports_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
