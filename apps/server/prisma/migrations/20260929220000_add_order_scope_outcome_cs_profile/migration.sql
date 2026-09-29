-- 派单范围 + 结果反馈 + 客服档位（老板 2026-09-29 定的三件事，一次改完）：
--
-- 1) 每张单「先给谁抢」：
--    poolScope             —— OFFLINE_FIRST（默认/空，先给本店线下）| ONLINE_FIRST（先给桥接 + 线上俱乐部，
--                             本店线下陪玩先看不见）
--    releasedToOfflineAt   —— ONLINE_FIRST 的单被客服/店长手动放给本店线下的时间
--                             （自动放行走 pool.online_first_release_minutes 配置，不写库）
-- 2) 线上 / 桥接单的接单方反馈（线下单不用，点了「开始首单」就算成功）：
--    outcome               —— SUCCESS | FAILED，空 = 待反馈
--    outcomeReason / outcomeNote / outcomeByUserId / outcomeAt
-- 3) 客服档位 CsProfile：按人存默认派单范围 + 底薪（没建过档的客服走老口径）。
ALTER TABLE "Order" ADD COLUMN "poolScope" TEXT;
ALTER TABLE "Order" ADD COLUMN "releasedToOfflineAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "outcome" TEXT;
ALTER TABLE "Order" ADD COLUMN "outcomeReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "outcomeNote" TEXT;
ALTER TABLE "Order" ADD COLUMN "outcomeByUserId" TEXT;
ALTER TABLE "Order" ADD COLUMN "outcomeAt" TIMESTAMP(3);

CREATE TABLE "CsProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "poolScope" TEXT NOT NULL DEFAULT 'OFFLINE_FIRST',
    "baseSalaryYuan" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CsProfile_userId_key" ON "CsProfile"("userId");
CREATE INDEX "CsProfile_studioId_idx" ON "CsProfile"("studioId");
