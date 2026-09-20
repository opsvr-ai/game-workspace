// craftsman-ignore: TS001
import { useRef, useState, useCallback, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { message } from 'antd';
import { useVoiceCallStore } from '../stores/voiceCallStore';

interface CallState {
  status: 'idle' | 'ringing' | 'calling' | 'connected';
  peerName?: string;
  peerId?: string;
  startTime?: number;
  duration?: number;
  volume?: number;
}

/**
 * 语音通话 = 走已有的 WebSocket 中转，不再做点对点（WebRTC）打洞。
 *
 * 为什么改（老板 2026-09-21 报「王昊和邵泽慧打语音互相听不到声音」）：
 * 原来双方直连：只有 Google STUN 打洞，服务器上没有 TURN（云安全组只放通了 22 / 3001，
 * 3478 和中继端口进不来）。而办公室/家宽这边是多线 NAT（实测同一台机器先后映射成
 * 122.6.117.75 和 122.6.112.252 两个公网 IP），出口一变，打好的洞就废了，
 * 通话界面还显示「已接通」但两边都没声音。
 * 现在把同一条 socket 连接当音频通道：NAT 怎么变、出口怎么换都不影响，
 * 网络抖动断线后 socket 自动重连，声音接着走。
 *
 * 音频格式：16kHz 单声道 PCM16，每帧 20ms（640 字节，约 32KB/s）。
 */

// 振铃/呼叫超时自动结束，避免“对方无应答”时一直挂在那。
const CALL_TIMEOUT_MS = 45_000;
// 断线后多久还没连回来就结束通话（多线网络切换时通常 1~2 秒就能重连上）。
const RECONNECT_GRACE_MS = 30_000;
// 单帧上限 8KB：异常大包直接丢，别占用通道。
const MAX_FRAME_BYTES = 8192;
const activeRingtoneStops = new Set<() => void>();

const CAPTURE_WORKLET = `
class ChunlvCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.buf = new Float32Array(0);
    this.out = new Int16Array(320);
    this.outLen = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || !ch.length) return true;
    const merged = new Float32Array(this.buf.length + ch.length);
    merged.set(this.buf, 0);
    merged.set(ch, this.buf.length);
    this.buf = merged;
    while (this.buf.length - this.pos >= this.ratio) {
      const start = Math.floor(this.pos);
      const end = Math.min(this.buf.length, Math.floor(this.pos + this.ratio));
      let sum = 0;
      for (let i = start; i < end; i++) sum += this.buf[i];
      const v = sum / Math.max(1, end - start);
      this.out[this.outLen++] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
      this.pos += this.ratio;
      if (this.outLen === this.out.length) {
        const copy = this.out.slice(0);
        this.port.postMessage(copy.buffer, [copy.buffer]);
        this.outLen = 0;
      }
    }
    const drop = Math.floor(this.pos);
    if (drop > 0) {
      this.buf = this.buf.slice(drop);
      this.pos -= drop;
    }
    return true;
  }
}
registerProcessor('chunlv-capture', ChunlvCapture);
`;
const PLAYBACK_WORKLET = `
class ChunlvPlayback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(16000 * 4);
    this.write = 0;
    this.read = 0;
    this.count = 0;
    this.started = false;
    this.port.onmessage = (e) => {
      const pcm = new Int16Array(e.data);
      for (let i = 0; i < pcm.length; i++) {
        this.ring[this.write] = pcm[i] / 32768;
        this.write = (this.write + 1) % this.ring.length;
        if (this.count < this.ring.length) this.count++;
        else this.read = this.write;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    if (!this.started) {
      if (this.count < 960) { out.fill(0); return true; }
      this.started = true;
    }
    const n = Math.min(out.length, this.count);
    for (let i = 0; i < n; i++) {
      out[i] = this.ring[this.read];
      this.read = (this.read + 1) % this.ring.length;
      this.count--;
    }
    for (let i = n; i < out.length; i++) out[i] = 0;
    return true;
  }
}
registerProcessor('chunlv-playback', ChunlvPlayback);
`;

interface Pipeline {
  ctx: AudioContext;
  node: AudioWorkletNode;
  gain?: GainNode;
}

const workletUrls = new Map<string, string>();
function workletUrl(name: string, source: string): string {
  const cached = workletUrls.get(name);
  if (cached) return cached;
  const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
  workletUrls.set(name, url);
  return url;
}

// 把后端/浏览器抛出来的媒体错误转成用户能看懂的提示。
function mediaErrorMessage(err: any): string {
  const raw = `${err?.name || ''} ${err?.message || ''}`.toLowerCase();
  if (raw.includes('notallowederror') || raw.includes('permissiondenied') || raw.includes('permission')) {
    return '麦克风权限未授权，请在系统设置中允许麦克风访问';
  }
  if (raw.includes('notfound') || raw.includes('device not found') || raw.includes('requested device')) {
    return '未检测到麦克风设备，请检查麦克风是否连接或已被禁用';
  }
  if (raw.includes('notreadable') || raw.includes('abort') || raw.includes('track')) {
    return '麦克风被占用或无法访问，请关闭占用麦克风的程序后重试';
  }
  return '通话失败: ' + (err?.message || String(err));
}

function stopAllRingtones() {
  for (const stop of activeRingtoneStops) {
    try { stop(); } catch {}
  }
  activeRingtoneStops.clear();
}

// 更柔和的来电铃声：低音量、渐入渐出的双音，不再用刺耳的高频正弦波。
function playRingtone() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = 0.12;
    master.connect(ctx.destination);

    let stopped = false;
    const tone = (freq: number, dur: number) => {
      if (stopped) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(g);
      g.connect(master);
      osc.start();
      osc.stop(ctx.currentTime + dur + 0.05);
    };

    let phase = 0;
    const interval = setInterval(() => {
      if (stopped) return;
      tone(phase === 0 ? 440 : 523, 0.4);
      phase = 1 - phase;
    }, 500);

    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      try { ctx.close(); } catch {}
      activeRingtoneStops.delete(stop);
    };
    activeRingtoneStops.add(stop);
    return { stop, ctx };
  } catch {
    return { stop: () => {}, ctx: null as AudioContext | null };
  }
}

