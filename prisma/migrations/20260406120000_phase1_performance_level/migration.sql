CREATE TYPE "PerformanceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

ALTER TABLE "user_settings"
ADD COLUMN "performanceLevel" "PerformanceLevel" NOT NULL DEFAULT 'HIGH';

UPDATE "user_settings"
SET "performanceLevel" = CASE
  WHEN "performanceMode" = true THEN 'LOW'::"PerformanceLevel"
  ELSE 'HIGH'::"PerformanceLevel"
END;
