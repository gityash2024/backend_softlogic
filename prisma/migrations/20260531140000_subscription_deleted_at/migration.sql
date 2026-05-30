-- P4 soft-delete parity: archive marker for subscriptions (additive, nullable,
-- safe — the live backend ignores the new column until the new code ships).
ALTER TABLE "subscriptions" ADD COLUMN "deletedAt" TIMESTAMP(3);
