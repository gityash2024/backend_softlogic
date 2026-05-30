-- P2 payment history: optional invoice number + billing period on payment
-- transactions (additive only — all nullable, safe, non-destructive).
ALTER TABLE "payment_transactions" ADD COLUMN "invoiceNumber" TEXT;
ALTER TABLE "payment_transactions" ADD COLUMN "periodStart" TIMESTAMP(3);
ALTER TABLE "payment_transactions" ADD COLUMN "periodEnd" TIMESTAMP(3);
