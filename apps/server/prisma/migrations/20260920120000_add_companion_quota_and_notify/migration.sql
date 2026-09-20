-- 每日「立即打」抢单名额（按下等马/中等马/上等马发放，未用完自动累计）
ALTER TABLE "Companion" ADD COLUMN IF NOT EXISTS "quotaBalance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Companion" ADD COLUMN IF NOT EXISTS "quotaGrantedThrough" TIMESTAMP(3);
-- 打单中 / 娱乐中是否也接收新单弹窗（默认不打扰）
ALTER TABLE "Companion" ADD COLUMN IF NOT EXISTS "notifyWhileBusy" BOOLEAN NOT NULL DEFAULT false;

-- 流水门槛已被「每日名额」取代
DELETE FROM "SystemConfig" WHERE key = 'revenue.unlock_threshold';

-- 新单弹窗停留秒数（原来写死 15 秒）
INSERT INTO "SystemConfig" (key, value, "updatedAt")
VALUES ('pool.popup_seconds', '20'::jsonb, now())
ON CONFLICT (key) DO NOTHING;
