-- CreateTable
CREATE TABLE "TenantAuthorization" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "csUserId" TEXT NOT NULL,
    "canViewPlayers" BOOLEAN NOT NULL DEFAULT false,
    "canViewOrders" BOOLEAN NOT NULL DEFAULT false,
    "canViewAlerts" BOOLEAN NOT NULL DEFAULT false,
    "canHandleOrders" BOOLEAN NOT NULL DEFAULT false,
    "canDispatchOrders" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkWechat" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "wechatId" TEXT NOT NULL,
    "companionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkWechat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantAuthorization_studioId_csUserId_key" ON "TenantAuthorization"("studioId", "csUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkWechat_wechatId_key" ON "WorkWechat"("wechatId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkWechat_companionId_key" ON "WorkWechat"("companionId");

-- AddForeignKey
ALTER TABLE "WorkWechat" ADD CONSTRAINT "WorkWechat_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
