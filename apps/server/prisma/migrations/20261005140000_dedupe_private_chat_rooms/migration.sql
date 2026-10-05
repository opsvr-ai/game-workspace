-- 2026-10-05 私聊「一个联系人一个会话」修复
--
-- 症状：张钊 跟 孙可馨 那边一个联系人有两个聊天框；孙可馨在人员列表看到张钊有红点，
--       点进去却没看到张钊发的消息。
-- 根因：ChatService.getOrCreateRoom 是「先 findFirst 再 create」，没有唯一约束兜底。
--       并发（双击沟通、订单页+人员列表同时开、两个标签页、socket 重连）时两边都查不到、
--       都去 create，于是同一个人建出两个房间 —— 库里重复房间的 createdAt 精确到毫秒紧挨着。
--       消息被拆进两个房间：红点按「全部房间未读之和」算，点开却只进 findFirst 命中的那一个，
--       所以「有红点、打开没消息」。
-- 处理：先把已有重复房间合并成一个（消息一条不丢、按时间重排 seq、重算已读位），
--       再建唯一索引，从根上杜绝再次发生。
-- 幂等：没有重复时几乎全是空操作，索引用 IF NOT EXISTS。

BEGIN;

-- 1) 找出「一对人」的重复私聊房间，rn=1 为保留房间
--    保留标准：消息最多 → 最近有消息 → 建得最晚（信息最全）
DROP TABLE IF EXISTS _chat_merge_rooms;
CREATE TEMP TABLE _chat_merge_rooms ON COMMIT DROP AS
SELECT r.id,
       r."participantA",
       r."participantB",
       r."aReadSeq",
       r."bReadSeq",
       r."lastMessageAt",
       r."createdAt",
       r."pinned",
       r."archived",
       r."orderInfo",
       row_number() OVER (
         PARTITION BY r."participantA", r."participantB"
         ORDER BY (SELECT count(*) FROM "ChatMessageV3" m WHERE m."roomId" = r.id) DESC,
                  r."lastMessageAt" DESC NULLS LAST,
                  r."createdAt" DESC,
                  r.id
       ) AS rn
FROM "ChatRoom" r
WHERE r."isGroup" = false
  AND EXISTS (
    SELECT 1 FROM "ChatRoom" r2
    WHERE r2."isGroup" = false
      AND r2."participantA" = r."participantA"
      AND r2."participantB" = r."participantB"
      AND r2.id <> r.id
  );

-- 2) 为每个消息算好「合并后房间里的新 seq」（按 createdAt 全局重排）
DROP TABLE IF EXISTS _chat_msg_map;
CREATE TEMP TABLE _chat_msg_map ON COMMIT DROP AS
SELECT m.id AS msg_id,
       m."roomId" AS old_room,
       c.id AS new_room,
       m.seq AS old_seq,
       row_number() OVER (PARTITION BY c.id ORDER BY m."createdAt", m.id) AS new_seq
FROM "ChatMessageV3" m
JOIN _chat_merge_rooms d ON d.id = m."roomId"
JOIN _chat_merge_rooms c
  ON c."participantA" = d."participantA"
 AND c."participantB" = d."participantB"
 AND c.rn = 1;

-- 3) 两段式搬迁：先统一抬到高位段（避开 (roomId, seq) 唯一约束的临时冲突），再落到最终 seq
UPDATE "ChatMessageV3" m
SET "roomId" = mm.new_room,
    seq = 1000000 + mm.new_seq
FROM _chat_msg_map mm
WHERE m.id = mm.msg_id;

UPDATE "ChatMessageV3" m
SET seq = mm.new_seq
FROM _chat_msg_map mm
WHERE m.id = mm.msg_id;

-- 4) 重算每个保留房间的 lastMessageSeq / 已读位 / 预览 / 置顶归档 / 当前订单
UPDATE "ChatRoom" r
SET "lastMessageSeq" = agg.cnt,
    "aReadSeq" = agg.a_read,
    "bReadSeq" = agg.b_read,
    "lastMessageAt" = agg.last_at,
    "pinned" = agg.pinned,
    "archived" = agg.archived,
    "orderInfo" = COALESCE(agg.order_info, r."orderInfo")
FROM (
  SELECT d."participantA" AS pa,
         d."participantB" AS pb,
         count(mm.msg_id) AS cnt,
         max(d."lastMessageAt") AS last_at,
         bool_or(d."pinned") AS pinned,
         bool_or(d."archived") AS archived,
         (array_agg(d."orderInfo" ORDER BY d."lastMessageAt" DESC NULLS LAST, d."createdAt" DESC)
            FILTER (WHERE d."orderInfo" IS NOT NULL))[1] AS order_info,
         -- 已读位：各房间里「读到的那条消息」在新序号下的位置，取最大的（读得最多的那个）
         COALESCE(max(CASE WHEN d."aReadSeq" > 0 AND mm.old_seq IS NOT NULL AND mm.old_seq <= d."aReadSeq"
                           THEN mm.new_seq END), 0) AS a_read,
         COALESCE(max(CASE WHEN d."bReadSeq" > 0 AND mm.old_seq IS NOT NULL AND mm.old_seq <= d."bReadSeq"
                           THEN mm.new_seq END), 0) AS b_read
  FROM _chat_merge_rooms d
  LEFT JOIN _chat_msg_map mm ON mm.old_room = d.id
  GROUP BY d."participantA", d."participantB"
) agg
WHERE r."participantA" = agg.pa
  AND r."participantB" = agg.pb
  AND r."isGroup" = false
  AND r.id IN (SELECT id FROM _chat_merge_rooms WHERE rn = 1);

-- 5) 房间预览改成合并后最后一条消息
UPDATE "ChatRoom" r
SET "lastMessage" = COALESCE(left(lm.content, 100),
                             CASE WHEN lm.type IS NOT NULL THEN '[' || lm.type || ']' ELSE r."lastMessage" END)
FROM (
  SELECT DISTINCT ON (m."roomId") m."roomId", m.content, m.type
  FROM "ChatMessageV3" m
  JOIN _chat_merge_rooms c ON c.id = m."roomId" AND c.rn = 1
  ORDER BY m."roomId", m.seq DESC
) lm
WHERE r.id = lm."roomId";

-- 6) 删掉多余房间（消息已全部搬走；成员关系随外键级联）
DELETE FROM "ChatRoom" WHERE id IN (SELECT id FROM _chat_merge_rooms WHERE rn > 1);

-- 7) 唯一索引：一对人只能有一个私聊房间（群聊不受影响，因为群聊 isGroup = true）
CREATE UNIQUE INDEX IF NOT EXISTS "ChatRoom_private_pair_key"
  ON "ChatRoom" ("participantA", "participantB")
  WHERE "isGroup" = false;

COMMIT;
