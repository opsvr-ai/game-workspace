// craftsman-ignore: TS001
import { useRef, useState, useCallback, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { message } from 'antd';
import http from '../api/client';

interface CallState {
  status: 'idle' | 'ringing' | 'calling' | 'connected';
  peerName?: string;
  peerId?: string;
  startTime?: number;
  duration?: number;
  volume?: number;
}

// 跟微信电脑版一致：振铃/呼叫超时自动结束，避免“对方无应答”时一直挂在那。
const CALL_TIMEOUT_MS = 45_000;

// Simple ringtone using oscillator (no external file needed)
function playRingtone() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.setValueAtTime(1000, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    const stop = () => { try { osc.stop(); ctx.close(); } catch {} };
    setTimeout(() => { osc.frequency.setValueAtTime(800, ctx.currentTime); }, 600);
    setTimeout(() => { osc.frequency.setValueAtTime(1000, ctx.currentTime); }, 900);
    return { stop, ctx };
  } catch { return { stop: () => {}, ctx: null }; }
}

// TURN 服务器配置从后台读取（老板在设置页填写），不再写死在构建环境变量里
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
  const userIdRef = useRef<string | undefined>();
  const userNameRef = useRef<string | undefined>();
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

  useEffect(() => {
    statusRef.current = callState.status;
  }, [callState.status]);

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
    remoteAudioRef.current?.pause();
    remoteAudioRef.current = null;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    clearCallTimeout();
  }, [clearCallTimeout]);

  const getSocket = useCallback((): Socket => {
    const s = socketRef.current;
    if (!s) throw new Error('WebSocket未连接，请刷新页面重试');
    return s;
  }, [socketRef]);

  // 主动结束通话（通知对方），并根据当前状态给出提示。
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

  // Listen for incoming calls
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    const onOffer = (data: any) => {
      ringtoneRef.current = playRingtone();
      setCallState({ status: 'ringing', peerId: data.fromUserId, peerName: data.callerName, volume: 80 });
      // 长时间不接听自动结束，并通知主叫方，避免双方一直挂着。
      clearCallTimeout();
      timeoutRef.current = setTimeout(() => {
        try {
          if (data.fromUserId) socket.emit('call:hangup', { targetUserId: data.fromUserId });
        } catch {}
        ringtoneRef.current?.stop();
        cleanup();
        setCallState({ status: 'idle' });
      }, CALL_TIMEOUT_MS);
    };
    const onAnswer = async (data: any) => {
      clearCallTimeout();
      ringtoneRef.current?.stop();
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
      }
      setCallState((s) => ({ ...s, status: 'connected', startTime: Date.now() }));
    };
    const onIce = async (data: any) => {
      if (pcRef.current && data.candidate) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    };
    const onHangup = () => {
      endCall(socket, undefined, false);
    };
    // 断线/重连时自动挂断并清理，避免“挂断不了”或残留通话
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
  }, [socketRef, cleanup, endCall, clearCallTimeout]);

  const startCall = useCallback(async (targetUserId: string, targetUserName: string) => {
    try {
      const socket = getSocket();
      clearCallTimeout();
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
        const audio = new Audio();
        audio.srcObject = e.streams[0];
        audio.volume = (callState.volume || 80) / 100;
        remoteAudioRef.current = audio;
        audio.play().catch(() => {});
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('call:offer', { targetUserId, sdp: offer });

      const start = Date.now();
      timerRef.current = setInterval(() => {
        setCallState((s) => (s.status === 'connected' ? { ...s, duration: Math.floor((Date.now() - start) / 1000) } : s));
      }, 1000);

      // 45 秒无应答自动结束并提示主叫方。
      timeoutRef.current = setTimeout(() => {
        if (statusRef.current !== 'calling') return;
        try {
          socket.emit('call:hangup', { targetUserId });
        } catch {}
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
  }, [getSocket, cleanup, clearCallTimeout, callState.volume]);

  const acceptCall = useCallback(async () => {
    if (callState.status !== 'ringing' || !callState.peerId) return;
    try {
      const socket = getSocket();
      clearCallTimeout();
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
        const audio = new Audio();
        audio.srcObject = e.streams[0];
        audio.volume = (callState.volume || 80) / 100;
        remoteAudioRef.current = audio;
        audio.play().catch(() => {});
      };

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:answer', { targetUserId: callState.peerId, sdp: answer });

      const start = Date.now();
      setCallState({ ...callState, status: 'connected', startTime: start });
      timerRef.current = setInterval(() => {
        setCallState((s) => (s.status === 'connected' ? { ...s, duration: Math.floor((Date.now() - start) / 1000) } : s));
      }, 1000);
    } catch (err: any) {
      // 接听失败（例如没有麦克风权限）必须通知主叫方挂断，否则主叫方会一直显示“正在呼叫”。
      try {
        const socket = getSocket();
        if (callState.peerId) socket.emit('call:hangup', { targetUserId: callState.peerId });
      } catch {}
      cleanup();
      setCallState({ status: 'idle' });
      message.error(`接听失败: ${err?.message || String(err)}`);
    }
  }, [callState, getSocket, cleanup, clearCallTimeout]);

  const rejectCall = useCallback(() => {
    clearCallTimeout();
    ringtoneRef.current?.stop();
    try {
      const socket = getSocket();
      if (callState.peerId) socket.emit('call:hangup', { targetUserId: callState.peerId });
    } catch {}
    setCallState({ status: 'idle' });
  }, [callState.peerId, getSocket, clearCallTimeout]);

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
