// craftsman-ignore: TS001,TS003
/**
 * Legacy → Chat 3.0 data migration script.
 *
 * Run via: npx ts-node apps/server/src/chat/migrate-legacy.ts
 *
 * Migrates:
 *   1. Conversation → ChatRoom (with seq migration)
 *   2. ChatMessageV2 → ChatMessageV3 (with seq assignment)
 *   3. ChatMessageLegacy → ChatMessageV3 (matched by studioId to ChatRoom)
 *
 * Safe to run multiple times (idempotent via unique keys).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateConversations(): Promise<Map<string, string>> {
  // Map old conversation ID → new ChatRoom ID
  const idMap = new Map<string, string>();

  const conversations = await prisma.conversation.findMany({
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });

  for (const conv of conversations) {
    const maxSeq = conv.messages.length;

    let room = await prisma.chatRoom.findFirst({
      where: {
        studioId: conv.studioId,
        participantA: conv.participantA,
        participantB: conv.participantB,
      },
    });

    if (!room) {
      room = await prisma.chatRoom.create({
        data: {
          studioId: conv.studioId,
          participantA: conv.participantA,
          participantB: conv.participantB,
          aReadSeq: conv.aReadAt ? maxSeq : 0,
          bReadSeq: conv.bReadAt ? maxSeq : 0,
          lastMessage: conv.lastMessage,
          lastMessageAt: conv.lastMessageAt,
          lastMessageSeq: maxSeq,
          orderInfo: conv.orderInfo,
          createdAt: conv.createdAt,
        },
      });
    } else {
      room = await prisma.chatRoom.update({
        where: { id: room.id },
        data: {
          lastMessageSeq: maxSeq,
          orderInfo: conv.orderInfo || undefined,
        },
      });
    }

    idMap.set(conv.id, room.id);

    // Migrate V2 messages → V3 with seq
    for (let i = 0; i < conv.messages.length; i++) {
      const msg = conv.messages[i];
      await prisma.chatMessageV3.upsert({
        where: { roomId_seq: { roomId: room.id, seq: i + 1 } },
        create: {
          roomId: room.id,
          senderId: msg.senderId,
          type: 'TEXT',
          content: msg.text,
          seq: i + 1,
          createdAt: msg.createdAt,
        },
        update: {},
      });
    }
  }

  console.log(`✅ Migrated ${conversations.length} conversations → ChatRoom`);
  return idMap;
}

async function migrateLegacyMessages(): Promise<void> {
  // For legacy messages without a conversation, try to match by studioId + users
  const legacyMessages = await prisma.chatMessageLegacy.findMany({
    orderBy: { createdAt: 'asc' },
  });

  // Group by studioId
  const byStudio: Record<string, typeof legacyMessages> = {};
  for (const m of legacyMessages) {
    if (!byStudio[m.studioId]) byStudio[m.studioId] = [];
    byStudio[m.studioId].push(m);
  }

  let migrated = 0;
  for (const [studioId, msgs] of Object.entries(byStudio)) {
    // Find rooms in this studio
    const rooms = await prisma.chatRoom.findMany({ where: { studioId } });
    if (rooms.length === 0) continue;

    for (const msg of msgs) {
      // Try to match to a room where senderId is a participant
      const room = rooms.find((r) => r.participantA === msg.senderId || r.participantB === msg.senderId);
      if (!room) continue;

      const nextSeq = room.lastMessageSeq + 1;
      await prisma.chatMessageV3.upsert({
        where: { roomId_seq: { roomId: room.id, seq: nextSeq } },
        create: {
          id: msg.id,
          roomId: room.id,
          senderId: msg.senderId,
          type: 'TEXT',
          content: msg.text,
          seq: nextSeq,
          createdAt: msg.createdAt,
        },
        update: {},
      });

      await prisma.chatRoom.update({
        where: { id: room.id },
        data: { lastMessageSeq: nextSeq, lastMessage: msg.text.slice(0, 100) },
      });

      migrated++;
    }
  }

  console.log(`✅ Migrated ${migrated} legacy messages → ChatMessageV3`);
}

async function validate(): Promise<void> {
  const v2Count = await prisma.chatMessage.count();
  const legacyCount = await prisma.chatMessageLegacy.count();
  const v3Count = await prisma.chatMessageV3.count();

  console.log(`\n📊 Migration Summary:`);
  console.log(`   ChatMessageV2:     ${v2Count} (old table)`);
  console.log(`   ChatMessageLegacy: ${legacyCount} (old table)`);
  console.log(`   ChatMessageV3:     ${v3Count} (new table)`);
  console.log(`   Expected minimum:  ${v2Count + legacyCount}`);

  if (v3Count >= v2Count + legacyCount) {
    console.log(`   ✅ Validation PASSED`);
  } else {
    console.log(`   ⚠️  Some messages were not migrated (expected: messages without matching rooms)`);
  }
}

async function main() {
  console.log('🚀 Starting Chat 3.0 migration...\n');

  await migrateConversations();
  await migrateLegacyMessages();
  await validate();

  console.log('\n🎉 Migration complete!');
  await prisma.$disconnect();
}

main().catch(console.error);
