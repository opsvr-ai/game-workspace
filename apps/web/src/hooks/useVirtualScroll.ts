// craftsman-ignore: TS001,TS002
import { useRef, useCallback } from 'react';

/**
 * Lightweight virtual scroll hook for message lists.
 * Delegates heavy lifting to @tanstack/react-virtual in MessageList.
 * This hook provides scroll-to-bottom and load-more utilities.
 */
export function useVirtualScroll(options: { onLoadMore?: () => void; hasMore?: boolean; threshold?: number }) {
  const { onLoadMore, hasMore, threshold = 60 } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;

    if (el.scrollTop < threshold && hasMore && onLoadMore) {
      onLoadMore();
    }
  }, [onLoadMore, hasMore, threshold]);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  return { containerRef, handleScroll, scrollToBottom, isAtBottomRef };
}
