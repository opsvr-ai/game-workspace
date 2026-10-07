-- 2026-10-08 陪玩端「退单」申请（老板）
--
-- 老板原话：「管理端要退款就没有用，陪玩端要退款也没用，最多的情况就是添加成功了，客户没转钱
-- 或者转钱了最后不打了，直接让陪玩上传截图就行了，说明原因，说到这里你在陪玩端＋个按钮「退单」，
-- 就是把我上边说的情况 客户同意了 但是没打成 陪玩点退单，客服端审核 无异议到店长这里
-- 跟 添加失败一个流程。」
--
-- 所以复用「补单申请」这张表（跟「添加失败」同一个审核入口 = 一个流程），只加一个 type 区分：
--   SUPPLEMENT = 陪玩点「添加失败」要名额（原来的那套，一行不动）
--   REFUND     = 陪玩点「退单」：这单没打成，退掉 + 还名额，审核走「客服先核对 → 店长拍板」
-- 加上客服那一段的三个字段（csReviewedAt / csReviewedByUserId / csReviewNote）。
--
-- 另外把 orderId 的单列唯一换成 (orderId, type) 复合唯一：以前一张单只留一条，
-- 加了退单之后一张单要能各留一条「补单」和「退单」，否则退单会被旧记录挡住。
--
-- 幂等：全部 IF NOT EXISTS / DROP INDEX IF EXISTS，重复执行是空操作。

ALTER TABLE "SupplementRequest" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'SUPPLEMENT';
ALTER TABLE "SupplementRequest" ADD COLUMN IF NOT EXISTS "csReviewedAt" TIMESTAMP(3);
ALTER TABLE "SupplementRequest" ADD COLUMN IF NOT EXISTS "csReviewedByUserId" TEXT;
ALTER TABLE "SupplementRequest" ADD COLUMN IF NOT EXISTS "csReviewNote" TEXT;

DROP INDEX IF EXISTS "SupplementRequest_orderId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "SupplementRequest_orderId_type_key"
  ON "SupplementRequest"("orderId", "type");

-- 老行全部按「补单」算（上面 ADD COLUMN ... DEFAULT 'SUPPLEMENT' 已经填好了），不用刷数据。
