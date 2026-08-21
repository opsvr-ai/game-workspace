-- 待禁用进程名单（工作室级，采集后先挑选到这里，再分配到各状态）
CREATE TABLE "ProcessPendingDisable" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "processName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessPendingDisable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcessPendingDisable_studioId_processName_key" ON "ProcessPendingDisable"("studioId", "processName");
CREATE INDEX "ProcessPendingDisable_studioId_idx" ON "ProcessPendingDisable"("studioId");

ALTER TABLE "ProcessPendingDisable" ADD CONSTRAINT "ProcessPendingDisable_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
