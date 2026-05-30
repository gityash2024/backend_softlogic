-- White-label branding fields on organizations (additive, nullable — safe,
-- non-destructive, no backfill). Surfaced via the user-context API so the
-- apps can read the org's custom brand identity.
ALTER TABLE "organizations"
ADD COLUMN "brandName" TEXT,
ADD COLUMN "brandPrimaryColor" TEXT,
ADD COLUMN "brandAccentColor" TEXT;

-- Track which admin created a subscription so we can email the exact creator
-- on approval/rejection and show "Requested by" in the approval UI.
ALTER TABLE "subscriptions" ADD COLUMN "createdById" TEXT;

CREATE INDEX "subscriptions_createdById_idx" ON "subscriptions"("createdById");

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
