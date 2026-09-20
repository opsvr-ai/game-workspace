-- CreateTable
CREATE TABLE IF NOT EXISTS "StudioConfig" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StudioConfig_studioId_idx" ON "StudioConfig"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StudioConfig_studioId_key_key" ON "StudioConfig"("studioId", "key");

-- AddForeignKey
ALTER TABLE "StudioConfig" DROP CONSTRAINT IF EXISTS "StudioConfig_studioId_fkey";
ALTER TABLE "StudioConfig" ADD CONSTRAINT "StudioConfig_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
