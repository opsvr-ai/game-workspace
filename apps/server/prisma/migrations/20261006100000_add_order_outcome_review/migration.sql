-- 2026-10-06 成交核对（老板）
--
-- 老板原话：「接单方点成功那就推给发单者计入考核；失败的推给发单者+店长。店长最终拍板
-- 这个到底是谁的原因、到底谁的问题，谁的问题就去找谁；失败的还得粘贴上截图。
-- 成功的不用重点追查，重点追查失败的。」
--
-- 所以 Order 上加这几个字段：
--   outcomeEvidence      接单方报「不成功」时粘贴的截图（URL 列表，至少 1 张）
--   reviewStatus         WAITING（待店长拍板）| DECIDED（已拍板）
--   reviewResponsibility COMPANION | CS | CUSTOMER | NONE —— 到底谁的问题
--   reviewNote           店长的结论 / 追责说明
--   reviewByUserId / reviewAt
--
-- 幂等：IF NOT EXISTS，重复执行是空操作。

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "outcomeEvidence" JSONB;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "reviewResponsibility" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "reviewByUserId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "reviewAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Order_reviewStatus_idx" ON "Order"("reviewStatus");
