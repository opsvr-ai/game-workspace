# Chat UI (WeChat-Style)

## Overview

WeChat-style chat interface with conversation list, chat window, and notification layer.

## Components

### ConversationList

Shows all conversations sorted by lastMessageAt desc.

Each row shows:
- Avatar (first letter of displayName, colored circle)
- Display name (bold if unread)
- Last message preview (truncated to 1 line, gray if read, black if unread)
- Timestamp (HH:MM for today, MM/DD for older)
- Red unread count badge (right-aligned, 1-99, "99+" for >99)

Used in:
- Bell popover (mini, top 10)
- Floating widget popover (mini, top 10)
- (Future) Full messages page

### ChatModal

WeChat-style chat window.

Header:
- Participant avatar + display name + role tag
- Close button (X)

Message area:
- Scrollable, auto-scroll to bottom on new messages
- "Loading..." indicator when fetching older messages
- Scroll to top triggers `loadMore` (if hasMore is true)

MessageBubble:
- Messages from others: left-aligned, gray (#F0F0F0) bubble, avatar on left, sender name above (first in group only)
- Messages from me: right-aligned, blue (#95EC69) bubble, no avatar
- Time below bubble (HH:MM, small gray text)
- TimeDivider between groups > 3 minutes apart: centered "MM/DD HH:MM" label

Input area:
- Textarea (auto-growing, 1-4 rows)
- Enter = send, Shift+Enter = newline
- Send button (blue, disabled when input empty)
- Emoji toggle → emoji panel (existing QQ emojis preserved)
- File/image upload button (existing functionality preserved)

### BellIcon

In AppLayout header:
- Badge with totalUnread count
- Blue glow animation when unread > 0
- Click opens popover with ConversationList

### FloatingChatWidget

Fixed position bottom-right, draggable:
- Blue circle with message icon
- Badge with totalUnread count
- Pulse animation when unread > 0
- Bounce animation on new message
- Click opens popover with ConversationList

### MessageCenterPanel

Bell popover content wrapper with:
- "未读 (N)" header with "全部已读" button
- ConversationList items grouped by unread/read

## Requirements

- Opening a conversation immediately clears its unread badge locally
- Auto-scroll to bottom when new messages arrive (if already at bottom)
- Sound plays only when chat window is NOT focused
- Messages survive browser refresh (loaded from server)
- Empty state: "暂无消息" with icon
- Empty conversation: "发送第一条消息吧"
- Send button disabled when input is empty or only whitespace
