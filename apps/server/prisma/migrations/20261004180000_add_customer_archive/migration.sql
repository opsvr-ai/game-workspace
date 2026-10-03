-- 客户封存（老板 2026-10-04）：客户一直不通过、小红书也不回 → 封存起来，以后再换陪玩加
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "archivedReason" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "archivedByUserId" TEXT;
CREATE INDEX IF NOT EXISTS "Customer_archivedAt_idx" ON "Customer"("archivedAt");
