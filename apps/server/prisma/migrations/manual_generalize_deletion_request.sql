-- 老板 2026-10-11：陪玩端不留任何直接删除按钮 —— 「删除申请」通用化（客户 + 聊天消息）。
-- 线上库没有 _prisma_migrations 历史（表是手工建的），所以走手工 SQL，同
-- manual_add_process_blacklist.sql 的先例。执行前先备份，执行后回读校验。
--
-- 幂等：重复执行不会报错（IF NOT EXISTS / 再次 RENAME 会报错，故只在首次执行）。
--   sudo -n docker exec -i chunlv-postgres psql -U postgres -d chunlv -v ON_ERROR_STOP=1 -f - < 本文件

BEGIN;

-- 先留一份原样备份（出问题能整表还原）
CREATE TABLE IF NOT EXISTS "CustomerDeleteRequest_backup_20261011" AS
  SELECT * FROM "CustomerDeleteRequest";

-- 表改名：Prisma 模型 CustomerDeleteRequest → DeletionRequest（数据不动）
ALTER TABLE "CustomerDeleteRequest" RENAME TO "DeletionRequest";

-- 通用化字段
ALTER TABLE "DeletionRequest" ADD COLUMN IF NOT EXISTS "targetType" TEXT NOT NULL DEFAULT 'CUSTOMER';
ALTER TABLE "DeletionRequest" ADD COLUMN IF NOT EXISTS "targetId" TEXT;
ALTER TABLE "DeletionRequest" ADD COLUMN IF NOT EXISTS "payload" JSONB;

-- 聊天消息删除申请没有客户，customerId 必须放开成可空
ALTER TABLE "DeletionRequest" ALTER COLUMN "customerId" DROP NOT NULL;

-- 老数据（删客户）补上 targetType / targetId
UPDATE "DeletionRequest" SET "targetType" = 'CUSTOMER' WHERE "targetType" IS NULL;
UPDATE "DeletionRequest" SET "targetId" = "customerId" WHERE "targetId" IS NULL AND "customerId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "DeletionRequest_targetType_idx" ON "DeletionRequest"("targetType");

COMMIT;