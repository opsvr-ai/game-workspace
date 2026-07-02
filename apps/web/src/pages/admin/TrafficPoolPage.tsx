import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Typography, Tag, Row, Col, Spin, Empty, Space } from 'antd';
import { ClockCircleOutlined, ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import { ordersApi } from '../../api/orders';
import CreateOrderModal from '../../components/CreateOrderModal';

const { Text, Title } = Typography;

const orderTypeConfig: Record<string, { label: string; color: string }> = {
  NEW: { label: '首单', color: 'green' },
  RENEW: { label: '续单', color: 'orange' },
  REPURCHASE: { label: '复购', color: 'blue' },
  TIP: { label: '打赏', color: 'purple' },
};

const TrafficPoolPage: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await ordersApi.pool();
      setOrders(data.data ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>📦 订单池</Title>
        <Space>
          <Button type="primary" icon={React.createElement(PlusOutlined)} onClick={() => setCreateOpen(true)}>发布订单</Button>
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetchData} loading={loading}>刷新</Button>
        </Space>
      </div>

      {loading ? (
        <Spin size="large" style={{ display: 'block', margin: '40px auto' }} />
      ) : orders.length === 0 ? (
        <Empty description="暂无待派订单" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {orders.map((order: any, idx: number) => (
            <Card key={order.id} size="small"
              style={{ borderLeft: `3px solid ${orderTypeConfig[order.type]?.color || '#1677ff'}` }}>
              <Row align="middle" gutter={8} wrap={false}>
                <Col><Tag style={{ background: '#f0f0f0', color: '#666', fontWeight: 700, minWidth: 24, textAlign: 'center', margin: 0 }}>{idx + 1}</Tag></Col>
                <Col><Tag color={orderTypeConfig[order.type]?.color || 'blue'} style={{ margin: 0 }}>{orderTypeConfig[order.type]?.label || order.type}</Tag></Col>
                <Col><Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>{order.gameName}</Text></Col>
                <Col><Text style={{ fontSize: 14, fontWeight: 700, color: '#1677ff', whiteSpace: 'nowrap' }}>¥{Number(order.amount).toFixed(0)}</Text></Col>
                {order.customFields?.deltaMode && <Col><Tag color="cyan" style={{ margin: 0 }}>{order.customFields.deltaMode}</Tag></Col>}
                {order.customFields?.deltaMission && <Col><Tag style={{ margin: 0 }}>{order.customFields.deltaMission}</Tag></Col>}
                {order.customFields?.deltaCount && <Col><Tag style={{ margin: 0 }}>{order.customFields.deltaCount}</Tag></Col>}
                {order.customFields?.customerSource && <Col><Tag color="orange" style={{ margin: 0 }}>📡{order.customFields.customerSource}</Tag></Col>}
                {order.customFields?.customerWechat && <Col><Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>💬{order.customFields.customerWechat}</Text></Col>}
                {order.customFields?.deltaNote && <Col><Text type="warning" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>📝{order.customFields.deltaNote}</Text></Col>}
                {order.customFields?.billingMode === 'round'
                  ? <Col><Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>🎯{order.duration || order.customFields?.deltaCount || '?'}局</Text></Col>
                  : order.duration && <Col><Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>⏱{order.duration}h</Text></Col>
                }
                <Col flex="auto" />
                <Col>
                  <Space size={6}>
                    {order.customer?.customerCode && <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>👤{order.customer.customerCode}</Text>}
                    <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                      {React.createElement(ClockCircleOutlined)} {new Date(order.createdAt).toLocaleDateString('zh-CN')} {new Date(order.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}
                    </Text>
                    <Tag color="orange">待派单</Tag>
                  </Space>
                </Col>
              </Row>
            </Card>
          ))}
        </div>
      )}
      <CreateOrderModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={fetchData} />
    </div>
  );
};

export default TrafficPoolPage;
