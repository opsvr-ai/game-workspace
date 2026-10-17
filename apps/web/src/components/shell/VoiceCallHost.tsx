/**
 * 语音通话 + 全局浮层宿主 —— 从 layouts/AppLayout.tsx 原样搬出，行为/样式/文案零变化。
 *
 * 收拢：
 *   - 语音自检入口 window.__chunlvVoice、start-voice-call 事件；
 *   - 主程序窗口「管语音」的 setVoiceOwner / 来电请求 / 聊天窗口通话条指令 / 通话状态镜像；
 *   - IncomingCallModal + VoiceCallBar + ServiceStartOverlay 的挂载。
 *
 * 注意：useVoiceCall **仍由 AppLayout 调用**（vc 以 props 传进来）。它的挂载 effect 需要
 * socketRef.current 已经就绪，而 React 的子组件 effect 先于父组件 effect 执行 ——
 * 如果放进这个子组件，会在 useSocket 连上之前读到 null，来电监听就注册不上了。
 */
import React, { useEffect } from 'react';
import IncomingCallModal from '../IncomingCallModal';
import VoiceCallBar from '../VoiceCallBar';
import ServiceStartOverlay from '../ServiceStartOverlay';
import type { useVoiceCall } from '../../hooks/useVoiceCall';
import {
  clearVoiceCallState,
  installVoiceCallCommandListener,
  installVoiceCallRequestListener,
  publishVoiceCallState,
  setVoiceOwner,
} from '../../utils/voiceCallWindow';

type VoiceCallApi = ReturnType<typeof useVoiceCall>;

interface Props {
  /** AppLayout 里 useVoiceCall(voiceSocketRef) 的返回值 */
  vc: VoiceCallApi;
}

const VoiceCallHost: React.FC<Props> = ({ vc }) => {
  // 语音自检入口：排查「打语音没声音」时不用让陪玩反复试，
  // 在控制台执行 window.__chunlvVoice.startCall('<对方userId>', '对方名字') 就能自己发起一通。
  useEffect(() => {
    (window as any).__chunlvVoice = vc;
  });
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { targetUserId, targetUserName } = e.detail || {};
      if (targetUserId) vc.startCall(targetUserId, targetUserName || '未知');
    };
    window.addEventListener('start-voice-call', handler as EventListener);
    return () => window.removeEventListener('start-voice-call', handler as EventListener);
  }, [vc.startCall]);

  // 主程序窗口 = 「管语音」的那个窗口：独立聊天窗口里点电话按钮会请它去打
  // （聊天窗口自己不能打：一个账号的来电是往 user:<id> 房间广播的，谁装了语音就谁响铃，
  //  开 3 个聊天窗口就会同时响 3 个。见 utils/voiceCallWindow.ts）。
  useEffect(() => {
    setVoiceOwner(true);
    return () => {
      setVoiceOwner(false);
      // 主程序关了，镜像键也要删 —— 免得下次开聊天窗口读到「上一通还在通话中」。
      clearVoiceCallState();
    };
  }, []);
  useEffect(
    () =>
      installVoiceCallRequestListener(({ targetUserId, targetUserName }) => {
        // 打不了必须回一句话给点按钮的那个窗口，否则那边还是「点了一点反应没有」。
        if (vc.callState.status !== 'idle') return '正在通话中，请先挂断';
        void vc.startCall(targetUserId, targetUserName || '未知');
        return null;
      }),
    [vc.startCall, vc.callState.status],
  );
  // 聊天窗口里的通话条按钮都转发到这里（挂断 / 接听 / 拒接 / 调音量）——
  // 电话只有主程序窗口这一份（见 utils/voiceCallWindow.ts）。
  useEffect(
    () =>
      installVoiceCallCommandListener((cmd) => {
        if (cmd.action === 'hangup') vc.hangup();
        else if (cmd.action === 'reject') vc.rejectCall();
        else if (cmd.action === 'accept') void vc.acceptCall();
        else if (cmd.action === 'setVolume' && typeof cmd.value === 'number') vc.setVolume(cmd.value);
      }),
    [vc.hangup, vc.rejectCall, vc.acceptCall, vc.setVolume],
  );
  // 把通话状态镜像出去 —— 聊天窗口顶上要跟着显示「正在语音通话 mm:ss」，
  // 聊天窗口里的通话条也读它（带 volume）。空了就把键删掉，不留旧状态。
  useEffect(() => {
    if (vc.callState.status === 'idle') {
      clearVoiceCallState();
      return;
    }
    publishVoiceCallState({
      status: vc.callState.status,
      peerId: vc.callState.peerId,
      peerName: vc.callState.peerName,
      duration: vc.callState.duration,
      volume: vc.callState.volume,
    });
  }, [vc.callState.status, vc.callState.peerId, vc.callState.peerName, vc.callState.duration, vc.callState.volume]);

  const VoiceCallHandler = () => (
    <>
      <IncomingCallModal
        open={vc.callState.status === 'ringing' || vc.callState.status === 'calling'}
        callerName={vc.callState.peerName}
        calling={vc.callState.status === 'calling'}
        onAccept={vc.acceptCall}
        onReject={vc.rejectCall}
      />
      {vc.callState.status === 'connected' && (
        <VoiceCallBar
          peerName={vc.callState.peerName}
          duration={vc.callState.duration}
          volume={vc.callState.volume}
          onVolumeChange={vc.setVolume}
          onHangup={vc.hangup}
        />
      )}
    </>
  );

  return (
    <>
      <VoiceCallHandler />
      <ServiceStartOverlay />
    </>
  );
};

export default VoiceCallHost;
