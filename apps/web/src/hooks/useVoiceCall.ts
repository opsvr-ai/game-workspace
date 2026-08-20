// craftsman-ignore: TS001
import { useRef, useState, useCallback, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { message } from 'antd';
import http from '../api/client';
import { useVoiceCallStore } from '../stores/voiceCallStore';

interface CallState {
  status: 'idle' | 'ringing' | 'calling' | 'connected';
  peerName?: string;
  peerId?: string;
  startTime?: number;
  duration?: number;
  volume?: number;
}

// 振铃/呼叫超时自动结束，避免“对方无应答”时一直挂在那。
const CALL_TIMEOUT_MS = 45_000;

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
    };
    return { stop, ctx };
  } catch {
    return { stop: () => {}, ctx: null };
  }
}

// TURN 服务器配置从后台读取，老板在设置页填写。
async function loadIceServers(): Promise<RTCIceServer[]> {
  const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  try {
    const { data } = await http.get('/config', {
      params: { keys: 'turn.url,turn.username,turn.credential' },
    });
    const cfg = data?.data || {};
    const url = cfg['turn.url'];
    if (url) {
      servers.push({
        urls: url,
        username: cfg['turn.username'] || undefined,
        credential: cfg['turn.credential'] || undefined,
      });
    }
  } catch {}
  return servers;
}

