import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Tag, Typography, message, Row, Col, Progress, Modal, Tooltip, Space } from 'antd';
import { DollarOutlined, ThunderboltOutlined, MessageOutlined, CopyOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

const orderTypeConfig: Record<string, { color: string; label: string }> = {
  NEW: { color: 'green', label: '🆕 新单' },
  RENEW: { color: 'orange', label: '🔄 续单' },
  REPURCHASE: { color: 'blue', label: '🔁 复购' },
  TIP: { color: 'purple', label: '💝 打赏' },
};

interface Props {
  onBadgeClear: () => void;
}

const OrderPoolPage: React.FC<Props> = ({ onBadgeClear }) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [poolStatus, setPoolStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [grabResult, setGrabResult] = useState<any>(null);

  const fetchOrders = useCallback(async () => {
    try {
      const [poolRes, statusRes] = await Promise.all([
        window.electronAPI.apiRequest({ method: 'GET', url: '/orders/pool' }),
        window.electronAPI.apiRequest({ method: 'GET', url: '/orders/pool/status' }),
      ]);
      if (poolRes.code === 200) setOrders(poolRes.data || []);
      if (statusRes.code === 200) setPoolStatus(statusRes.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // Listen for WS events
  useEffect(() => {
    if (!window.electronAPI) return;
    const u1 = window.electronAPI.onWsEvent('ws:poolUpdated', () => fetchOrders());
    const u2 = window.electronAPI.onWsEvent('ws:orderNew', () => fetchOrders());
    return () => { u1(); u2(); };
  }, [fetchOrders]);

  const handleGrab = async (orderId: string) => {
    try {
      const res = await window.electronAPI.apiRequest({ method: 'POST', url: `/orders/${orderId}/grab` });
      if (res.code === 200) {
        message.success('抢单成功！');
        setGrabResult(res.data);
        fetchOrders();
      } else {
        message.error(res.message || '抢单失败');
      }
    } catch { message.error('网络错误'); }
  };

  const isUnlocked = poolStatus?.unlocked ?? true;
  const unlockPct = poolStatus ? Math.min(Math.round((poolStatus.todayRevenue / poolStatus.threshold) * 100), 100) : 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ color: '#E2E8F0', margin: 0 }}>📦 订单池</Title>
        <Button onClick={fetchOrders} loading={loading} size="small">刷新</Button>
      </div>

      {/* Pool status card */}
      {poolStatus && (
        <Card size="small" style={{
          marginBottom: 16, background: isUnlocked ? '#0A2E1F' : '#2E1F0A',
          border: `1px solid ${isUnlocked ? 'rgba(0,230,118,0.3)' : 'rgba(250,173,20,0.3)'}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Text style={{ color: isUnlocked ? '#00E676' : '#FAAD14', fontWeight: 600 }}>
                {isUnlocked ? '✅ 已解锁' : '🔒 未解锁'}
              </Text>
              <Text style={{ color: '#94A3B8', marginLeft: 8, fontSize: 12 }}>
                今日流水 ¥{poolStatus.todayRevenue} / ¥{poolStatus.threshold}
              </Text>
            </div>
            <Progress
              percent={unlockPct}
              status={isUnlocked ? 'success' : 'active'}
              style={{ width: 120, margin: 0 }}
              size="small"
              strokeColor={isUnlocked ? '#00E676' : '#FAAD14'}
            />
          </div>
        </Card>
      )}

      {/* Order cards */}
      <Row gutter={[12, 12]}>
        {orders.map((order) => {
          const typeCfg = orderTypeConfig[order.type] || { color: 'blue', label: order.type };
          const isDirect = order.companionId && !order.isPool;
          return (
            <Col span={12} key={order.id}>
              <Card
                size="small"
                style={{
                  background: '#1E293B',
                  borderLeft: `3px solid ${isDirect ? '#FF6B9D' : typeCfg.color}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Space>
                    <Tag color={typeCfg.color}>{typeCfg.label}</Tag>
                    {isDirect && (
                      <Tag color="pink">指定接单</Tag>
                    )}
                  </Space>
                  <Text strong style={{ color: '#FF6B9D', fontSize: 18 }}>¥{order.amount}</Text>
                </div>
                <div style={{ color: '#E2E8F0', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
                  {order.game || order.gameName || '-'}
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 8 }}>
                  {order.customFields?.deltaMode && <span>段位: {order.customFields.deltaMode} </span>}
                  {order.customFields?.customerSource && <span>来源: {order.customFields.customerSource}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    type="primary"
                    size="small"
                    icon={<ThunderboltOutlined />}
                    disabled={!isUnlocked && !isDirect}
                    onClick={() => handleGrab(order.id)}
                    style={{ flex: 1 }}
                  >
                    抢单
                  </Button>
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>
      {!loading && orders.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748B' }}>暂无可用订单</div>
      )}

      {/* Grab result modal */}
      <Modal
        title="✅ 抢单成功"
        open={!!grabResult}
        onCancel={() => setGrabResult(null)}
        footer={null}
      >
        {grabResult && (
          <div>
            <p style={{ color: '#E2E8F0' }}>
              游戏: <strong>{grabResult.game || grabResult.gameName}</strong>
            </p>
            <p style={{ color: '#E2E8F0' }}>
              金额: <strong style={{ color: '#FF6B9D' }}>¥{grabResult.amount}</strong>
            </p>
            {grabResult.customer && (
              <div style={{ background: '#0F172A', borderRadius: 8, padding: 12, marginTop: 12 }}>
                <Text style={{ color: '#94A3B8', fontSize: 12 }}>客户联系方式</Text>
                {grabResult.customer.wechat && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <Text style={{ color: '#E2E8F0' }}>微信: {grabResult.customer.wechat}</Text>
                    <Button size="small" icon={<CopyOutlined />} onClick={() => {
                      navigator.clipboard.writeText(grabResult.customer.wechat);
                      message.success('已复制');
                    }} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default OrderPoolPage;
