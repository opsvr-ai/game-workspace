-- CS self-claim / lead handling fields
ALTER TABLE "Order" ADD COLUMN "claimedCsUserId" TEXT;
ALTER TABLE "Order" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "csWorkWechatId" TEXT;
ALTER TABLE "Order" ADD COLUMN "csWorkWechatName" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerPaidTo" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerPaymentAccountId" TEXT;
ALTER TABLE "Order" ADD COLUMN "customerPaymentAccountName" TEXT;

CREATE INDEX "Order_claimedCsUserId_idx" ON "Order"("claimedCsUserId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_claimedCsUserId_fkey" FOREIGN KEY ("claimedCsUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
