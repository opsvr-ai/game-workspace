-- 清理无人使用的聚合表与字段
DROP TABLE IF EXISTS "RevenueDaily";
DROP TABLE IF EXISTS "StudioDailyStats";
ALTER TABLE "Order" DROP COLUMN IF EXISTS "isOnline";
