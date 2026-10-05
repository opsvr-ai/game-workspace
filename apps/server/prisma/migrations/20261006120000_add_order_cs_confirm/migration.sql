-- 2026-10-06 成交核对：失败单先由发单客服跟接单方核对（老板）
--
-- 老板原话：「要不要在『成交核对 → 待拍板』里加一步：失败单先由发单客服点
-- 『已跟接单方确认、双方无异议』，才轮到店长审核拍板？（现在是从接单方报失败就直接落到店长那里。）」
--   → 「肯定呀，他们不跟发单者掰扯明白，直接进店长 那不把店长累死」
--
-- 所以 Order 上加这三个字段，reviewStatus 也多两个取值：
--   CS_CONFIRMING  接单方已报「不成功」，等发单客服跟接单方核对
--   CS_CONFIRMED   发单客服已确认「双方无异议」，等店长拍板
--   csConfirmedAt / csConfirmedByUserId / csConfirmNote
--
-- 幂等：IF NOT EXISTS，重复执行是空操作。

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "csConfirmedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "csConfirmedByUserId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "csConfirmNote" TEXT;

-- 已有的待拍板失败单（reviewStatus 为 NULL / 'WAITING'）继续按「等客服核对」处理，不用刷数据。
