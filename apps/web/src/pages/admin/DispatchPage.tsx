import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Select,
  Row,
  Col,
  Card,
  Tag,
  Typography,
  Space,
  message,
  Statistic,
  Popconfirm,
} from 'antd';
import {
  ReloadOutlined,
  UserOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { OrderStatus, OrderType, DispatchType, CompanionStatus } from '@chunlv/shared';
import { ordersApi } from '../../api/orders';
import { companionsApi } from '../../api/companions';

const { Text } = Typography;
const { Option } = Select;

const statusConfig: Record<OrderStatus, { color: string; label: string }> = {
  [OrderStatus.PENDING]: { color: 'processing', label: '待派单' },
  [OrderStatus.GRABBED]: { color: 'cyan', label: '已接单' },
  [OrderStatus.CONFIRMED]: { color: 'blue', label: '已确认' },
  [OrderStatus.DONE]: { color: 'green', label: '已完成' },
  [OrderStatus.CANCELLED]: { color: 'default', label: '已取消' },
};

const orderTypeConfig: Record<OrderType, { color: string; label: string }> = {
  [OrderType.NEW]: { color: 'blue', label: '新单' },
  [OrderType.RENEW]: { color: 'cyan', label: '续费' },
  [OrderType.REPURCHASE]: { color: 'purple', label: '复购' },
  [OrderType.TIP]: { color: 'orange', label: '打赏' },
};

const dispatchTypeConfig: Record<DispatchType, { color: string; label: string }> = {
  [DispatchType.POOL]: { color: 'green', label: '入池抢单' },
  [DispatchType.DIRECT]: { color: 'blue', label: '指定派单' },
};

const companionStatusConfig: Record<CompanionStatus, { color: string; label: string }> = {
  [CompanionStatus.ONLINE]: { color: 'red', label: '在线' },
  [CompanionStatus.IDLE]: { color: 'green', label: '空闲' },
  [CompanionStatus.BUSY]: { color: 'gold', label: '忙碌' },
  [CompanionStatus.OFFLINE]: { color: 'default', label: '离线' },
};

interface Order {
  id: string;
  gameName: string;
  amount: number;
  orderType: OrderType;
  status: OrderStatus;
  dispatchType: DispatchType;
  createdAt: string;
  customer?: {
    wechatId: string;
  };
  companion?: {
    id: string;
    username: string;
  };
}

interface Companion {
  id: string;
  username: string;
  status: CompanionStatus;
}

const AdminDispatchPage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | undefined>();
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedCompanionId, setSelectedCompanionId] = useState<string>('');
  const [assigning, setAssigning] = useState(false);
  const [companions, setCompanions] = useState<Companion[]>([]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      const { data } = await ordersApi.list(params);
      setOrders(data.data?.items ?? data.data ?? []);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '加载订单失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchCompanions = useCallback(async () => {
    try {
      const { data } = await companionsApi.list();
      setCompanions(data.data ?? []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const openAssignModal = (orderId: string) => {
    setSelectedOrderId(orderId);
    setSelectedCompanionId('');
    fetchCompanions();
    setAssignModalOpen(true);
  };

  const handleAssign = async () => {
    if (!selectedOrderId || !selectedCompanionId) return;
    setAssigning(true);
    try {
      await ordersApi.assign(selectedOrderId, selectedCompanionId);
      message.success('派单成功');
      setAssignModalOpen(false);
      setSelectedOrderId(null);
      setSelectedCompanionId('');
      fetchOrders();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '派单失败';
      message.error(msg);
    } finally {
      setAssigning(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await ordersApi.cancel(id);
      message.success('订单已取消');
      fetchOrders();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '取消失败';
      message.error(msg);
    }
  };

  // Stats
  const pendingCount = orders.filter((o) => o.status === OrderStatus.PENDING).length;
  const activeCount = orders.filter(
    (o) => o.status === OrderStatus.GRABBED || o.status === OrderStatus.CONFIRMED
  ).length;
  const doneCount = orders.filter((o) => o.status === OrderStatus.DONE).length;
  const cancelledCount = orders.filter((o) => o.status === OrderStatus.CANCELLED).length;

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 160,
      ellipsis: true,
    },
    {
      title: '游戏',
      dataIndex: 'gameName',
      key: 'gameName',
      width: 120,
    },
    {
      title: '客户',
      key: 'customer',
      width: 140,
      render: (_: unknown, record: Order) => (
        <Text>{record.customer?.wechatId ?? '-'}</Text>
      ),
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 100,
      render: (val: number) => `¥${val.toFixed(2)}`,
    },
    {
      title: '类型',
      dataIndex: 'orderType',
      key: 'orderType',
      width: 80,
      render: (type: OrderType) => {
        const cfg = orderTypeConfig[type];
        return <Tag color={cfg?.color}>{cfg?.label ?? type}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: OrderStatus) => {
        const cfg = statusConfig[status];
        return <Tag color={cfg?.color}>{cfg?.label ?? status}</Tag>;
      },
    },
    {
      title: '派单方式',
      dataIndex: 'dispatchType',
      key: 'dispatchType',
      width: 110,
      render: (type: DispatchType) => {
        const cfg = dispatchTypeConfig[type];
        return <Tag color={cfg?.color}>{cfg?.label ?? type}</Tag>;
      },
    },
    {
      title: '陪玩',
      key: 'companion',
      width: 100,
      render: (_: unknown, record: Order) => (
        <Text>{record.companion?.username ?? <Text type="secondary">未分配</Text>}</Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_: unknown, record: Order) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            onClick={() => openAssignModal(record.id)}
          >
            指定陪玩
          </Button>
          {record.status !== OrderStatus.CANCELLED && (
            <Popconfirm
              title="确定取消该订单？"
              onConfirm={() => handleCancel(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="link" size="small" danger>
                取消
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* Stats Cards */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="待派"
              value={pendingCount}
              prefix={React.createElement(ClockCircleOutlined)}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="进行中"
              value={activeCount}
              prefix={React.createElement(UserOutlined)}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="已完成"
              value={doneCount}
              prefix={React.createElement(CheckCircleOutlined)}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="已取消"
              value={cancelledCount}
              prefix={React.createElement(CloseCircleOutlined)}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Text strong style={{ fontSize: 16 }}>
          派单管理
        </Text>
        <Space>
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 140 }}
            value={statusFilter}
            onChange={(val) => setStatusFilter(val)}
          >
            {Object.entries(statusConfig).map(([key, cfg]) => (
              <Option key={key} value={key}>
                {cfg.label}
              </Option>
            ))}
          </Select>
          <Button
            icon={React.createElement(ReloadOutlined)}
            onClick={fetchOrders}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>

      {/* Orders Table */}
      <Table
        columns={columns}
        dataSource={orders}
        rowKey="id"
        loading={loading}
        locale={{ emptyText: '暂无订单数据' }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条订单`,
        }}
      />

      {/* Assign Companion Modal */}
      <Modal
        title="指定陪玩"
        open={assignModalOpen}
        onOk={handleAssign}
        onCancel={() => {
          setAssignModalOpen(false);
          setSelectedOrderId(null);
          setSelectedCompanionId('');
        }}
        confirmLoading={assigning}
        okText="确认派单"
        cancelText="取消"
        okButtonProps={{ disabled: !selectedCompanionId }}
        destroyOnClose
      >
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="选择陪玩">
            <Select
              showSearch
              placeholder="请搜索陪玩"
              value={selectedCompanionId || undefined}
              onChange={(val) => setSelectedCompanionId(val)}
              style={{ width: '100%' }}
              filterOption={(input, option) => {
                const label = option?.label ?? option?.children;
                return String(label ?? '').toLowerCase().includes(input.toLowerCase());
              }}
            >
              {companions
                .filter(
                  (c) =>
                    c.status === CompanionStatus.IDLE ||
                    c.status === CompanionStatus.ONLINE
                )
                .map((c) => (
                  <Option key={c.id} value={c.id}>
                    {c.username} ({companionStatusConfig[c.status]?.label})
                  </Option>
                ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default AdminDispatchPage;
