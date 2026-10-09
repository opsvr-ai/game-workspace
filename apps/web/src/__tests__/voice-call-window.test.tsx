import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChatHeader from '../components/chat/ChatHeader';
import { useVoiceCallStore } from '../stores/voiceCallStore';
import {
  installVoiceCallRequestListener,
  installVoiceCallStateMirror,
  isVoiceOwner,
  publishVoiceCallState,
  requestVoiceCallInOtherWindow,
  setVoiceOwner,
  startVoiceCallFromCurrentWindow,
} from '../utils/voiceCallWindow';

/**
 * 「聊天框点语音按钮没反应」（老板 2026-10-10）。
 *
 * 根因：聊天默认开成**独立的系统窗口**，而语音整套东西（useVoiceCall + 那个
 * `start-voice-call` 监听）只装在主程序窗口（AppLayout）里 —— 聊天窗口里的电话按钮
 * 只是往自己窗口 dispatch 了一个没人听的 CustomEvent，所以「一点反应都没有」。
 *
 * 现在的规矩：一个窗口（主程序）管打/接，别的窗口只显示（不然开 3 个聊天窗口，
 * 来电话会同时响 3 个 —— 服务端是往 user:<id> 房间广播的）。
 * 这里守四件事：
 *   ① 主程序窗口（owner）点点电话 = 照旧就地发起（派发 start-voice-call）；
 *   ② 独立聊天窗口点电话 = 写跨窗口请求（不再石沉大海），拿回执、打不了要说人话；
 *   ③ 主程序窗口收到请求会真的调 startCall，打不了会回一句原因；主程序不在 → 提示去任务栏；
 *   ④ 主程序把通话状态镜像出来，聊天窗口顶上照样显示「正在语音通话」。
 */

const { infoSpy, warnSpy } = vi.hoisted(() => ({
  infoSpy: vi.fn(),
  warnSpy: vi.fn(),
}));

vi.mock('../utils/feedback', async () => {
  const actual = (await vi.importActual('../utils/feedback')) as Record<string, unknown>;
  return {
    ...actual,
    message: {
      ...(actual.message as Record<string, unknown>),
      info: infoSpy,
      warning: warnSpy,
      success: vi.fn(),
      error: vi.fn(),
    },
  };
});

/** 手动派发 storage 事件（jsdom 不会给同窗口的写入自动派发）。 */
function fireStorage(key: string, newValue: string | null) {
  window.dispatchEvent(
    new StorageEvent('storage', { key, newValue, storageArea: localStorage }),
  );
}

