-- 客服跟进台账（老板 2026-09-29）：
-- CustomerFollowUp 原来只有「内容 + 下次要做什么（一句话）」，跟进台账还要显示
-- 「下次跟进（时间）」和「客服工作微信」，所以补两个可空列（不动老数据，老记录就是空）：
--   nextFollowUpAt —— 下次跟进时间（客服记跟进时自己选）
--   workWechatName —— 这次是用哪个客服工作微信加的客户
ALTER TABLE "CustomerFollowUp" ADD COLUMN "nextFollowUpAt" TIMESTAMP(3);
ALTER TABLE "CustomerFollowUp" ADD COLUMN "workWechatName" TEXT;
