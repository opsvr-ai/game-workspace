import { useRef, useState, useCallback, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

interface CallState {
  status: 'idle' | 'ringing' | 'calling' | 'connected';
  peerName?: string;
  peerId?: string;
  startTime?: number;
  duration?: number;
  volume?: number;
}

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

export function useVoiceCall(userId?: string, userName?: string) {
  const [callState, setCallState] = useState<CallState>(() => {
    const saved = localStorage.getItem('voice-volume');
    return { status: 'idle', volume: saved ? parseInt(saved) : 80 };
  });
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringtoneRef = useRef<{ stop: () => void } | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const getSocket = useCallback(() => {
    if (!socketRef.current) {
      const token = sessionStorage.getItem('accessToken');
      socketRef.current = io('/', { auth: { token }, transports: ['websocket', 'polling'] });
    }
    return socketRef.current;
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
  }, []);

  // Listen for incoming calls
  useEffect(() => {
    const socket = getSocket();
    socket.on('call:offer', async (data: any) => {
      ringtoneRef.current = playRingtone();
      setCallState({ status: 'ringing', peerId: data.fromUserId, peerName: data.callerName, volume: 80 });
    });
    socket.on('call:answer', async (data: any) => {
      ringtoneRef.current?.stop();
      if (pcRef.current) await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
    });
    socket.on('call:ice-candidate', async (data: any) => {
      if (pcRef.current && data.candidate) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    });
    socket.on('call:hangup', () => {
      ringtoneRef.current?.stop();
      cleanup();
      setCallState({ status: 'idle' });
    });
    return () => { socket.off('call:offer'); socket.off('call:answer'); socket.off('call:ice-candidate'); socket.off('call:hangup'); };
  }, [getSocket, cleanup]);

  const startCall = useCallback(async (targetUserId: string, targetUserName: string) => {
    try {
      setCallState({ status: 'calling', peerId: targetUserId, peerName: targetUserName });
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcRef.current = pc;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.onicecandidate = (e) => {
        if (e.candidate) getSocket().emit('call:ice-candidate', { targetUserId, candidate: e.candidate });
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
      getSocket().emit('call:offer', { targetUserId, sdp: offer });

      const start = Date.now();
      timerRef.current = setInterval(() => {
        setCallState((s) => (s.status === 'connected' ? { ...s, duration: Math.floor((Date.now() - start) / 1000) } : s));
      }, 1000);
    } catch (err) {
      cleanup();
      setCallState({ status: 'idle' });
    }
  }, [getSocket, cleanup]);

  const acceptCall = useCallback(async () => {
    if (callState.status !== 'ringing' || !callState.peerId) return;
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      pcRef.current = pc;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.onicecandidate = (e) => {
        if (e.candidate) getSocket().emit('call:ice-candidate', { targetUserId: callState.peerId, candidate: e.candidate });
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
      getSocket().emit('call:answer', { targetUserId: callState.peerId, sdp: answer });

      const start = Date.now();
      setCallState({ ...callState, status: 'connected', startTime: start });
      timerRef.current = setInterval(() => {
        setCallState((s) => (s.status === 'connected' ? { ...s, duration: Math.floor((Date.now() - start) / 1000) } : s));
      }, 1000);
    } catch (err) {
      cleanup();
      setCallState({ status: 'idle' });
    }
  }, [callState, getSocket, cleanup]);

  const rejectCall = useCallback(() => {
    ringtoneRef.current?.stop();
    if (callState.peerId) getSocket().emit('call:hangup', { targetUserId: callState.peerId });
    setCallState({ status: 'idle' });
  }, [callState.peerId, getSocket]);

  const hangup = useCallback(() => {
    if (callState.peerId) getSocket().emit('call:hangup', { targetUserId: callState.peerId });
    cleanup();
    setCallState({ status: 'idle' });
  }, [callState.peerId, getSocket, cleanup]);

  const setVolume = useCallback((v: number) => {
    localStorage.setItem('voice-volume', String(v));
    setCallState((s) => ({ ...s, volume: v }));
    if (remoteAudioRef.current) remoteAudioRef.current.volume = v / 100;
  }, []);

  return { callState, startCall, acceptCall, rejectCall, hangup, setVolume, localStreamRef };
}
