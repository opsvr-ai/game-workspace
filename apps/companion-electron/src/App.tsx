import React, { useState, useEffect, useCallback } from 'react';
import { ConfigProvider, Tabs, Badge, Tag } from 'antd';
import {
  HomeOutlined,
  UnorderedListOutlined,
  WalletOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import LoginPage from './pages/LoginPage';
import WorkbenchPage from './pages/WorkbenchPage';
import OrderPoolPage from './pages/OrderPoolPage';
import WalletPage from './pages/WalletPage';
import SettingsPage from './pages/SettingsPage';

const companionStatusConfig: Record<string, { color: string; label: string }> = {
  ONLINE: { color: 'green', label: '空闲' },
  BUSY: { color: 'red', label: '接单中' },
  IDLE: { color: 'gold', label: '娱乐中' },
  RESTING: { color: 'orange', label: '休息中' },
  OFFLINE: { color: 'default', label: '离线' },
};

const App: React.FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('workbench');
  const [currentStatus, setCurrentStatus] = useState('OFFLINE');
  const [orderBadge, setOrderBadge] = useState(0);

  // Listen for navigation events from main process
  useEffect(() => {
    if (!window.electronAPI) return;

    const unsub = window.electronAPI.onWsEvent('nav:orderPool', () => {
      setActiveTab('orders');
    });

    window.electronAPI.onWsEvent('ws:orderNew', () => {
      setOrderBadge((n) => n + 1);
    });

    window.electronAPI.onWsEvent('ws:orderUrgent', () => {
      setOrderBadge((n) => n + 1);
    });

    window.electronAPI.onWsEvent('ws:poolUpdated', () => {
      // No specific action needed, OrderPoolPage handles it
    });

    return () => unsub();
  }, []);

  const handleLogin = useCallback((loginUser: any) => {
    setUser(loginUser);
    setIsLoggedIn(true);
  }, []);

  const handleLogout = useCallback(async () => {
    if (window.electronAPI) {
      await window.electronAPI.logout();
    }
    setUser(null);
    setIsLoggedIn(false);
    setCurrentStatus('OFFLINE');
  }, []);

  const handleStatusChange = useCallback((status: string) => {
    setCurrentStatus(status);
    if (window.electronAPI) {
      window.electronAPI.onStatusChanged(status);
    }
  }, []);

  if (!isLoggedIn) {
    return (
      <ConfigProvider theme={{ token: { colorPrimary: '#00D4FF' } }}>
        <LoginPage onLogin={handleLogin} />
      </ConfigProvider>
    );
  }

  const statusCfg = companionStatusConfig[currentStatus] || companionStatusConfig.OFFLINE;

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#00D4FF',
          colorBgContainer: '#1E293B',
          colorBgElevated: '#1E293B',
          colorText: '#E2E8F0',
          colorTextSecondary: '#94A3B8',
          colorBorder: 'rgba(148,163,184,0.15)',
          borderRadius: 8,
        },
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        {/* Top bar */}
        <div
          style={{
            height: 48,
            background: '#1A2332',
            borderBottom: '1px solid rgba(148,163,184,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#00D4FF' }}>
              蠢驴电竞
            </span>
            <Tag color={statusCfg.color} style={{ fontSize: 13, padding: '2px 12px' }}>
              {statusCfg.label}
            </Tag>
            {user?.displayName || user?.username}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {activeTab === 'workbench' && (
            <WorkbenchPage onStatusChange={handleStatusChange} />
          )}
          {activeTab === 'orders' && (
            <OrderPoolPage onBadgeClear={() => setOrderBadge(0)} />
          )}
          {activeTab === 'wallet' && <WalletPage />}
          {activeTab === 'settings' && (
            <SettingsPage user={user} onLogout={handleLogout} />
          )}
        </div>

        {/* Bottom tab bar */}
        <div
          style={{
            height: 56,
            background: '#1A2332',
            borderTop: '1px solid rgba(148,163,184,0.1)',
            display: 'flex',
            flexShrink: 0,
          }}
        >
          {[
            { key: 'workbench', icon: <HomeOutlined />, label: '工作台' },
            {
              key: 'orders',
              icon: <UnorderedListOutlined />,
              label: '订单池',
              badge: orderBadge,
            },
            { key: 'wallet', icon: <WalletOutlined />, label: '钱包' },
            { key: 'settings', icon: <SettingOutlined />, label: '设置' },
          ].map((tab) => (
            <div
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                if (tab.key === 'orders') setOrderBadge(0);
              }}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: activeTab === tab.key ? '#00D4FF' : '#64748B',
                fontSize: 11,
                gap: 2,
                borderTop: activeTab === tab.key ? '2px solid #00D4FF' : '2px solid transparent',
              }}
            >
              <div style={{ position: 'relative', fontSize: 20 }}>
                {tab.icon}
                {tab.badge && tab.badge > 0 ? (
                  <span
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -10,
                      background: '#FF4757',
                      color: 'white',
                      borderRadius: 10,
                      padding: '0 5px',
                      fontSize: 10,
                      fontWeight: 700,
                      minWidth: 16,
                      textAlign: 'center',
                      lineHeight: '16px',
                    }}
                  >
                    {tab.badge > 99 ? '99+' : tab.badge}
                  </span>
                ) : null}
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
