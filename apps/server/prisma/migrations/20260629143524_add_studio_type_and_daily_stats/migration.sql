-- AlterTable
ALTER TABLE "Studio" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'DIRECT';

-- CreateTable
CREATE TABLE "StudioDailyStats" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "studioId" TEXT NOT NULL,
    "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "onlineCompanions" INTEGER NOT NULL DEFAULT 0,
    "totalCompanions" INTEGER NOT NULL DEFAULT 0,
    "acceptRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "entertainmentFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioDailyStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudioDailyStats_date_studioId_key" ON "StudioDailyStats"("date", "studioId");
