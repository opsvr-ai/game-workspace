import React, { useEffect, useState, useCallback } from 'react';
import { Card, Tag, Typography, Space, Button, Spin, Empty, Row, Col, DatePicker, Input } from 'antd';
import { ReloadOutlined, ClockCircleOutlined, SearchOutlined } from '@ant-design/icons';
import { ordersApi } from '../../api/orders';
import dayjs from 'dayjs';

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;

const statusConfig: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'processing', label: '待派单' },
  GRABBED: { color: 'cyan', label: '已接单' },
  CONFIRMED: { color: 'blue', label: '进行中' },
  DONE: { color: 'green', label: '已完成' },
  CANCELLED: { color: 'error', label: '已取消' },
};

const orderTypeConfig: Record<string, { label: string; color: string }> = {
  NEW: { label: '首单', color: 'green' },
  RENEW: { label: '续单', color: 'orange' },
  REPURCHASE: { label: '复购', color: 'blue' },
  TIP: { label: '打赏', color: 'purple' },
};

const STATUS_TABS = [
  { key: '', label: '全部' },
  { key: 'PENDING', label: '待派单' },
  { key: 'GRABBED', label: '已接单' },
  { key: 'CONFIRMED', label: '进行中' },
  { key: 'DONE', label: '已完成' },
  { key: 'CANCELLED', label: '已取消' },
];

const OrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { all: true };
      if (statusFilter) params.status = statusFilter;
      const { data } = await ordersApi.list(params);
      let list = data.data?.items ?? data.data ?? [];
      // Client-side search filtering
      if (searchText) {
        const q = searchText.toLowerCase();
        list = list.filter((o: any) =>
          o.id?.toLowerCase().includes(q) ||
          o.customer?.customerCode?.toLowerCase().includes(q) ||
          o.customer?.wechatId?.toLowerCase().includes(q) ||
          o.companion?.user?.username?.toLowerCase().includes(q) ||
          o.gameName?.toLowerCase().includes(q)
        );
      }
      // Client-side date filtering
      if (dateRange && dateRange[0] && dateRange[1]) {
        const start = dateRange[0].startOf('day').valueOf();
        const end = dateRange[1].endOf('day').valueOf();
        list = list.filter((o: any) => {
          const t = new Date(o.createdAt).getTime();
          return t >= start && t <= end;
        });
      }
      setOrders(list);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchText, dateRange]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>📋 订单管理</Title>
        <Button icon={React.createElement(ReloadOutlined)} onClick={fetchOrders} loading={loading}>刷新</Button>
      </div>

      {/* Filters */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Row gutter={12} align="middle">
          <Col>
            <Input
              prefix={React.createElement(SearchOutlined)}
              placeholder="搜索订单号/客户/陪玩/游戏"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ width: 260 }}
              allowClear
            />
          </Col>
          <Col>
            <RangePicker
              value={dateRange as any}
              onChange={(v) => setDateRange(v as any)}
              placeholder={['开始日期', '结束日期']}
              size="middle"
            />
          </Col>
          <Col flex="auto" />
          <Col>
            <Text type="secondary">共 {orders.length} 条</Text>
          </Col>
        </Row>
        <Space size="small" style={{ marginTop: 10 }}>
          {STATUS_TABS.map(tab => (
            <Tag.CheckableTag
              key={tab.key}
              checked={statusFilter === tab.key}
              onChange={() => setStatusFilter(tab.key)}
              style={{ padding: '4px 14px', fontSize: 13 }}
            >
              {tab.label}
            </Tag.CheckableTag>
          ))}
        </Space>
      </Card>

      {/* Order List */}
      {loading ? (
        <Spin size="large" style={{ display: 'block', margin: '40px auto' }} />
      ) : orders.length === 0 ? (
        <Empty description="暂无订单" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {orders.map((order: any, idx: number) => (
            <Card key={order.id} size="small"
              style={{ borderLeft: `3px solid ${statusConfig[order.status]?.color || '#ccc'}` }}>
              <Row align="middle" gutter={8} wrap={false}>
                <Col><Tag style={{ background: '#f0f0f0', color: '#666', fontWeight: 700, minWidth: 28, textAlign: 'center', margin: 0 }}>{idx + 1}</Tag></Col>
                <Col>
                  <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                    {order.id?.slice(-6)}
                  </Text>
                </Col>
                <Col><Tag color={orderTypeConfig[order.type]?.color || 'blue'} style={{ margin: 0 }}>{orderTypeConfig[order.type]?.label || order.type}</Tag></Col>
                <Col><Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>{order.gameName}</Text></Col>
                <Col><Text style={{ fontSize: 14, fontWeight: 700, color: '#1677ff', whiteSpace: 'nowrap' }}>¥{Number(order.amount).toFixed(0)}</Text></Col>
                {order.customFields?.deltaMode && <Col><Tag color="cyan" style={{ margin: 0 }}>{order.customFields.deltaMode}</Tag></Col>}
                {order.customFields?.deltaCount && <Col><Tag style={{ margin: 0 }}>{order.customFields.deltaCount}</Tag></Col>}
                {order.customFields?.customerSource && <Col><Tag color="orange" style={{ margin: 0 }}>📡{order.customFields.customerSource}</Tag></Col>}
                {order.customer?.customerCode && <Col><Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>👤{order.customer.customerCode}</Text></Col>}
                {order.companion?.user?.username && <Col><Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>🎮{order.companion.user.username}</Text></Col>}
                {order.customFields?.deltaNote && <Col><Text type="warning" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>📝{order.customFields.deltaNote}</Text></Col>}
                <Col flex="auto" />
                <Col>
                  <Space size={6}>
                    <Tag color={statusConfig[order.status]?.color}>{statusConfig[order.status]?.label || order.status}</Tag>
                    <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                      {React.createElement(ClockCircleOutlined)} {new Date(order.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </Space>
                </Col>
              </Row>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default OrdersPage;
