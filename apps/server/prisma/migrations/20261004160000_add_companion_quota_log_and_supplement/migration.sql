-- 陪玩「每日抢单名额」流水台账 + 补单申请 / 到期核查（老板 2026-10-04）

CREATE TABLE IF NOT EXISTS "CompanionQuotaLog" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "studioId" TEXT,
  "delta" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "refId" TEXT,
  "note" TEXT,
  "dayKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanionQuotaLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CompanionQuotaLog_companionId_createdAt_idx" ON "CompanionQuotaLog"("companionId", "createdAt");
CREATE INDEX IF NOT EXISTS "CompanionQuotaLog_studioId_dayKey_idx" ON "CompanionQuotaLog"("studioId", "dayKey");

CREATE TABLE IF NOT EXISTS "SupplementRequest" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "studioId" TEXT,
  "reason" TEXT,
  "evidenceUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "reviewDueAt" TIMESTAMP(3),
  "reviewStatus" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplementRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SupplementRequest_orderId_key" ON "SupplementRequest"("orderId");
CREATE INDEX IF NOT EXISTS "SupplementRequest_studioId_status_idx" ON "SupplementRequest"("studioId", "status");
CREATE INDEX IF NOT EXISTS "SupplementRequest_companionId_createdAt_idx" ON "SupplementRequest"("companionId", "createdAt");
CREATE INDEX IF NOT EXISTS "SupplementRequest_status_reviewDueAt_idx" ON "SupplementRequest"("status", "reviewDueAt");
