-- 陪玩综合评分加分项
ALTER TABLE "Companion" ADD COLUMN "bonusScore" INTEGER NOT NULL DEFAULT 0;

-- 陪玩战绩图提交（小红书素材）
CREATE TABLE "BattleScreenshot" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "customerId" TEXT,
    "images" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BattleScreenshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BattleScreenshot_studioId_idx" ON "BattleScreenshot"("studioId");
CREATE INDEX "BattleScreenshot_companionId_idx" ON "BattleScreenshot"("companionId");
CREATE INDEX "BattleScreenshot_status_idx" ON "BattleScreenshot"("status");

ALTER TABLE "BattleScreenshot" ADD CONSTRAINT "BattleScreenshot_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BattleScreenshot" ADD CONSTRAINT "BattleScreenshot_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BattleScreenshot" ADD CONSTRAINT "BattleScreenshot_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BattleScreenshot" ADD CONSTRAINT "BattleScreenshot_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
