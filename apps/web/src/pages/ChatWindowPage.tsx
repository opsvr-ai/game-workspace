// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Spin } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { ChatProvider } from '../components/chat/ChatProvider';
import ChatPanel from '../components/chat/ChatPanel';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import http from '../api/client';
import { BG } from '../styles/tokens';

/**
 * 独立的聊天窗口（老板 2026-10-05：跟微信一样，一个联系人一个窗口、能同时开好几个、
 * 每个都能最小化到任务栏）。由 utils/chatWindow.ts 的 openChatWindow() 打开 ——
 * Electron 客户端里是真的应用窗口，浏览器里是弹窗。
 *
 * 这个窗口只渲染一个聊天面板，没有左侧菜单 / 顶栏，不是 AppLayout 的子路由。
 */

const Center: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: BG.base,
      color: '#949BA4',
      fontSize: 14,
    }}
  >
    {children}
  </div>
);

/**
 * 新窗口的 sessionStorage 跟主窗口不共享（accessToken 存在 sessionStorage），
 * 但 localStorage 的 refreshToken 是共享的 —— 所以进窗口先用 refreshToken 换一张
 * accessToken 放进本窗口，再挂 ChatProvider（useSocket 只在启动时读一次 sessionStorage，
 * 必须先有令牌，否则这个窗口连不上、也收不到新消息）。
 */
async function ensureAccessToken(): Promise<boolean> {
  if (sessionStorage.getItem('accessToken')) return true;
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return false;
  try {
    const { data } = await http.post('/auth/refresh', { refreshToken });
    const accessToken = (data as any)?.data?.accessToken;
    const nextRefresh = (data as any)?.data?.refreshToken;
    if (!accessToken) return false;
    sessionStorage.setItem('accessToken', accessToken);
    if (nextRefresh) localStorage.setItem('refreshToken', nextRefresh);
    return true;
  } catch {
    return false;
  }
}

const StandaloneChat: React.FC = () => {
  const [params] = useSearchParams();
  const room = params.get('room') || '';
  const uid = params.get('uid') || '';
  const name = params.get('name') || '聊天';
  const avatar = params.get('avatar') || '';
  const role = params.get('role') || '';
  // 带了 order= 参数（哪怕是空的）= 这次打开明确了订单上下文（空串 = 清掉）；
  // 完全没带 = 保持服务端记着的那一单（从会话列表 / 铃铛进来）。
  const orderParam = params.get('order');
  const order = params.has('order') ? orderParam || null : undefined;
  const [ready, setReady] = useState(false);
  const [convId, setConvId] = useState(room);

  useEffect(() => {
    document.title = name + ' · 聊天';
  }, [name]);

  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    (async () => {
      const participant = {
        userId: uid,
        username: name,
        displayName: name,
        avatar: avatar || undefined,
        role,
      };
      await useChatStore.getState().openConversation(room, participant, order);
      if (cancelled) return;
      setConvId(useChatStore.getState().activeConversationId || room);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [room, uid, name, avatar, role, order]);

  if (!room) return <Center>缺少会话参数</Center>;
  if (!ready) {
    return (
      <Center>
        <Spin size="large" />
      </Center>
    );
  }

  const participant = {
    userId: uid,
    username: name,
    displayName: name,
    avatar: avatar || undefined,
    role,
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: BG.base }}>
      <ChatPanel
        roomId={convId}
        participant={participant}
        orderInfo={order}
        onClose={() => window.close()}
      />
    </div>
  );
};

const ChatWindowPage: React.FC = () => {
  const [state, setState] = useState<'loading' | 'ok' | 'noauth'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await ensureAccessToken();
      if (!ok) {
        if (!cancelled) setState('noauth');
        return;
      }
      if (!useAuthStore.getState().user) {
        await useAuthStore.getState().fetchUser();
      }
      if (!cancelled) setState(useAuthStore.getState().user ? 'ok' : 'noauth');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state === 'noauth') window.location.href = '/login';
  }, [state]);

  if (state !== 'ok') {
    return (
      <Center>
        <Spin size="large" />
      </Center>
    );
  }
  return (
    <ChatProvider>
      <StandaloneChat />
    </ChatProvider>
  );
};

export default ChatWindowPage;