/** 收到的二进制帧统一转成 Int16Array；格式不对就丢。 */
async function toInt16(pcm: any): Promise<Int16Array | null> {
  if (!pcm) return null;
  if (pcm instanceof Int16Array) return pcm;
  let buf: ArrayBuffer | null = null;
  if (pcm instanceof ArrayBuffer) {
    buf = pcm;
  } else if (ArrayBuffer.isView(pcm)) {
    buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
  } else if (typeof Blob !== 'undefined' && pcm instanceof Blob) {
    buf = await pcm.arrayBuffer();
  }
  if (!buf) return null;
  if (buf.byteLength < 2 || buf.byteLength % 2 !== 0 || buf.byteLength > MAX_FRAME_BYTES) return null;
  return new Int16Array(buf);
}

/**
 * 对方客户端还是旧版本（信令里带 sdp，走的是点对点直连）。
 * 新旧混着打必然没声音，与其让人干等，不如直接说清楚：让对方重启一下客户端。
 */
function legacyPeerHint(socket: Socket, peerId: string | undefined): void {
  try {
    if (peerId) socket.emit('call:hangup', { targetUserId: peerId });
  } catch {}
  message.error('对方客户端版本较旧，通话接不通。请让对方重启一下客户端（或退出重新登录）再打。');
}

