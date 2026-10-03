-- 客服 / 店长考勤打卡时间（老板 2026-10-04）
ALTER TABLE "StaffAttendance" ADD COLUMN IF NOT EXISTS "loginAt" TIMESTAMP(3);
ALTER TABLE "StaffAttendance" ADD COLUMN IF NOT EXISTS "logoutAt" TIMESTAMP(3);