export function useVoiceCall(socketRef: React.RefObject<Socket | null>) {
  const [callState, setCallState] = useState<CallState>(() => {
    const saved = localStorage.getItem('voice-volume');
    return { status: 'idle', volume: saved ? parseInt(saved) : 80 };
  });
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringtoneRef = useRef<{ stop: () => void } | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<CallState['status']>('idle');
  const offerSdpRef = useRef<any>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

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

  const cleanup = useCallback(() => {
    ringtoneRef.current?.stop();
    ringtoneRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (remoteAudioRef.current) {
      try {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
      } catch {}
      remoteAudioRef.current = null;
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    clearCallTimeout();
  }, [clearCallTimeout]);

  const getSocket = useCallback((): Socket => {
    const s = socketRef.current;
    if (!s) throw new Error('WebSocket未连接，请刷新页面重试');
    return s;
  }, [socketRef]);

  const attachRemoteAudio = useCallback((stream: MediaStream) => {
    const audio = new Audio();
    audio.autoplay = true;
    audio.srcObject = stream;
    const saved = parseInt(localStorage.getItem('voice-volume') || '80', 10);
    audio.volume = Number.isFinite(saved) ? Math.min(100, Math.max(0, saved)) / 100 : 0.8;
    audio.style.display = 'none';
    try { document.body.appendChild(audio); } catch {}
    remoteAudioRef.current = audio;
    audio.play().catch(() => {});
  }, []);

  const flushPendingCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const pending = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const c of pending) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
    }
  }, []);

  const endCall = useCallback((socket: Socket, peerId: string | undefined, silent = false) => {
    try {
      if (peerId) socket.emit('call:hangup', { targetUserId: peerId });
    } catch {}
    const prev = statusRef.current;
    ringtoneRef.current?.stop();
    cleanup();
    setCallState({ status: 'idle' });
    if (silent) return;
    if (prev === 'calling') message.info('对方已挂断');
    else if (prev === 'ringing') message.info('对方已取消通话');
    else if (prev === 'connected') message.info('通话已结束');
  }, [cleanup]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const onOffer = (data: any) => {
      offerSdpRef.current = data?.sdp;
      pendingCandidatesRef.current = [];
      ringtoneRef.current = playRingtone();
      setCallState({ status: 'ringing', peerId: data?.fromUserId, peerName: data?.callerName, volume: 80 });
      clearCallTimeout();
      timeoutRef.current = setTimeout(() => {
        try {
          if (data?.fromUserId) socket.emit('call:hangup', { targetUserId: data.fromUserId });
        } catch {}
        ringtoneRef.current?.stop();
        cleanup();
        setCallState({ status: 'idle' });
      }, CALL_TIMEOUT_MS);
    };

    const onAnswer = async (data: any) => {
      clearCallTimeout();
      ringtoneRef.current?.stop();
      try {
        if (pcRef.current && data?.sdp) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
          await flushPendingCandidates();
        }
      } catch (e: any) {
        console.warn('setRemoteDescription(answer) failed', e?.message);
      }
      setCallState((s) => ({ ...s, status: 'connected', startTime: Date.now() }));
    };

    const onIce = async (data: any) => {
      if (!data?.candidate) return;
      if (pcRef.current && pcRef.current.remoteDescription) {
        try { await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
      } else {
        pendingCandidatesRef.current.push(data.candidate);
      }
    };

    const onHangup = () => endCall(socket, undefined, false);
    const onDisconnect = () => {
      ringtoneRef.current?.stop();
      cleanup();
      setCallState({ status: 'idle' });
    };

    socket.on('call:offer', onOffer);
    socket.on('call:answer', onAnswer);
    socket.on('call:ice-candidate', onIce);
    socket.on('call:hangup', onHangup);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('call:offer', onOffer);
      socket.off('call:answer', onAnswer);
      socket.off('call:ice-candidate', onIce);
      socket.off('call:hangup', onHangup);
      socket.off('disconnect', onDisconnect);
    };
  }, [socketRef, cleanup, endCall, clearCallTimeout, flushPendingCandidates]);

  const startCall = useCallback(async (targetUserId: string, targetUserName: string) => {
    try {
      const socket = getSocket();
      clearCallTimeout();
      pendingCandidatesRef.current = [];
      setCallState({ status: 'calling', peerId: targetUserId, peerName: targetUserName });
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) {
        cleanup();
        setCallState({ status: 'idle' });
        message.error('当前环境不支持麦克风，请使用客服端/陪玩端，或通过 HTTPS 访问');
        return;
      }
      const iceServers = await loadIceServers();
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

      const stream = await media.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('call:ice-candidate', { targetUserId, candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        const s = (e.streams && e.streams[0]) || new MediaStream([e.track]);
        attachRemoteAudio(s);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('call:offer', { targetUserId, sdp: offer });

      const start = Date.now();
      timerRef.current = setInterval(() => {
        setCallState((s) => (s.status === 'connected' ? { ...s, duration: Math.floor((Date.now() - start) / 1000) } : s));
      }, 1000);

      timeoutRef.current = setTimeout(() => {
        if (statusRef.current !== 'calling') return;
        try { socket.emit('call:hangup', { targetUserId }); } catch {}
        cleanup();
        setCallState({ status: 'idle' });
        message.info('对方无应答，请稍后再试');
      }, CALL_TIMEOUT_MS);
    } catch (err: any) {
      cleanup();
      setCallState({ status: 'idle' });
      const errMsg = err?.message || String(err);
      if (errMsg.includes('NotAllowed') || errMsg.includes('Permission')) {
        message.error('麦克风权限未授权，请在系统设置中允许麦克风访问');
      } else if (errMsg.includes('NotFound')) {
        message.error('未检测到麦克风设备');
      } else {
        message.error(`通话失败: ${errMsg}`);
      }
    }
  }, [getSocket, cleanup, clearCallTimeout, attachRemoteAudio]);

  const acceptCall = useCallback(async () => {
    if (callState.status !== 'ringing' || !callState.peerId) return;
    try {
      const socket = getSocket();
      clearCallTimeout();
      ringtoneRef.current?.stop();
      pendingCandidatesRef.current = [];
      const media = navigator.mediaDevices;
      if (!media?.getUserMedia) {
        cleanup();
        setCallState({ status: 'idle' });
        message.error('当前环境不支持麦克风，请使用客服端/陪玩端，或通过 HTTPS 访问');
        return;
      }
      const iceServers = await loadIceServers();
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

      const stream = await media.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('call:ice-candidate', { targetUserId: callState.peerId, candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        const s = (e.streams && e.streams[0]) || new MediaStream([e.track]);
        attachRemoteAudio(s);
      };

      // 关键：必须先设置对端 offer 为 remoteDescription，再 createAnswer，
      // 否则协商出来的 answer 不含对端媒体，双方听不到声音。
      if (offerSdpRef.current) {
        await pc.setRemoteDescription(new RTCSessionDescription(offerSdpRef.current));
        await flushPendingCandidates();
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:answer', { targetUserId: callState.peerId, sdp: answer });

      const start = Date.now();
      setCallState({ ...callState, status: 'connected', startTime: start });
      timerRef.current = setInterval(() => {
        setCallState((s) => (s.status === 'connected' ? { ...s, duration: Math.floor((Date.now() - start) / 1000) } : s));
      }, 1000);
    } catch (err: any) {
      // 接听失败必须通知主叫方挂断，否则主叫方一直显示“正在呼叫”。
      try {
        const socket = getSocket();
        if (callState.peerId) socket.emit('call:hangup', { targetUserId: callState.peerId });
      } catch {}
      cleanup();
      setCallState({ status: 'idle' });
      message.error(`接听失败: ${err?.message || String(err)}`);
    }
  }, [callState, getSocket, cleanup, clearCallTimeout, attachRemoteAudio, flushPendingCandidates]);

  const rejectCall = useCallback(() => {
    clearCallTimeout();
    ringtoneRef.current?.stop();
    try {
      const socket = getSocket();
      if (callState.peerId) socket.emit('call:hangup', { targetUserId: callState.peerId });
    } catch {}
    cleanup();
    setCallState({ status: 'idle' });
  }, [callState.peerId, getSocket, cleanup, clearCallTimeout]);

  const hangup = useCallback(() => {
    clearCallTimeout();
    try {
      const socket = getSocket();
      if (callState.peerId) socket.emit('call:hangup', { targetUserId: callState.peerId });
    } catch {}
    cleanup();
    setCallState({ status: 'idle' });
  }, [callState.peerId, getSocket, cleanup, clearCallTimeout]);

  const setVolume = useCallback((v: number) => {
    localStorage.setItem('voice-volume', String(v));
    setCallState((s) => ({ ...s, volume: v }));
    if (remoteAudioRef.current) remoteAudioRef.current.volume = v / 100;
  }, []);

  return { callState, startCall, acceptCall, rejectCall, hangup, setVolume, localStreamRef };
}
