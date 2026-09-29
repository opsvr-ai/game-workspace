-- 客服「按人一套提成」（老板 2026-09-30）：CsProfile 加一列 JSON，只存这个人填了的项。
-- 线上这个库没有 _prisma_migrations 表，历来是 schema 改完手工 ALTER + prisma generate，
-- 这份文件是留档用的（新库 / 重放时能照着建）。
ALTER TABLE "CsProfile" ADD COLUMN IF NOT EXISTS "commissionConfig" JSONB;
