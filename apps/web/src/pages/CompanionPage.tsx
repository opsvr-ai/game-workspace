import React, { useEffect, useState, useCallback } from 'react';
import { Card, Typography, Button, Row, Col, Space, Tag, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';

const { Text } = Typography;

const CompanionPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [companion, setCompanion] = useState<any>(null);
  const [revenue, setRevenue] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (!user?.companionId) return;
    setLoading(true);
    try {
      const [compRes, revRes, custRes, orderRes] = await Promise.all([
        http.get(`/companions/${user.companionId}`),
        http.get(`/companions/${user.companionId}/revenue`),
        http.get('/customers'),
        http.get('/orders'),
      ]);
      const data = compRes.data.data;
      data._customers = custRes.data.data ?? [];
      data._orders = orderRes.data.data ?? [];
      data._revenue = revRes.data.data;
      setCompanion(data);
      setRevenue(revRes.data.data);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, [user?.companionId]);

  useEffect(() => { fetch(); }, [fetch]);

  const gameProfiles = companion?.games || [];
  const customers = companion?._customers || [];
  const orders = companion?._orders || [];
  const totalRevenue = revenue?.total || 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Text strong style={{ fontSize: 18 }}>🏠 首页</Text>
          <br /><Text type="secondary">欢迎，{user?.username}</Text>
        </div>
        <Button icon={React.createElement(ReloadOutlined)} onClick={fetch} loading={loading}>刷新</Button>
      </div>

      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col span={6}><Card size="small" style={{ borderRadius: 12 }}><StatBox title="我的客户" value={customers.length} color="#007AFF" /></Card></Col>
        <Col span={6}><Card size="small" style={{ borderRadius: 12 }}><StatBox title="接单总数" value={orders.length} color="#34C759" /></Card></Col>
        <Col span={6}><Card size="small" style={{ borderRadius: 12 }}><StatBox title="本月收入" value={`¥${totalRevenue.toFixed(2)}`} color="#FF4757" /></Card></Col>
        <Col span={6}><Card size="small" style={{ borderRadius: 12 }}><StatBox title="游戏数" value={gameProfiles.length} color="#FF9500" /></Card></Col>
      </Row>

      <Card title="我的游戏" size="small" style={{ borderRadius: 12 }}>
        {gameProfiles.length === 0 ? <Text type="secondary">未设置游戏资料</Text> : (
          <Space wrap>
            {gameProfiles.map((g: any, i: number) => (
              <Tag key={i} color="blue" style={{ padding: '4px 12px', fontSize: 13, borderRadius: 8 }}>
                🎮 {g.game} <b>{g.rank || '?'}</b> {g.hasAccount ? '✓有号' : '无号'}
              </Tag>
            ))}
          </Space>
        )}
      </Card>
    </div>
  );
};

const StatBox: React.FC<{ title: string; value: string | number; color: string }> = ({ title, value, color }) => (
  <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <div style={{ fontSize: 12, color: '#86868B', marginBottom: 4 }}>{title}</div>
    <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
  </div>
);

export default CompanionPage;
