import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Tabs,
  Tag,
  Typography,
  Space,
  message,
  Image,
  Popconfirm,
  Row,
  Col,
  Statistic,
  Card,
} from 'antd';
import {
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { TransactionStatus } from '@chunlv/shared';
import { billingApi } from '../../api/billing';

const { Text } = Typography;

const statusConfig: Record<
  TransactionStatus,
  { color: string; label: string }
> = {
  [TransactionStatus.PENDING]: { color: 'processing', label: '待审核' },
  [TransactionStatus.APPROVED]: { color: 'green', label: '已通过' },
  [TransactionStatus.REJECTED]: { color: 'error', label: '已拒绝' },
};

interface TransactionItem {
  id: string;
  orderId: string;
  companionId: string;
  amount: number;
  paymentMethod: string;
  screenshotUrl: string;
  status: TransactionStatus;
  createdAt: string;
  paidAt: string;
  order?: {
    id: string;
    type: string;
    amount: number;
    customerId: string;
  };
  companion?: {
    id: string;
    user?: {
      username: string;
    };
  };
}

const formatDate = (iso: string): string => {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const BillingPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TransactionStatus>(
    TransactionStatus.PENDING,
  );
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await billingApi.list({ status: activeTab });
      setTransactions(data.data ?? []);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || '加载报账列表失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handleApprove = async (id: string) => {
    try {
      await billingApi.approve(id);
      message.success('审核通过');
      fetchTransactions();
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || '审核失败';
      message.error(msg);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await billingApi.reject(id);
      message.success('已拒绝');
      fetchTransactions();
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || '操作失败';
      message.error(msg);
    }
  };

  const pendingCount = transactions.filter(
    (t) => t.status === TransactionStatus.PENDING,
  ).length;
  const approvedCount = transactions.filter(
    (t) => t.status === TransactionStatus.APPROVED,
  ).length;
  const rejectedCount = transactions.filter(
    (t) => t.status === TransactionStatus.REJECTED,
  ).length;

  const columns = [
    {
      title: '陪玩',
      key: 'companion',
      width: 100,
      render: (_: unknown, record: TransactionItem) => (
        <Text>{record.companion?.user?.username ?? '-'}</Text>
      ),
    },
    {
      title: '订单号',
      dataIndex: 'orderId',
      key: 'orderId',
      width: 160,
      ellipsis: true,
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 100,
      render: (val: number) => (
        <Text strong style={{ color: '#cf1322' }}>
          ¥{val.toFixed(2)}
        </Text>
      ),
    },
    {
      title: '支付方式',
      dataIndex: 'paymentMethod',
      key: 'paymentMethod',
      width: 110,
      render: (val: string) => val || '-',
    },
    {
      title: '截图',
      dataIndex: 'screenshotUrl',
      key: 'screenshotUrl',
      width: 100,
      render: (url: string) =>
        url ? (
          <Image src={url} width={60} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} />
        ) : (
          <Text type="secondary">无</Text>
        ),
    },
    {
      title: '支付时间',
      dataIndex: 'paidAt',
      key: 'paidAt',
      width: 160,
      render: (val: string) => formatDate(val),
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (val: string) => formatDate(val),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: TransactionStatus) => {
        const cfg = statusConfig[status];
        return <Tag color={cfg?.color}>{cfg?.label ?? status}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_: unknown, record: TransactionItem) => {
        if (record.status !== TransactionStatus.PENDING) {
          return <Text type="secondary">-</Text>;
        }
        return (
          <Space size="small">
            <Popconfirm
              title="确认通过该报账？"
              onConfirm={() => handleApprove(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="link" size="small">
                通过
              </Button>
            </Popconfirm>
            <Popconfirm
              title="确认拒绝该报账？"
              onConfirm={() => handleReject(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="link" size="small" danger>
                拒绝
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const tabItems = [
    {
      key: TransactionStatus.PENDING,
      label: (
        <span>
          待审核
          {pendingCount > 0 && (
            <span style={{ marginLeft: 6, color: '#1677ff' }}>
              ({pendingCount})
            </span>
          )}
        </span>
      ),
    },
    {
      key: TransactionStatus.APPROVED,
      label: (
        <span>
          已通过
          {approvedCount > 0 && (
            <span style={{ marginLeft: 6, color: '#52c41a' }}>
              ({approvedCount})
            </span>
          )}
        </span>
      ),
    },
    {
      key: TransactionStatus.REJECTED,
      label: (
        <span>
          已拒绝
          {rejectedCount > 0 && (
            <span style={{ marginLeft: 6, color: '#ff4d4f' }}>
              ({rejectedCount})
            </span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div>
      {/* Stats row */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="待审核"
              value={pendingCount}
              prefix={React.createElement(ClockCircleOutlined)}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="已通过"
              value={approvedCount}
              prefix={React.createElement(CheckCircleOutlined)}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="已拒绝"
              value={rejectedCount}
              prefix={React.createElement(CloseCircleOutlined)}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Text strong style={{ fontSize: 16 }}>
          报账审核
        </Text>
        <Button
          icon={React.createElement(ReloadOutlined)}
          onClick={fetchTransactions}
          loading={loading}
        >
          刷新
        </Button>
      </div>

      {/* Tabs + Table */}
      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as TransactionStatus)}
        items={tabItems}
      />

      <Table
        columns={columns}
        dataSource={transactions}
        rowKey="id"
        loading={loading}
        locale={{ emptyText: '暂无报账记录' }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条报账`,
        }}
      />
    </div>
  );
};

export default BillingPage;
