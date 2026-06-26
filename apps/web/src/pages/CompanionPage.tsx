import React, { useEffect, useState, useCallback } from 'react';
import { Card, Table, Tag, Typography, Button, Space, Row, Col, List, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';

const { Text } = Typography;

interface Customer { id: string; wechatId: string; platform: string; totalSpent: number; notes?: string; }
interface Order { id: string; gameName: string; type: string; status: string; amount: number; createdAt: string; customFields?: any; }
interface Revenue { companionId: string; total: number; transactions: any[]; }

const orderTypeConfig: Record<string, { color: string; label: string }> = {
  NEW: { color: 'blue', label: '新单' }, RENEW: { color: 'cyan', label: '续费' },
  REPURCHASE: { color: 'purple', label: '复购' }, TIP: { color: 'orange', label: '打赏' },
};

const CompanionPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [companion, setCompanion] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!user?.companionId) return;
    setLoading(true);
    try {
      const [custRes, orderRes, compRes, revRes] = await Promise.all([
        http.get('/customers'),
        http.get('/orders'),
        http.get(`/companions/${user.companionId}`),
        http.get(`/companions/${user.companionId}/revenue`),
      ]);
      setCustomers(custRes.data.data ?? []);
      setOrders((orderRes.data.data ?? []).slice(0, 50));
      setCompanion(compRes.data.data);
      setRevenue(revRes.data.data);
    } catch { message.error('加载数据失败'); }
    finally { setLoading(false); }
  }, [user?.companionId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const gameProfiles = companion?.games || [];
  const totalRevenue = revenue?.total || 0;

  if (!user || user.role !== 'COMPANION') {
    return <div style={{ padding: 40, textAlign: 'center' }}><Text type="secondary">仅陪玩可访问</Text></div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Text strong style={{ fontSize: 18 }}>我的工作台</Text>
          <br /><Text type="secondary">欢迎，{user.username}</Text>
        </div>
        <Button icon={React.createElement(ReloadOutlined)} onClick={fetchAll} loading={loading}>刷新</Button>
      </div>

      {/* Stats */}
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col span={6}><Card size="small"><Stat title="我的客户" value={customers.length} color="#007AFF" /></Card></Col>
        <Col span={6}><Card size="small"><Stat title="本月订单" value={orders.length} color="#34C759" /></Card></Col>
        <Col span={6}><Card size="small"><Stat title="本月收入" value={`¥${totalRevenue.toFixed(2)}`} color="#FF4757" /></Card></Col>
        <Col span={6}><Card size="small"><Stat title="游戏数" value={gameProfiles.length} color="#FF9500" /></Card></Col>
      </Row>

      <Row gutter={16}>
        {/* 左侧：我的客户 */}
        <Col span={12}>
          <Card title="我的客户" size="small" style={{ marginBottom: 16 }}>
            {customers.length === 0 ? <Text type="secondary">暂无客户</Text> : (
              <List size="small" dataSource={customers.slice(0, 10)} renderItem={(c: Customer) => (
                <List.Item style={{ padding: '6px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span>💬 {c.wechatId}</span>
                    <span style={{ color: '#94A3B8', fontSize: 12 }}>{c.platform || '-'}</span>
                    <span style={{ fontWeight: 600, color: '#FF4757' }}>¥{c.totalSpent?.toFixed(2) || '0.00'}</span>
                  </div>
                </List.Item>
              )} />
            )}
          </Card>

          {/* 游戏资料 */}
          <Card title="我的游戏" size="small">
            {gameProfiles.length === 0 ? <Text type="secondary">未设置</Text> : (
              <Space wrap>
                {gameProfiles.map((g: any, i: number) => (
                  <Tag key={i} color="blue" style={{ padding: '4px 10px', fontSize: 13 }}>
                    🎮 {g.game} <b>{g.rank || '?'}</b> {g.hasAccount ? '✓有号' : '无号'}
                  </Tag>
                ))}
              </Space>
            )}
          </Card>
        </Col>

        {/* 右侧：订单记录 */}
        <Col span={12}>
          <Card title="接单记录" size="small">
            <Table size="small" dataSource={orders} rowKey="id" pagination={{ pageSize: 10, size: 'small' }}
              columns={[
                { title: '游戏', dataIndex: 'gameName', width: 100 },
                { title: '类型', dataIndex: 'type', width: 70, render: (t: string) => <Tag color={orderTypeConfig[t]?.color}>{orderTypeConfig[t]?.label || t}</Tag> },
                { title: '金额', dataIndex: 'amount', width: 80, render: (v: number) => <span style={{ color: '#FF4757', fontWeight: 600 }}>¥{v?.toFixed(2)}</span> },
                { title: '状态', dataIndex: 'status', width: 70, render: (s: string) => <Tag>{s}</Tag> },
                { title: '时间', dataIndex: 'createdAt', width: 120, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-' },
                { title: '客户', key: 'customer', width: 130, render: (_: any, r: Order) => {
                  const cf = r.customFields || {};
                  return <span style={{ fontSize: 12, color: '#64748B' }}>{cf.customerWechat ? `💬 ${cf.customerWechat}` : '-'} {cf.customerRoomCode ? `🏠 ${cf.customerRoomCode}` : ''}</span>;
                }},
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

const Stat: React.FC<{ title: string; value: string | number; color: string }> = ({ title, value, color }) => (
  <div style={{ textAlign: 'center' }}>
    <div style={{ fontSize: 12, color: '#86868B', marginBottom: 4 }}>{title}</div>
    <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
  </div>
);

export default CompanionPage;