export function useVoiceCall(socketRef: React.RefObject<Socket | null>) {
  const [callState, setCallState] = useState<CallState>(() => {
    const saved = localStorage.getItem('voice-volume');
    return { status: 'idle', volume: saved ? parseInt(saved) : 80 };
  });
  const captureRef = useRef<Pipeline | null>(null);
  const playbackRef = useRef<Pipeline | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringtoneRef = useRef<{ stop: () => void } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<CallState['status']>('idle');
  // 通话对端 id（主叫记被叫人、被叫记主叫人），音频帧按它投递。
  const targetRef = useRef<string | undefined>(undefined);
  // 只有「已接通」才真的往外发音频，呼叫中/挂断后都不发。
  const sendingRef = useRef(false);
  const seqRef = useRef(0);
  // 对端是不是「还在用点对点直连」的老版本客户端（老版本的信令里带 sdp）。
  const peerLegacyRef = useRef(false);
  // 自检计数：发出去多少帧、收到并送进播放器多少帧。
  // 排查「没声音」时一眼就能分出是「对方没发」「通道丢了」还是「播放端没解出来」。
  const statsRef = useRef({ sentFrames: 0, receivedFrames: 0, playedFrames: 0 });

  useEffect(() => {
    statusRef.current = callState.status;
    useVoiceCallStore.getState().setCall({
      status: callState.status,
      peerId: callState.peerId,
      peerName: callState.peerName,
      duration: callState.duration,
    });
  }, [callState]);

  const clearCallTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopAllRingtones();
    ringtoneRef.current?.stop();
    ringtoneRef.current = null;
    sendingRef.current = false;
    targetRef.current = undefined;
    clearReconnectTimer();
    if (captureRef.current) {
      try { captureRef.current.node.port.onmessage = null; } catch {}
      try { captureRef.current.node.disconnect(); } catch {}
      try { void captureRef.current.ctx.close(); } catch {}
      captureRef.current = null;
    }
    if (playbackRef.current) {
      try { playbackRef.current.node.disconnect(); } catch {}
      try { void playbackRef.current.ctx.close(); } catch {}
      playbackRef.current = null;
    }
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    clearCallTimeout();
  }, [clearCallTimeout, clearReconnectTimer]);

  const getSocket = useCallback((): Socket => {
    const s = socketRef.current;
    if (!s) throw new Error('WebSocket未连接，请刷新页面重试');
    return s;
  }, [socketRef]);

  const startTimer = useCallback((start: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCallState((s) => (s.status === 'connected' ? { ...s, duration: Math.floor((Date.now() - start) / 1000) } : s));
    }, 1000);
  }, []);

  const applyVolume = useCallback((v: number) => {
    if (playbackRef.current?.gain) playbackRef.current.gain.gain.value = v / 100;
  }, []);

  /** 播放通道按需创建：16kHz 的 AudioContext + 环形缓冲 worklet。 */
  const ensurePlayback = useCallback(async () => {
    if (playbackRef.current) {
      try { await playbackRef.current.ctx.resume(); } catch {}
      return playbackRef.current;
    }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx({ sampleRate: 16000 } as AudioContextOptions);
    if (!ctx.audioWorklet) {
      try { void ctx.close(); } catch {}
      throw new Error('当前环境不支持语音（请使用客户端）');
    }
    await ctx.audioWorklet.addModule(workletUrl('playback', PLAYBACK_WORKLET));
    const node = new AudioWorkletNode(ctx, 'chunlv-playback');
    const gain = ctx.createGain();
    const saved = parseInt(localStorage.getItem('voice-volume') || '80', 10);
    gain.gain.value = (Number.isFinite(saved) ? Math.min(100, Math.max(0, saved)) : 80) / 100;
    node.connect(gain);
    gain.connect(ctx.destination);
    try { await ctx.resume(); } catch {}
    playbackRef.current = { ctx, node, gain };
    return playbackRef.current;
  }, []);

  /** 采集通道：麦克风 → 16kHz/PCM16/20ms 帧 → socket 发出去。 */
  const startCapture = useCallback(async (stream: MediaStream, socket: Socket, targetId: string) => {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    if (!ctx.audioWorklet) {
      try { void ctx.close(); } catch {}
      throw new Error('当前环境不支持语音（请使用客户端）');
    }
    await ctx.audioWorklet.addModule(workletUrl('capture', CAPTURE_WORKLET));
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'chunlv-capture');
    const silent = ctx.createGain();
    silent.gain.value = 0; // 不把自己的声音放出来，但保证 worklet 被驱动
    source.connect(node);
    node.connect(silent);
    silent.connect(ctx.destination);
    node.port.onmessage = (e: MessageEvent) => {
      if (!sendingRef.current) return;
      // 连接不在就直接丢帧，别让 socket.io 把旧音频攒着，重连后一次性喷出来。
      if (!socket.connected) return;
      try {
        socket.emit('call:audio', { to: targetId, seq: seqRef.current++, pcm: e.data });
        statsRef.current.sentFrames += 1;
      } catch {}
    };
    try { await ctx.resume(); } catch {}
    captureRef.current = { ctx, node };
  }, []);

  const pushPcm = useCallback(async (pcm: any) => {
    if (statusRef.current !== 'connected') return;
    const samples = await toInt16(pcm);
    if (!samples || !samples.length) return;
    statsRef.current.receivedFrames += 1;
    try {
      const pb = await ensurePlayback();
      pb.node.port.postMessage(samples.buffer, [samples.buffer]);
      statsRef.current.playedFrames += 1;
    } catch {}
  }, [ensurePlayback]);

  const endCall = useCallback((socket: Socket, peerId: string | undefined, silent = false) => {
    try {
      if (peerId) socket.emit('call:hangup', { targetUserId: peerId });
    } catch {}
    const prev = statusRef.current;
    cleanup();
    setCallState((s) => ({ status: 'idle', volume: s.volume }));
    if (silent) return;
    if (prev === 'calling') message.info('对方已挂断');
    else if (prev === 'ringing') message.info('对方已取消通话');
    else if (prev === 'connected') message.info('通话已结束');
  }, [cleanup]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const onOffer = (data: any) => {
      const fromUserId = data?.fromUserId;
      if (!fromUserId) return;
      // 已经在通话里就别再接新的，直接告诉对方忙。
      if (statusRef.current === 'connected' || statusRef.current === 'calling') {
        try { socket.emit('call:hangup', { targetUserId: fromUserId }); } catch {}
        message.warning('正在通话中，已自动忽略新的来电');
        return;
      }
      peerLegacyRef.current = !!data?.sdp;
      ringtoneRef.current = playRingtone();
      setCallState((s) => ({ status: 'ringing', peerId: fromUserId, peerName: data?.callerName, volume: s.volume }));
      clearCallTimeout();
      timeoutRef.current = setTimeout(() => {
        try { socket.emit('call:hangup', { targetUserId: fromUserId }); } catch {}
        ringtoneRef.current?.stop();
        cleanup();
        setCallState((s) => ({ status: 'idle', volume: s.volume }));
      }, CALL_TIMEOUT_MS);
    };

    const onAnswer = (data: any) => {
      if (statusRef.current !== 'calling') return;
      clearCallTimeout();
      ringtoneRef.current?.stop();
      if (data?.sdp) {
        // 对方还在用旧版（点对点直连）打不通这套网络，直接给一句人话，别让人干等。
        legacyPeerHint(socket, targetRef.current);
        return;
      }
      sendingRef.current = true;
      const start = Date.now();
      setCallState((s) => ({ ...s, status: 'connected', startTime: start }));
      startTimer(start);
    };

    const onIceOrAudio = (data: any) => {
      void pushPcm(data?.pcm);
    };

    const onPeerUnstable = () => {
      message.warning({ content: '对方网络抖动，正在重连…', key: 'voice-peer', duration: 0 });
    };

    const onPeerStable = () => {
      message.success({ content: '对方已恢复', key: 'voice-peer' });
    };

    const onHangup = () => endCall(socket, undefined, false);

    const onDisconnect = () => {
      if (statusRef.current === 'idle') return;
      sendingRef.current = false;
      message.warning({ content: '网络抖动，正在自动重连…', key: 'voice-reconnect', duration: 0 });
      if (!reconnectTimerRef.current) {
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          cleanup();
          setCallState((s) => ({ status: 'idle', volume: s.volume }));
          message.error({ content: '网络断开太久，通话已结束', key: 'voice-reconnect' });
        }, RECONNECT_GRACE_MS);
      }
    };

    const onConnect = () => {
      clearReconnectTimer();
      if (statusRef.current === 'connected') {
        sendingRef.current = true;
        message.success({ content: '已重新连上，通话继续', key: 'voice-reconnect' });
      }
    };

    socket.on('call:offer', onOffer);
    socket.on('call:answer', onAnswer);
    socket.on('call:audio', onIceOrAudio);
    socket.on('call:peer-unstable', onPeerUnstable);
    socket.on('call:peer-stable', onPeerStable);
    socket.on('call:hangup', onHangup);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    return () => {
      socket.off('call:offer', onOffer);
      socket.off('call:answer', onAnswer);
      socket.off('call:audio', onIceOrAudio);
      socket.off('call:peer-unstable', onPeerUnstable);
      socket.off('call:peer-stable', onPeerStable);
      socket.off('call:hangup', onHangup);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, [socketRef, cleanup, endCall, clearCallTimeout, clearReconnectTimer, pushPcm, startTimer]);

  const startCall = useCallback(async (targetUserId: string, targetUserName: string) => {
    try {
      const socket = getSocket();
      clearCallTimeout();
      if (statusRef.current !== 'idle') {
        message.warning('正在通话中，请先挂断');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        message.error('当前地址（网页版）无法使用麦克风，请用客户端发起通话');
        return;
      }
      seqRef.current = 0;
      targetRef.current = targetUserId;
      sendingRef.current = false;
      setCallState((s) => ({ status: 'calling', peerId: targetUserId, peerName: targetUserName, volume: s.volume }));
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      localStreamRef.current = stream;
      await startCapture(stream, socket, targetUserId);
      await ensurePlayback();
      socket.emit('call:offer', { targetUserId });
      timeoutRef.current = setTimeout(() => {
        if (statusRef.current !== 'calling') return;
        try { socket.emit('call:hangup', { targetUserId }); } catch {}
        cleanup();
        setCallState((s) => ({ status: 'idle', volume: s.volume }));
        message.info('对方无应答，请稍后再试');
      }, CALL_TIMEOUT_MS);
    } catch (err: any) {
      cleanup();
      setCallState((s) => ({ status: 'idle', volume: s.volume }));
      message.error(mediaErrorMessage(err));
    }
  }, [getSocket, cleanup, clearCallTimeout, startCapture, ensurePlayback]);

  const acceptCall = useCallback(async () => {
    const peerId = callState.peerId;
    if (callState.status !== 'ringing' || !peerId) return;
    const socket = (() => { try { return getSocket(); } catch { return null; } })();
    try {
      clearCallTimeout();
      ringtoneRef.current?.stop();
      if (!navigator.mediaDevices?.getUserMedia) {
        if (socket) { try { socket.emit('call:hangup', { targetUserId: peerId }); } catch {} }
        cleanup();
        setCallState((s) => ({ status: 'idle', volume: s.volume }));
        message.error('当前地址（网页版）无法使用麦克风，请用客户端接听通话');
        return;
      }
      if (!socket) throw new Error('WebSocket未连接，请刷新页面重试');
      if (peerLegacyRef.current) {
        // 提示完把来电弹窗和铃声收掉，别让它一直挂在那儿。
        legacyPeerHint(socket, peerId);
        clearCallTimeout();
        ringtoneRef.current?.stop();
        cleanup();
        setCallState((s) => ({ status: 'idle', volume: s.volume }));
        return;
      }
      seqRef.current = 0;
      targetRef.current = peerId;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      localStreamRef.current = stream;
      await startCapture(stream, socket, peerId);
      await ensurePlayback();
      sendingRef.current = true;
      socket.emit('call:answer', { targetUserId: peerId });
      const start = Date.now();
      setCallState((s) => ({ ...s, status: 'connected', startTime: start }));
      startTimer(start);
    } catch (err: any) {
      // 接听失败必须通知主叫方挂断，否则主叫方一直显示“正在呼叫”。
      if (socket) { try { socket.emit('call:hangup', { targetUserId: peerId }); } catch {} }
      cleanup();
      setCallState((s) => ({ status: 'idle', volume: s.volume }));
      message.error(mediaErrorMessage(err));
    }
  }, [callState.peerId, callState.status, getSocket, cleanup, clearCallTimeout, startCapture, ensurePlayback, startTimer]);

  const rejectCall = useCallback(() => {
    clearCallTimeout();
    ringtoneRef.current?.stop();
    try {
      const socket = getSocket();
      if (callState.peerId) socket.emit('call:hangup', { targetUserId: callState.peerId });
    } catch {}
    cleanup();
    setCallState((s) => ({ status: 'idle', volume: s.volume }));
  }, [callState.peerId, getSocket, cleanup, clearCallTimeout]);

  const hangup = useCallback(() => {
    clearCallTimeout();
    try {
      const socket = getSocket();
      if (callState.peerId) socket.emit('call:hangup', { targetUserId: callState.peerId });
    } catch {}
    cleanup();
    setCallState((s) => ({ status: 'idle', volume: s.volume }));
  }, [callState.peerId, getSocket, cleanup, clearCallTimeout]);

  const setVolume = useCallback((v: number) => {
    localStorage.setItem('voice-volume', String(v));
    setCallState((s) => ({ ...s, volume: v }));
    applyVolume(v);
  }, [applyVolume]);

  return { callState, startCall, acceptCall, rejectCall, hangup, setVolume, localStreamRef, stats: statsRef };
}