describe('聊天框的语音按钮：主程序窗口 / 独立聊天窗口（老板 2026-10-10）', () => {
  beforeEach(() => {
    localStorage.clear();
    infoSpy.mockReset();
    warnSpy.mockReset();
    setVoiceOwner(false);
    useVoiceCallStore.setState({ call: { status: 'idle' } });
  });

  it('主程序窗口（能自己打）：点了就地发起，不写跨窗口请求', () => {
    setVoiceOwner(true);
    expect(isVoiceOwner()).toBe(true);
    const seen: any[] = [];
    const onLocal = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('start-voice-call', onLocal);

    startVoiceCallFromCurrentWindow('u-peer', '童祥瑞');

    window.removeEventListener('start-voice-call', onLocal);
    expect(seen).toEqual([{ targetUserId: 'u-peer', targetUserName: '童祥瑞' }]);
    expect(localStorage.getItem('chunlv:voice-call-request')).toBeNull();
  });

  it('独立聊天窗口（没有语音能力）：点电话会写一条跨窗口请求给主程序窗口', async () => {
    setVoiceOwner(false);
    const pending = requestVoiceCallInOtherWindow('u-peer', '童祥瑞', 50);

    // 请求已经写出去（主程序窗口那边靠这个键的 storage 事件接活）
    const req = JSON.parse(localStorage.getItem('chunlv:voice-call-request') || '{}');
    expect(req.targetUserId).toBe('u-peer');
    expect(req.targetUserName).toBe('童祥瑞');
    expect(req.id).toBeTruthy();

    // 主程序窗口回执「已受理」
    fireStorage('chunlv:voice-call-ack', JSON.stringify({ id: req.id, ok: true, at: Date.now() }));
    await expect(pending).resolves.toEqual({ ok: true, reason: undefined });
  });

  it('主程序窗口收到请求：真的去调 startCall，并由它来回执', () => {
    const start = vi.fn();
    const off = installVoiceCallRequestListener(({ targetUserId, targetUserName }) => {
      start(targetUserId, targetUserName);
      return null;
    });

    fireStorage(
      'chunlv:voice-call-request',
      JSON.stringify({ id: 'req-1', targetUserId: 'u-peer', targetUserName: '童祥瑞', at: Date.now() }),
    );

    expect(start).toHaveBeenCalledWith('u-peer', '童祥瑞');
    const ack = JSON.parse(localStorage.getItem('chunlv:voice-call-ack') || '{}');
    expect(ack).toMatchObject({ id: 'req-1', ok: true });
    off();
  });

  it('正在通话中 → 回执带上原因，发起方看到的是人话而不是「没反应」', async () => {
    const off = installVoiceCallRequestListener(() => '正在通话中，请先挂断');
    const pending = requestVoiceCallInOtherWindow('u-peer', '童祥瑞', 50);
    const req = JSON.parse(localStorage.getItem('chunlv:voice-call-request') || '{}');

    fireStorage('chunlv:voice-call-ack', JSON.stringify({ id: req.id, ok: false, reason: '正在通话中，请先挂断', at: Date.now() }));
    await expect(pending).resolves.toEqual({ ok: false, reason: '正在通话中，请先挂断' });
    off();
  });

  it('主程序窗口不在（没人应答）→ 超时后提示去任务栏打开主程序，不会一直转', async () => {
    setVoiceOwner(false);
    const res = await requestVoiceCallInOtherWindow('u-peer', '童祥瑞', 30);
    expect(res.ok).toBe(false);
    expect(res.reason).toBeUndefined();
  });

  it('主程序窗口把通话状态镜像出去，聊天窗口顶上跟着显示「正在语音通话」', async () => {
    publishVoiceCallState({ status: 'connected', peerId: 'u-peer', peerName: '童祥瑞', duration: 7 });
    const off = installVoiceCallStateMirror();
    expect(useVoiceCallStore.getState().call).toMatchObject({ status: 'connected', peerId: 'u-peer' });

    // 通话结束 → 聊天窗口这边也要跟着收掉
    publishVoiceCallState({ status: 'idle' });
    fireStorage('chunlv:voice-call-state', JSON.stringify({ status: 'idle', at: Date.now() }));
    expect(useVoiceCallStore.getState().call.status).toBe('idle');
    off();

    // 走到界面上：ChatHeader 读到这个状态就显示通话中
    publishVoiceCallState({ status: 'connected', peerId: 'u-peer', peerName: '童祥瑞', duration: 12 });
    const off2 = installVoiceCallStateMirror();
    render(
      <MemoryRouter>
        <ChatHeader name="童祥瑞" role="CS" userId="u-peer" onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/正在语音通话/)).toBeTruthy();
    off2();
  });

  it('聊天窗口点界面上的电话图标：走的是跨窗口通道（不再只 dispatch 没人听的本地事件）', async () => {
    setVoiceOwner(false);
    let localFired = 0;
    const onLocal = () => { localFired += 1; };
    window.addEventListener('start-voice-call', onLocal);
    render(
      <MemoryRouter>
        <ChatHeader name="童祥瑞" role="CS" userId="u-peer" onClose={() => {}} onCallClick={() => startVoiceCallFromCurrentWindow('u-peer', '童祥瑞')} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTitle('语音通话'));
    window.removeEventListener('start-voice-call', onLocal);

    expect(localFired).toBe(0);
    const req = JSON.parse(localStorage.getItem('chunlv:voice-call-request') || '{}');
    expect(req.targetUserId).toBe('u-peer');
  });
});
