CREATE TABLE "TrafficAccount" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "accountId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrafficAccount_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TrafficAccount_studioId_idx" ON "TrafficAccount"("studioId");
CREATE INDEX "TrafficAccount_userId_idx" ON "TrafficAccount"("userId");
ALTER TABLE "TrafficAccount" ADD CONSTRAINT "TrafficAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrafficAccount" ADD CONSTRAINT "TrafficAccount_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
