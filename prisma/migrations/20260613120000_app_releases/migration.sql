CREATE TYPE "AppReleaseEnvironment" AS ENUM ('STAGING', 'PRODUCTION');
CREATE TYPE "AppReleaseBrand" AS ENUM ('SOFTLOGIC', 'AI_SMART_BOARD');
CREATE TYPE "AppReleasePlatform" AS ENUM ('ANDROID', 'WINDOWS');

CREATE TABLE "app_releases" (
  "id" TEXT NOT NULL,
  "environment" "AppReleaseEnvironment" NOT NULL,
  "brand" "AppReleaseBrand" NOT NULL,
  "platform" "AppReleasePlatform" NOT NULL,
  "versionName" TEXT NOT NULL,
  "buildNumber" INTEGER NOT NULL,
  "releaseDate" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "downloadUrl" TEXT NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "app_releases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_releases_environment_brand_platform_buildNumber_key"
  ON "app_releases"("environment", "brand", "platform", "buildNumber");

CREATE INDEX "app_releases_environment_brand_platform_isCurrent_isActive_idx"
  ON "app_releases"("environment", "brand", "platform", "isCurrent", "isActive");

CREATE UNIQUE INDEX "app_releases_current_channel_unique"
  ON "app_releases"("environment", "brand", "platform")
  WHERE "isCurrent" = true;

INSERT INTO "app_releases" (
  "id",
  "environment",
  "brand",
  "platform",
  "versionName",
  "buildNumber",
  "releaseDate",
  "notes",
  "downloadUrl",
  "isCurrent",
  "isActive"
) VALUES
  ('1d47f2d6-6f52-487e-85b7-1e505d8c7c01', 'STAGING', 'SOFTLOGIC', 'ANDROID', '1.0.19', 20, '2026-06-13T00:00:00.000Z', 'Initial managed staging release metadata migrated from the download portal.', 'https://drive.google.com/file/d/1jSHu7_F-Ten2WnO4qbiRMzeIunkgCkRV/view?usp=sharing', true, true),
  ('1d47f2d6-6f52-487e-85b7-1e505d8c7c02', 'STAGING', 'SOFTLOGIC', 'WINDOWS', '1.0.19', 20, '2026-06-13T00:00:00.000Z', 'Initial managed staging release metadata migrated from the download portal.', 'https://drive.google.com/file/d/17rVKqt21yggnrlT2WR3E4RyAuFy0E655/view?usp=sharing', true, true),
  ('1d47f2d6-6f52-487e-85b7-1e505d8c7c03', 'STAGING', 'AI_SMART_BOARD', 'ANDROID', '1.0.19', 20, '2026-06-13T00:00:00.000Z', 'Initial managed staging release metadata migrated from the download portal.', 'https://drive.google.com/file/d/1AOt7N9la5Aa_CWpKUiVOjw_mexMG2FfQ/view?usp=sharing', true, true),
  ('1d47f2d6-6f52-487e-85b7-1e505d8c7c04', 'STAGING', 'AI_SMART_BOARD', 'WINDOWS', '1.0.19', 20, '2026-06-13T00:00:00.000Z', 'Initial managed staging release metadata migrated from the download portal.', 'https://drive.google.com/file/d/1p5QU9HOGSei3KngLoNdlVG7ORzVB0Ypn/view?usp=sharing', true, true),
  ('1d47f2d6-6f52-487e-85b7-1e505d8c7c05', 'PRODUCTION', 'SOFTLOGIC', 'ANDROID', '1.0.19', 20, '2026-06-13T00:00:00.000Z', 'Initial managed production release metadata migrated from the download portal.', 'https://drive.google.com/file/d/1cxYJp_y7TdLuvRZXYamaFdNEoi6HxXgb/view?usp=sharing', true, true),
  ('1d47f2d6-6f52-487e-85b7-1e505d8c7c06', 'PRODUCTION', 'SOFTLOGIC', 'WINDOWS', '1.0.19', 20, '2026-06-13T00:00:00.000Z', 'Initial managed production release metadata migrated from the download portal.', 'https://drive.google.com/file/d/1j8g17WGZ-Ttb-CU_5DQeDQsV1hUJ5uB1/view?usp=sharing', true, true),
  ('1d47f2d6-6f52-487e-85b7-1e505d8c7c07', 'PRODUCTION', 'AI_SMART_BOARD', 'ANDROID', '1.0.19', 20, '2026-06-13T00:00:00.000Z', 'Initial managed production release metadata migrated from the download portal.', 'https://drive.google.com/file/d/1IOU7MZMivVoIEfxUkMB45kZFD5apBwUp/view?usp=sharing', true, true),
  ('1d47f2d6-6f52-487e-85b7-1e505d8c7c08', 'PRODUCTION', 'AI_SMART_BOARD', 'WINDOWS', '1.0.19', 20, '2026-06-13T00:00:00.000Z', 'Initial managed production release metadata migrated from the download portal.', 'https://drive.google.com/file/d/1_hv_K9sZoJLnKbl4FlFUqrvJ5XKfx-Ub/view?usp=sharing', true, true);
