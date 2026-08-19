// 系统级通知：当陪玩端最小化/在聊微信时，也能弹出 Windows 通知。
export function showSystemNotification(title: string, body: string) {
  try {
    const N = (window as any).Notification;
    if (!N) return;
    const show = () => {
      try {
        new N(title, { body });
      } catch {
        /* ignore */
      }
    };
    if (N.permission === 'granted') {
      show();
    } else if (N.permission !== 'denied' && typeof N.requestPermission === 'function') {
      const p = N.requestPermission();
      if (p && typeof p.then === 'function') {
        p.then((res: string) => {
          if (res === 'granted') show();
        }).catch(() => {});
      }
    }
  } catch {
    /* ignore */
  }
}
