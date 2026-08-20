// 系统级通知：当陪玩端最小化/在聊微信时，也能弹出 Windows 通知。
export function showSystemNotification(title: string, body: string) {
  try {
    const electronApi = (window as any).electronAPI;
    if (electronApi?.notify) {
      electronApi.notify(title, body);
      return;
    }
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

// 提示音：搭配重要提醒（如搭档邀请）一起用，陪玩端最小化/在打游戏时也能听到。
export function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const play = (freq: number, at: number, dur: number) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + dur + 0.05);
    };
    const t = ctx.currentTime;
    play(880, t, 0.12);
    play(880, t + 0.16, 0.12);
    setTimeout(() => { try { ctx.close(); } catch {} }, 600);
  } catch {
    /* ignore */
  }
}
