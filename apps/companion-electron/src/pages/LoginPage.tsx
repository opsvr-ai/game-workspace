import React, { useState } from 'react';
import { Input, Button, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';

interface Props {
  onLogin: (user: any) => void;
}

const LoginPage: React.FC<Props> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      message.warning('请输入用户名和密码');
      return;
    }
    setLoading(true);
    try {
      const result = await window.electronAPI.login({
        username: username.trim(),
        password,
      });
      if (result.success) {
        message.success('登录成功');
        onLogin(result.user);
      } else {
        message.error(result.message || '登录失败');
      }
    } catch (err: any) {
      message.error(err.message || '网络错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0F172A 0%, #1A2332 100%)',
      }}
    >
      <div
        style={{
          width: 380,
          padding: '40px 32px',
          background: '#1E293B',
          borderRadius: 16,
          border: '1px solid rgba(148,163,184,0.1)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🎮</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#00D4FF' }}>
            蠢驴电竞陪玩
          </div>
          <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>
            陪玩师客户端
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input
            prefix={<UserOutlined style={{ color: '#64748B' }} />}
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onPressEnter={handleLogin}
            size="large"
            style={{ background: '#0F172A', border: '1px solid rgba(148,163,184,0.15)', color: '#E2E8F0' }}
          />
          <Input.Password
            prefix={<LockOutlined style={{ color: '#64748B' }} />}
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onPressEnter={handleLogin}
            size="large"
            style={{ background: '#0F172A', border: '1px solid rgba(148,163,184,0.15)', color: '#E2E8F0' }}
          />
          <Button
            type="primary"
            block
            size="large"
            loading={loading}
            onClick={handleLogin}
            style={{
              height: 44,
              background: 'linear-gradient(135deg, #00D4FF, #0099CC)',
              border: 'none',
              fontWeight: 600,
              fontSize: 15,
              marginTop: 8,
            }}
          >
            登 录
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
