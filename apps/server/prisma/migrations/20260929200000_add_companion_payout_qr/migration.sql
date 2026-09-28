-- 报账微信码（老板 2026-09-29）：
-- 每个陪玩在「报账」那里留一个位置放自己的收款码图片，财务报账 / 发工资时点开扫一扫就能转钱。
-- Companion 补两个可空列（不动老数据，没传过就是空）：
--   payoutQrUrl       —— 收款码图片地址（走 /upload/screenshot 上传）
--   payoutQrUpdatedAt —— 最后一次更换的时间
ALTER TABLE "Companion" ADD COLUMN "payoutQrUrl" TEXT;
ALTER TABLE "Companion" ADD COLUMN "payoutQrUpdatedAt" TIMESTAMP(3);
