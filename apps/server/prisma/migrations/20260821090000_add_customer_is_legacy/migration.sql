-- 陪玩自行录入的老客户：标记为 legacy，表示首单/续单已在系统外完成，可直接复购。
ALTER TABLE "Customer" ADD COLUMN "isLegacy" BOOLEAN NOT NULL DEFAULT false;
