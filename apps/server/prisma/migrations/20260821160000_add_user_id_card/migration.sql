-- 客服/店长/老板等非陪玩角色的身份证正反面图片
ALTER TABLE "User" ADD COLUMN "idCardFront" TEXT;
ALTER TABLE "User" ADD COLUMN "idCardBack" TEXT;
