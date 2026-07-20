# Conversation Model

## Overview

Defines the database schema for conversations and messages. A conversation is between exactly two users in a studio, identified by their User.id UUIDs.

## Schema

### Conversation

| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Conversation identifier |
| studioId | String | Studio scope |
| participantA | String | User.id — lexicographically smaller UUID |
| participantB | String | User.id — lexicographically larger UUID |
| aReadAt | DateTime? | Last time participantA read this conversation |
| bReadAt | DateTime? | Last time participantB read this conversation |
| lastMessage | String? | Text preview of last message |
| lastMessageAt | DateTime? | Timestamp of last message |
| createdAt | DateTime | When conversation was created |

Unique constraint: `(studioId, participantA, participantB)`

### ChatMessage

| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Server-assigned message ID |
| conversationId | String (FK) | References Conversation.id |
| senderId | String | User.id of sender |
| text | String | Message content |
| createdAt | DateTime | When message was sent |

## Requirements

- A conversation between users X and Y always has participantA = min(X.id, Y.id) and participantB = max(X.id, Y.id)
- Messages are created with server-assigned UUIDs via `@default(uuid())`
- Deleting a conversation cascades to delete all its messages
- Index on `(conversationId, createdAt)` for efficient message history queries
