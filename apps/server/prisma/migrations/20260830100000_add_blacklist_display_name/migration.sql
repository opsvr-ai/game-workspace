-- 状态黑名单/待禁用名单增加中文显示名（杀进程仍用英文 exe，展示用中文名）
ALTER TABLE "ProcessPendingDisable" ADD COLUMN "displayName" TEXT;
ALTER TABLE "CompanionStatusBlacklist" ADD COLUMN "displayName" TEXT;
