import React, { useState, useEffect, useCallback } from 'react';
import { ConfigProvider, Tag, Space, Dropdown } from 'antd';
import {
  HomeOutlined, UnorderedListOutlined, WalletOutlined,
  TeamOutlined, FileTextOutlined, HistoryOutlined,
  SettingOutlined, GlobalOutlined,
} from '@ant-design/icons';
import LoginPage from './pages/LoginPage';
import WorkbenchPage from './pages/WorkbenchPage';

const companionStatusConfig: Record<string, { color: string; label: string }> = {
  AVAILABLE: { color: 'green', label: '空闲' },
  BUSY: { color: 'red', label: '接单' },
  ENTERTAINMENT: { color: 'gold', label: '娱乐' },
  RESTING: { color: 'orange', label: '休息' },
  OFFLINE: { color: 'default', label: '离线' },
};

const tabs = [
  { key: 'workbench', icon: <HomeOutlined />, label: '工作台' },
  { key: 'pool', icon: <UnorderedListOutlined />, label: '订单池' },
  { key: 'billing', icon: <WalletOutlined />, label: '报账' },
  { key: 'customers', icon: <TeamOutlined />, label: '客户' },
  { key: 'orders', icon: <FileTextOutlined />, label: '接单' },
  { key: 'dispatch', icon: <HistoryOutlined />, label: '派单' },
];

const App: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('workbench');
  const [currentStatus, setCurrentStatus] = useState('OFFLINE');
  const [orderBadge, setOrderBadge] = useState(0);
  const [serverUrl, setServerUrl] = useState('');
  const [loadedPages, setLoadedPages] = useState<Record<string, any>>({});

  useEffect(() => {
    if (window.electronAPI) window.electronAPI.getServerUrl().then(setServerUrl);
  }, []);

  // Lazy-load page components on demand
  useEffect(() => {
    if (loadedPages[activeTab]) return;
    let cancelled = false;
    const loader = async () => {
      let mod: any = null;
      try {
        switch (activeTab) {
          case 'pool': mod = await import('./pages/OrderPoolPage'); break;
          case 'billing': mod = await import('../../web/src/pages/BillingOverview'); break;
          case 'customers': mod = await import('../../web/src/pages/CustomersPage'); break;
          case 'orders': mod = await import('../../web/src/pages/OrdersPage'); break;
          case 'dispatch': mod = await import('../../web/src/pages/DispatchPage'); break;
        }
      } catch { /* page may fail to load — handled by null check */ }
      if (!cancelled && mod) setLoadedPages(prev => ({ ...prev, [activeTab]: mod.default || mod }));
    };
    loader();
    return () => { cancelled = true; };
  }, [activeTab]);

  useEffect(() => {
    if (!window.electronAPI) return;
    const u1 = window.electronAPI.onWsEvent('nav:orderPool', () => setActiveTab('pool'));
    const u2 = window.electronAPI.onWsEvent('ws:orderNew', () => setOrderBadge(n => n + 1));
    const u3 = window.electronAPI.onWsEvent('ws:orderUrgent', () => setOrderBadge(n => n + 1));
    return () => { u1(); u2(); u3(); };
  }, []);

  const handleLogin = useCallback((u: any) => { setUser(u); setIsLoggedIn(true); }, []);
  const handleLogout = useCallback(async () => {
    if (window.electronAPI) await window.electronAPI.logout();
    setUser(null); setIsLoggedIn(false); setCurrentStatus('OFFLINE');
  }, []);
  const handleStatusChange = useCallback((status: string) => {
    setCurrentStatus(status);
    if (window.electronAPI) window.electronAPI.onStatusChanged(status);
  }, []);

  if (!isLoggedIn) return <ConfigProvider theme={{ token: { colorPrimary: '#00D4FF' } }}><LoginPage onLogin={handleLogin} /></ConfigProvider>;

  const statusCfg = companionStatusConfig[currentStatus] || companionStatusConfig.OFFLINE;
  const PageComponent = loadedPages[activeTab];

  return (
    <ConfigProvider theme={{ token: { colorPrimary: '#00D4FF', colorBgContainer: '#1E293B', colorBgElevated: '#1E293B', colorText: '#E2E8F0', colorTextSecondary: '#94A3B8', colorBorder: 'rgba(148,163,184,0.15)', borderRadius: 8 } }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <div style={{ height: 48, background: '#1A2332', borderBottom: '1px solid rgba(148,163,184,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0 }}>
          <Space>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#00D4FF' }}>蠢驴电竞</span>
            <Tag color={statusCfg.color} style={{ fontSize: 13, padding: '2px 12px' }}>{statusCfg.label}</Tag>
            <span style={{ color: '#E2E8F0', fontSize: 13 }}>{user?.displayName || user?.username}</span>
          </Space>
          <Space>
            <span style={{ color: '#64748B', fontSize: 12 }}><GlobalOutlined style={{ marginRight: 4 }} />{serverUrl || '...'}</span>
            <Dropdown menu={{ items: [{ key: 'logout', label: '退出登录', onClick: handleLogout }] }} trigger={['click']}>
              <SettingOutlined style={{ color: '#64748B', cursor: 'pointer', fontSize: 16 }} />
            </Dropdown>
          </Space>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {activeTab === 'workbench' && <WorkbenchPage onStatusChange={handleStatusChange} />}
          {activeTab !== 'workbench' && PageComponent && <PageComponent />}
        </div>
        <div style={{ height: 56, background: '#1A2332', borderTop: '1px solid rgba(148,163,184,0.1)', display: 'flex', flexShrink: 0 }}>
          {tabs.map(tab => (
            <div key={tab.key} onClick={() => { setActiveTab(tab.key); if (tab.key === 'pool') setOrderBadge(0); }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                color: activeTab === tab.key ? '#00D4FF' : '#64748B', fontSize: 11, gap: 2,
                borderTop: activeTab === tab.key ? '2px solid #00D4FF' : '2px solid transparent' }}>
              <div style={{ position: 'relative', fontSize: 20 }}>
                {tab.icon}
                {tab.key === 'pool' && orderBadge > 0 && (
                  <span style={{ position: 'absolute', top: -6, right: -10, background: '#FF4757', color: 'white', borderRadius: 10, padding: '0 5px', fontSize: 10, fontWeight: 700, minWidth: 16, textAlign: 'center', lineHeight: '16px' }}>{orderBadge > 99 ? '99+' : orderBadge}</span>
                )}
              </div>
              {tab.label}
            </div>
          ))}
        </div>
      </div>
    </ConfigProvider>
  );
};

export default App;
