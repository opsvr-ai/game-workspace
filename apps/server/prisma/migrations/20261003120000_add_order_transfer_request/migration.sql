-- 订单转让申请（老板 2026-10-03：「想转让的订单，需要被转让方同意才能过来，要不然乱套了」）
-- 只放「申请」，OrderTransfer 仍然是唯一的转让留痕表（同意后才写）。
CREATE TABLE "OrderTransferRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromCompanionId" TEXT NOT NULL,
    "toCompanionId" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "OrderTransferRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderTransferRequest_orderId_idx" ON "OrderTransferRequest"("orderId");
CREATE INDEX "OrderTransferRequest_toCompanionId_status_idx" ON "OrderTransferRequest"("toCompanionId", "status");
CREATE INDEX "OrderTransferRequest_fromCompanionId_status_idx" ON "OrderTransferRequest"("fromCompanionId", "status");
CREATE INDEX "OrderTransferRequest_status_createdAt_idx" ON "OrderTransferRequest"("status", "createdAt");
