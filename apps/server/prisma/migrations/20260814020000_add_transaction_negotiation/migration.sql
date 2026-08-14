-- Transaction negotiation: admin proposes amount, companion accepts/rejects
ALTER TABLE "Transaction" ADD COLUMN "reviewAmount" DOUBLE PRECISION;
ALTER TABLE "Transaction" ADD COLUMN "reviewNote" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "negotiatedAt" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN "negotiatedById" TEXT;