import React from 'react';
import { Card, Button, Typography, Descriptions, Tag } from 'antd';
import { LogoutOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

interface Props {
  user: any;
  onLogout: () => void;
}

const SettingsPage: React.FC<Props> = ({ user, onLogout }) => {
  return (
    <div>
      <Title level={4} style={{ color: '#E2E8F0' }}>⚙️ 设置</Title>

      <Card size="small" style={{ marginBottom: 16, background: '#1E293B' }} title="账号信息">
        <Descriptions column={1} size="small">
          <Descriptions.Item label={<span style={{ color: '#94A3B8' }}>用户名</span>}>
            <span style={{ color: '#E2E8F0' }}>{user?.username || '-'}</span>
          </Descriptions.Item>
          <Descriptions.Item label={<span style={{ color: '#94A3B8' }}>显示名</span>}>
            <span style={{ color: '#E2E8F0' }}>{user?.displayName || user?.username || '-'}</span>
          </Descriptions.Item>
          <Descriptions.Item label={<span style={{ color: '#94A3B8' }}>角色</span>}>
            <Tag color="orange">陪玩师</Tag>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small" style={{ marginBottom: 16, background: '#1E293B' }} title="关于">
        <Descriptions column={1} size="small">
          <Descriptions.Item label={<span style={{ color: '#94A3B8' }}>版本</span>}>
            <span style={{ color: '#E2E8F0' }}>v1.0.0</span>
          </Descriptions.Item>
          <Descriptions.Item label={<span style={{ color: '#94A3B8' }}>平台</span>}>
            <span style={{ color: '#E2E8F0' }}>Windows 桌面客户端</span>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Button
        danger
        block
        size="large"
        icon={<LogoutOutlined />}
        onClick={onLogout}
        style={{ fontWeight: 600 }}
      >
        退出登录
      </Button>
    </div>
  );
};

export default SettingsPage;
