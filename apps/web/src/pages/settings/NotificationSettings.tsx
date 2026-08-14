// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Card, Switch, Button, Typography, Space, message } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';

const { Text } = Typography;

const NotificationSettings: React.FC = () => {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await configApi.getAll();
      setConfig(data.data);
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const update = (key: string, value: boolean) => setConfig((c: any) => ({ ...c, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await configApi.update({
        'notification.sound': config?.['notification.sound'] ?? true,
        'notification.desktop': config?.['notification.desktop'] ?? true,
        'notification.badge': config?.['notification.badge'] ?? true,
      });
      message.success('通知设置已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !config) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">加载中...</Text></div>;
  }

  const rows = [
    { key: 'notification.sound', label: '声音提醒', desc: '收到新消息时播放提示音' },
    { key: 'notification.desktop', label: '桌面通知', desc: '浏览器/客户端弹出系统通知' },
    { key: 'notification.badge', label: '角标提醒', desc: '在消息入口显示未读数量角标' },
  ];

  return (
    <div>
      <Card
        title="🔔 通知设置"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button type="primary" icon={React.createElement(SaveOutlined)} loading={saving} onClick={save}>保存</Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          配置全站默认的消息通知方式，管理员可随时调整。
        </Text>
        {rows.map((r) => (
          <div
            key={r.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 0',
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            <div>
              <Text style={{ display: 'block' }}>{r.label}</Text>
              <Text type="secondary">{r.desc}</Text>
            </div>
            <Switch checked={!!config?.[r.key]} onChange={(v) => update(r.key, v)} />
          </div>
        ))}
      </Card>
    </div>
  );
};

export default NotificationSettings;
