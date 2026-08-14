-- finance-reconciliation P0: price rules, payment reconciliation, commission, settlement snapshot

-- StudioPaymentAccount: bind a companion to an employee payment code
ALTER TABLE "StudioPaymentAccount" ADD COLUMN "companionId" TEXT;
CREATE INDEX "StudioPaymentAccount_companionId_idx" ON "StudioPaymentAccount"("companionId");
ALTER TABLE "StudioPaymentAccount" ADD CONSTRAINT "StudioPaymentAccount_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Order: finance audit fields
ALTER TABLE "Order" ADD COLUMN "auditStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN "auditAmountCents" INTEGER;
ALTER TABLE "Order" ADD COLUMN "transferTotalCents" INTEGER;

-- PriceRule
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "studioId" TEXT,
    "gameName" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL DEFAULT 'PLAY_WITH',
    "mode" TEXT NOT NULL,
    "orderType" TEXT NOT NULL DEFAULT 'FIRST',
    "floorPrice" INTEGER NOT NULL,
    "maxPrice" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PriceRule_studioId_gameName_mode_orderType_idx" ON "PriceRule"("studioId","gameName","mode","orderType");
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- MerchantPaymentRecord
CREATE TABLE "MerchantPaymentRecord" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "paymentAccountId" TEXT NOT NULL,
    "companionId" TEXT,
    "amount" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'IMPORT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MerchantPaymentRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MerchantPaymentRecord_studioId_paidAt_idx" ON "MerchantPaymentRecord"("studioId","paidAt");
CREATE INDEX "MerchantPaymentRecord_companionId_paidAt_idx" ON "MerchantPaymentRecord"("companionId","paidAt");
CREATE INDEX "MerchantPaymentRecord_paymentAccountId_idx" ON "MerchantPaymentRecord"("paymentAccountId");
ALTER TABLE "MerchantPaymentRecord" ADD CONSTRAINT "MerchantPaymentRecord_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantPaymentRecord" ADD CONSTRAINT "MerchantPaymentRecord_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "StudioPaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchantPaymentRecord" ADD CONSTRAINT "MerchantPaymentRecord_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CommissionRule
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CS',
    "basis" TEXT NOT NULL DEFAULT 'CLAIMED_AMOUNT',
    "type" TEXT NOT NULL DEFAULT 'RATE',
    "rate" DOUBLE PRECISION,
    "fixedAmount" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CommissionRule_studioId_role_idx" ON "CommissionRule"("studioId","role");
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CommissionLedger
CREATE TABLE "CommissionLedger" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "basisValue" DOUBLE PRECISION NOT NULL,
    "amount" INTEGER NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommissionLedger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommissionLedger_studioId_ruleId_userId_month_key" ON "CommissionLedger"("studioId","ruleId","userId","month");
ALTER TABLE "CommissionLedger" ADD CONSTRAINT "CommissionLedger_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionLedger" ADD CONSTRAINT "CommissionLedger_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CommissionRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionLedger" ADD CONSTRAINT "CommissionLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SettlementSnapshot
CREATE TABLE "SettlementSnapshot" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "monthlyRevenue" INTEGER NOT NULL,
    "companionPct" INTEGER NOT NULL,
    "companionShare" INTEGER NOT NULL,
    "studioShare" INTEGER NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SettlementSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SettlementSnapshot_studioId_companionId_month_key" ON "SettlementSnapshot"("studioId","companionId","month");
ALTER TABLE "SettlementSnapshot" ADD CONSTRAINT "SettlementSnapshot_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SettlementSnapshot" ADD CONSTRAINT "SettlementSnapshot_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
