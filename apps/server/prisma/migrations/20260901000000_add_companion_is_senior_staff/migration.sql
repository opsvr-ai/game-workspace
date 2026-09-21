-- 手动标记老员工：true 时跳过 6 个月工龄门槛
ALTER TABLE "Companion" ADD COLUMN "isSeniorStaff" BOOLEAN NOT NULL DEFAULT false;
