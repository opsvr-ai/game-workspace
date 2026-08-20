-- 服务时长到点提醒：记录该会话是否已推送过「时间到了」提醒，避免重复推送
ALTER TABLE "OrderSession" ADD COLUMN "durationRemindedAt" TIMESTAMP(3);
