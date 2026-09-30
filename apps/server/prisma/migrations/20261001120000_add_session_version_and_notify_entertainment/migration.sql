-- 单点登录 + 娱乐中通知开关（老板 2026-10-01）。
-- 线上这个库没有 _prisma_migrations 表，历来是 schema 改完手工 ALTER + prisma generate，
-- 这份文件是留档用的（新库 / 重放时能照着建）。
-- User.sessionVersion：管理 / 客服账号每登录一次 +1，旧令牌就失效（顶号）。
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;
-- Companion.notifyWhileEntertainment：娱乐中是否接收新单弹窗（默认 true）。
ALTER TABLE "Companion" ADD COLUMN IF NOT EXISTS "notifyWhileEntertainment" BOOLEAN NOT NULL DEFAULT true;
