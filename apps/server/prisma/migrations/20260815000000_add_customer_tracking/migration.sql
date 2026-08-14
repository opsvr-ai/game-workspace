-- CreateTable
CREATE TABLE "CustomerContact" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "result" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerTrack" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "content" TEXT,
    "images" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerDeleteRequest" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "evidenceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerDeleteRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerContact_studioId_idx" ON "CustomerContact"("studioId");

-- CreateIndex
CREATE INDEX "CustomerContact_companionId_createdAt_idx" ON "CustomerContact"("companionId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerContact_customerId_idx" ON "CustomerContact"("customerId");

-- CreateIndex
CREATE INDEX "CustomerContact_result_idx" ON "CustomerContact"("result");

-- CreateIndex
CREATE INDEX "CustomerTrack_studioId_idx" ON "CustomerTrack"("studioId");

-- CreateIndex
CREATE INDEX "CustomerTrack_companionId_createdAt_idx" ON "CustomerTrack"("companionId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerTrack_customerId_idx" ON "CustomerTrack"("customerId");

-- CreateIndex
CREATE INDEX "CustomerDeleteRequest_studioId_idx" ON "CustomerDeleteRequest"("studioId");

-- CreateIndex
CREATE INDEX "CustomerDeleteRequest_companionId_idx" ON "CustomerDeleteRequest"("companionId");

-- CreateIndex
CREATE INDEX "CustomerDeleteRequest_customerId_idx" ON "CustomerDeleteRequest"("customerId");

-- CreateIndex
CREATE INDEX "CustomerDeleteRequest_status_idx" ON "CustomerDeleteRequest"("status");

-- AddForeignKey
ALTER TABLE "CustomerContact" ADD CONSTRAINT "CustomerContact_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerContact" ADD CONSTRAINT "CustomerContact_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerContact" ADD CONSTRAINT "CustomerContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerTrack" ADD CONSTRAINT "CustomerTrack_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerTrack" ADD CONSTRAINT "CustomerTrack_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerTrack" ADD CONSTRAINT "CustomerTrack_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDeleteRequest" ADD CONSTRAINT "CustomerDeleteRequest_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDeleteRequest" ADD CONSTRAINT "CustomerDeleteRequest_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDeleteRequest" ADD CONSTRAINT "CustomerDeleteRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDeleteRequest" ADD CONSTRAINT "CustomerDeleteRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
