-- Add PENDING_APPROVAL to the SubscriptionStatus enum.
--
-- Kept in its OWN migration with no other statements on purpose: Postgres
-- cannot use a newly added enum value in the same transaction that adds it,
-- and Prisma only runs an `ALTER TYPE ... ADD VALUE` migration outside a
-- transaction when the file contains nothing else. Do not add other DDL here.
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
