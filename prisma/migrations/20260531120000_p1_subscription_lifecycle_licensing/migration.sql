-- P1 subscription lifecycle + licensing (additive only — safe, non-destructive).
-- 1. Dedupe tiers so the cron sweep emails each seat/expiry threshold once per crossing.
ALTER TABLE "subscriptions" ADD COLUMN "seatAlertTier" INTEGER;
ALTER TABLE "subscriptions" ADD COLUMN "expiryReminderTier" INTEGER;

-- 2. Optional multi-device limit per activation key. Default 1 preserves the
--    existing single-device lock exactly.
ALTER TABLE "hardware_activation_keys" ADD COLUMN "maxDevices" INTEGER NOT NULL DEFAULT 1;
