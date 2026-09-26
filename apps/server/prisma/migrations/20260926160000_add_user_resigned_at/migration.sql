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

-- 上面这些人当初走的是老代码：只写了 Companion.isResigned，既没停账号、也没释放工位和微信，
-- 所以再补齐到「离职」应有的状态（线上 2026-09-26 已按老办法手动执行）。
UPDATE "User"
SET "isAuthorized" = false
WHERE "resignedAt" IS NOT NULL AND "isAuthorized" = true;

DELETE FROM "CompanionPC"
WHERE "companionId" IN (
  SELECT c.id FROM "Companion" c JOIN "User" u ON u.id = c."userId" WHERE u."resignedAt" IS NOT NULL
);

UPDATE "WorkWechat"
SET "companionId" = NULL, status = 'AVAILABLE'
WHERE "companionId" IN (
  SELECT c.id FROM "Companion" c JOIN "User" u ON u.id = c."userId" WHERE u."resignedAt" IS NOT NULL
);
