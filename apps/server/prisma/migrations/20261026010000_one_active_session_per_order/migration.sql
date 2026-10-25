-- 同一张订单同一时间只允许一段真正开始计时的 ACTIVE 会话。
-- 双陪是同一段会话上的 companionId + coCompanionId，不会因此误伤。
-- 未开始的待搭档邀请（startedAt IS NULL）不在此约束内。
CREATE UNIQUE INDEX IF NOT EXISTS "OrderSession_one_active_per_order"
ON "OrderSession" ("parentOrderId")
WHERE status = 'ACTIVE' AND "startedAt" IS NOT NULL;
