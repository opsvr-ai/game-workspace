-- 离职时间：陪玩 / 客服 / 店长通用（老板账号不允许离职）
ALTER TABLE "User" ADD COLUMN "resignedAt" TIMESTAMP(3);

-- 历史数据回填：老的「陪玩离职」只写了 Companion.isResigned，这里统一到 User.resignedAt，
-- 让后续所有「是不是离职了」的判断只看一个字段。
UPDATE "User" u
SET "resignedAt" = NOW()
FROM "Companion" c
WHERE c."userId" = u.id
  AND c."isResigned" = true
  AND u."resignedAt" IS NULL;
