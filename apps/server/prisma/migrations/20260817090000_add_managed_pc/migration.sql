-- CreateTable
CREATE TABLE "ManagedPC" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "loginAccount" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedPC_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagedPC_ip_key" ON "ManagedPC"("ip");
