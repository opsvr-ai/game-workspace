// craftsman-ignore: TS001,TS002
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'chunlv-chat';
const DB_VERSION = 1;

interface ChatDB {
  messages: {
    key: string; // `${roomId}:${seq}`
    value: {
      id: string;
      roomId: string;
      senderId: string;
      type: string;
      content: string;
      seq: number;
      createdAt: number;
    };
  };
  rooms: {
    key: string;
    value: {
      id: string;
      participantName: string;
      lastMessage: string;
      lastMessageAt: number;
      orderInfo?: string;
      pinned?: boolean;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null;

function getDB(): Promise<IDBPDatabase<ChatDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ChatDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('messages')) {
          db.createObjectStore('messages', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('rooms')) {
          db.createObjectStore('rooms', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function cacheMessages(roomId: string, messages: any[]) {
  const db = await getDB();
  const tx = db.transaction('messages', 'readwrite');
  for (const msg of messages) {
    const key = `${roomId}:${msg.seq || msg.id}`;
    await tx.store.put({
      key,
      id: msg.id,
      roomId: roomId,
      senderId: msg.senderId,
      type: msg.type || 'TEXT',
      content: msg.content || msg.text || '',
      seq: msg.seq || 0,
      createdAt: typeof msg.createdAt === 'string' ? new Date(msg.createdAt).getTime() : msg.createdAt || Date.now(),
    });
  }
  await tx.done;
}

export async function loadCachedMessages(roomId: string, limit = 50): Promise<any[]> {
  const db = await getDB();
  const all = await db.getAll('messages');
  return all
    .filter((m) => m.roomId === roomId)
    .sort((a, b) => b.seq - a.seq)
    .slice(0, limit)
    .reverse()
    .map((m) => ({
      id: m.id,
      senderId: m.senderId,
      type: m.type,
      text: m.content,
      content: m.content,
      seq: m.seq,
      createdAt: m.createdAt,
    }));
}

/** LRU: remove oldest messages beyond limit per room */
export async function cleanupCache(maxPerRoom = 500) {
  const db = await getDB();
  const all = await db.getAll('messages');
  const byRoom: Record<string, any[]> = {};
  for (const m of all) {
    if (!byRoom[m.roomId]) byRoom[m.roomId] = [];
    byRoom[m.roomId].push(m);
  }
  const tx = db.transaction('messages', 'readwrite');
  for (const [roomId, msgs] of Object.entries(byRoom)) {
    if (msgs.length > maxPerRoom) {
      const toDelete = msgs.sort((a, b) => b.seq - a.seq).slice(maxPerRoom);
      for (const m of toDelete) {
        await tx.store.delete(m.key);
      }
    }
  }
  await tx.done;
}
