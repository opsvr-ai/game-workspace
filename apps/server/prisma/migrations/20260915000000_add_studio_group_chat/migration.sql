-- Studio-wide group chat
ALTER TABLE "ChatRoom" ADD COLUMN IF NOT EXISTS "isGroup" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChatRoom" ADD COLUMN IF NOT EXISTS "groupName" TEXT;
ALTER TABLE "ChatRoom" ADD COLUMN IF NOT EXISTS "groupAvatar" TEXT;

CREATE TABLE IF NOT EXISTS "ChatRoomMember" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readSeq" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatRoomMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatRoomMember_roomId_userId_key" ON "ChatRoomMember"("roomId", "userId");
CREATE INDEX IF NOT EXISTS "ChatRoomMember_userId_idx" ON "ChatRoomMember"("userId");

ALTER TABLE "ChatRoomMember" ADD CONSTRAINT "ChatRoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "ChatRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
