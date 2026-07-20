/**
 * Web Audio API notification sound — two-tone QQ-style beep.
 * Zero dependencies. Silently no-ops when AudioContext is unavailable.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
    }
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    return ctx;
  } catch {
    return null;
  }
}

// Ensure AudioContext can be resumed after first user interaction
if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    () => {
      if (ctx?.state === 'suspended') ctx.resume();
    },
    { once: true },
  );
}

/** Play a short two-tone notification beep (800→1000 Hz). */
export function playMessageSound(): void {
  try {
    const c = getCtx();
    if (!c) return;

    const now = c.currentTime;

    // First tone: 800 Hz sine, 100 ms with fast decay
    const osc1 = c.createOscillator();
    const gain1 = c.createGain();
    osc1.type = 'sine';
    osc1.frequency.value = 800;
    gain1.gain.setValueAtTime(0.25, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc1.connect(gain1);
    gain1.connect(c.destination);
    osc1.start(now);
    osc1.stop(now + 0.1);

    // Second tone: 1000 Hz sine, 150 ms with fast decay
    const osc2 = c.createOscillator();
    const gain2 = c.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = 1000;
    gain2.gain.setValueAtTime(0.25, now + 0.1);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc2.connect(gain2);
    gain2.connect(c.destination);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.25);
  } catch {
    // Silently ignore — Audio API may not be available
  }
}
