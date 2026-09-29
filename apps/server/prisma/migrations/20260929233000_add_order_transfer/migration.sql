-- 订单转让留痕（老板 2026-09-29）。
--
-- 「抢单超时自动回收」整条删除（stale-grab-sweep 已下线），改由陪玩自己把
-- 「加了很久客户没通过 / 客户不满意」的单转让给别人：
--   fromCompanionId —— 转出方（原持有人），他的接单记录里仍保留这张单
--   toCompanionId   —— 转入方（新持有人），订单的 companionId 会改成他
--   reason          —— 陪玩填的转让原因（可选）
--   createdAt       —— 转让时间，界面上就是给客户 / 客服看的「什么时候转让给谁」
CREATE TABLE "OrderTransfer" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromCompanionId" TEXT,
    "toCompanionId" TEXT,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderTransfer_orderId_idx" ON "OrderTransfer"("orderId");
CREATE INDEX "OrderTransfer_fromCompanionId_idx" ON "OrderTransfer"("fromCompanionId");
CREATE INDEX "OrderTransfer_toCompanionId_idx" ON "OrderTransfer"("toCompanionId");

ALTER TABLE "OrderTransfer" ADD CONSTRAINT "OrderTransfer_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderTransfer" ADD CONSTRAINT "OrderTransfer_fromCompanionId_fkey"
  FOREIGN KEY ("fromCompanionId") REFERENCES "Companion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderTransfer" ADD CONSTRAINT "OrderTransfer_toCompanionId_fkey"
  FOREIGN KEY ("toCompanionId") REFERENCES "Companion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
