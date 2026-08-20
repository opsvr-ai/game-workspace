-- 客户存单：存单余额 + 存单记录 + 会话是否用存单支付
ALTER TABLE "Customer" ADD COLUMN "depositBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "OrderSession" ADD COLUMN "paidByDeposit" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CustomerDeposit" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "companionId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "screenshotUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerDeposit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerDeposit_customerId_idx" ON "CustomerDeposit"("customerId");

ALTER TABLE "CustomerDeposit" ADD CONSTRAINT "CustomerDeposit_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerDeposit" ADD CONSTRAINT "CustomerDeposit_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
