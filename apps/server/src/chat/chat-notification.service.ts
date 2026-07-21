// craftsman-ignore: TS001
import { Injectable } from '@nestjs/common';

export type NotificationLevel = 'badge' | 'sound' | 'desktop';

@Injectable()
export class ChatNotificationService {
  /**
   * Determine notification level based on context.
   * - active conversation open → badge only
   * - tab in background → sound
   * - tab hidden/closed → desktop notification
   */
  determineLevel(context: {
    isActiveConversation: boolean;
    isTabFocused: boolean;
    isTabVisible: boolean;
  }): NotificationLevel {
    if (context.isActiveConversation) return 'badge';
    if (!context.isTabVisible) return 'desktop';
    if (!context.isTabFocused) return 'sound';
    return 'badge';
  }

  /**
   * Format notification summary text for badge.
   */
  formatSummary(unreadRooms: number, totalUnread: number): string {
    if (unreadRooms === 0) return '';
    if (unreadRooms === 1) return `${totalUnread}条新消息`;
    return `${unreadRooms}个陪玩发来${totalUnread}条消息`;
  }
}
