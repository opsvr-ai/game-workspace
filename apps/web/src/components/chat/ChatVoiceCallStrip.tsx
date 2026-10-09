// craftsman-ignore: TS001
import React from 'react';
import { useVoiceCallStore } from '../../stores/voiceCallStore';
import VoiceCallBar from '../VoiceCallBar';
import IncomingCallModal from '../IncomingCallModal';
import { sendVoiceCallCommand } from '../../utils/voiceCallWindow';

/**
 * 独立聊天窗口里的通话条 / 来电卡片（老板 2026-10-10）。
 *
 * 老板原话：「如果你希望通话条直接出现在聊天窗口里（在聊天窗口就能挂断，不用切回主程序）……做呗」。
 *
 * 电话本身还是主程序窗口在跑（一个账号只该有一处接听，见 utils/voiceCallWindow.ts）——
 * 这里只读主程序镜像过来的状态，并把按钮动作**转发**过去：挂断 / 接听 / 拒接 / 拖音量。
 *
 * 只在「这一通电话的对方 == 本窗口正在聊的人」时显示，别的会话窗口 / 群里不该冒出来。
 */
interface Props {
  peerId?: string;
}

const ChatVoiceCallStrip: React.FC<Props> = ({ peerId }) => {
  const call = useVoiceCallStore((s) => s.call);
  if (!peerId || call.peerId !== peerId) return null;

  const wrap: React.CSSProperties = { padding: '8px 12px 0' };

  if (call.status === 'connected') {
    return (
      <div style={wrap}>
        <VoiceCallBar
          variant="inline"
          peerName={call.peerName}
          duration={call.duration}
          volume={call.volume}
          onVolumeChange={(v) => {
            // 先本窗口立刻变（拖动手感），再让主程序窗口把音量真正调下去（它会回镜像，最终一致）。
            useVoiceCallStore.getState().setCall({ ...call, volume: v });
            sendVoiceCallCommand('setVolume', v);
          }}
          onHangup={() => sendVoiceCallCommand('hangup')}
        />
      </div>
    );
  }

  if (call.status === 'ringing' || call.status === 'calling') {
    return (
      <div style={wrap}>
        <IncomingCallModal
          variant="inline"
          open
          callerName={call.peerName}
          calling={call.status === 'calling'}
          onAccept={() => sendVoiceCallCommand('accept')}
          onReject={() => sendVoiceCallCommand('reject')}
        />
      </div>
    );
  }

  return null;
};

export default ChatVoiceCallStrip;
