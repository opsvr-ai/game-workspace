-- 陪玩自己提交工作微信 + 管理端审核（老板 2026-10-02）。
--
-- 老板原话：「让陪玩自己填写自己的微信号，但是需要管理端审核，以后想换可以换，
--   但是管理端审核过了以后才显示新的。」
--
-- 设计：这张表只存「申请」。真正生效、界面上显示、抢单判重用的仍是
-- WorkWechat 上绑定的那一条 —— 只有管理端审核通过（approve）时才会去改 WorkWechat，
-- 所以「换了号但还没过审」不会影响当前生效的号。
CREATE TABLE "WorkWechatRequest" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "wechatId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkWechatRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkWechatRequest_studioId_status_idx" ON "WorkWechatRequest"("studioId", "status");
CREATE INDEX "WorkWechatRequest_companionId_status_idx" ON "WorkWechatRequest"("companionId", "status");

ALTER TABLE "WorkWechatRequest" ADD CONSTRAINT "WorkWechatRequest_companionId_fkey"
  FOREIGN KEY ("companionId") REFERENCES "Companion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
