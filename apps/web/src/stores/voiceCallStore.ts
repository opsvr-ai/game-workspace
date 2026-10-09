import { create } from 'zustand';

export type VoiceCallStatus = 'idle' | 'ringing' | 'calling' | 'connected';

export interface ActiveVoiceCall {
  status: VoiceCallStatus;
  peerId?: string;
  peerName?: string;
  duration?: number;
  /** 通话音量（0~100）—— 独立聊天窗口里的通话条要能显示 / 拖动它。 */
  volume?: number;
}

interface VoiceCallStore {
  call: ActiveVoiceCall;
  setCall: (call: ActiveVoiceCall) => void;
}

// 全局语音通话状态：让聊天头部等任意组件都能读到“正在通话 + 计时”，
// 而不必把 callState 一层层传下去。
export const useVoiceCallStore = create<VoiceCallStore>((set) => ({
  call: { status: 'idle' },
  setCall: (call) => set({ call }),
}));
