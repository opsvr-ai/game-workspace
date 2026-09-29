-- 「催一下」（老板 2026-09-30）：
-- 线上 / 桥接单还挂着「待反馈」时，发单的客服可以催接单工作室给个说法。
--   feedbackChasedAt   —— 最后一次催的时间
--   feedbackChaseCount —— 一共催过几次（接单方的看板上显示「对方催过 N 次」）
-- 追加式改动，不动老数据；线上是手工 ALTER（这个库没有 _prisma_migrations，历来都是手改表 + prisma generate）。
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "feedbackChasedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "feedbackChaseCount" INTEGER NOT NULL DEFAULT 0;
