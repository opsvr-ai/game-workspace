import { useEffect, useRef, useCallback } from 'react';

interface NotifyOptions {
  title: string;
  body: string;
}

export function useChatNotification(enabled: boolean) {
  const originalTitle = useRef(document.title);
  const flashInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (enabled && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [enabled]);

  const notify = useCallback(
    ({ title, body }: NotifyOptions) => {
      // Browser notification
      if (enabled && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(title, { body });
        } catch {
          // Some browsers may reject without user gesture; silently ignore
        }
      }

      // Flash document title
      const flashTitle = '🔔 新消息 — Chunlv';
      document.title = flashTitle;
      if (flashInterval.current) clearInterval(flashInterval.current);
      flashInterval.current = setInterval(() => {
        document.title = document.title === flashTitle ? originalTitle.current : flashTitle;
      }, 1000);

      // Restore title when tab regains focus
      const onFocus = () => {
        document.title = originalTitle.current;
        if (flashInterval.current) {
          clearInterval(flashInterval.current);
          flashInterval.current = null;
        }
        window.removeEventListener('focus', onFocus);
      };
      window.addEventListener('focus', onFocus);
    },
    [enabled],
  );

  return { notify };
}
