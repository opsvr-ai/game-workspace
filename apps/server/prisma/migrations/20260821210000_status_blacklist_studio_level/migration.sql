-- 状态黑名单改为工作室级别，不再按单个陪玩配置
DROP TABLE IF EXISTS "CompanionStatusBlacklist";

CREATE TABLE "CompanionStatusBlacklist" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "processName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompanionStatusBlacklist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanionStatusBlacklist_studioId_status_processName_key" ON "CompanionStatusBlacklist"("studioId", "status", "processName");
CREATE INDEX "CompanionStatusBlacklist_studioId_status_idx" ON "CompanionStatusBlacklist"("studioId", "status");

ALTER TABLE "CompanionStatusBlacklist" ADD CONSTRAINT "CompanionStatusBlacklist_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
