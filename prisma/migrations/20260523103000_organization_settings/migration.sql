ALTER TABLE "organizations"
ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';
