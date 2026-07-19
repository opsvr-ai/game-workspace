// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { extractErrorMessage } from '../../utils/error-handler';
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
import { ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { TransactionStatus } from '@chunlv/shared';
import { billingApi } from '../../api/billing';

const { Text } = Typography;

const statusConfig: Record<TransactionStatus, { color: string; label: string }> = {
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

const TransactionList: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TransactionStatus>(TransactionStatus.PENDING);
  const [adminTransactions, setAdminTransactions] = useState<TransactionItem[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  const fetchAdminTransactions = useCallback(async () => {
    setAdminLoading(true);
    try {
      const { data } = await billingApi.list({ status: activeTab });
      setAdminTransactions(data.data ?? []);
    } catch (err: any) {
      message.error(extractErrorMessage(err, '加载报账列表失败'));
    } finally {
      setAdminLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchAdminTransactions();
  }, [fetchAdminTransactions]);

  const handleApprove = async (id: string) => {
    try {
      await billingApi.approve(id);
      message.success('审核通过');
      fetchAdminTransactions();
    } catch (err: any) {
      message.error(extractErrorMessage(err, '审核失败'));
    }
  };

  const handleReject = async (id: string) => {
    try {
      await billingApi.reject(id);
      message.success('已拒绝');
      fetchAdminTransactions();
    } catch (err: any) {
      message.error(extractErrorMessage(err, '操作失败'));
    }
  };

  const handleBatchApprove = async () => {
    const ids = selectedRowKeys as string[];
    try {
      const { data } = await billingApi.batchApprove(ids);
      const result = data.data;
      message.success(data.message || `批量通过：成功 ${result?.succeeded ?? ids.length} 条`);
      setSelectedRowKeys([]);
      fetchAdminTransactions();
    } catch (err: any) {
      message.error(extractErrorMessage(err, '批量操作失败'));
    }
  };

  const handleBatchReject = async () => {
    const ids = selectedRowKeys as string[];
    try {
      const { data } = await billingApi.batchReject(ids);
      const result = data.data;
      message.success(data.message || `批量拒绝：成功 ${result?.succeeded ?? ids.length} 条`);
      setSelectedRowKeys([]);
      fetchAdminTransactions();
    } catch (err: any) {
      message.error(extractErrorMessage(err, '批量操作失败'));
    }
  };

  const pendingCount = adminTransactions.filter((t) => t.status === TransactionStatus.PENDING).length;
  const approvedCount = adminTransactions.filter((t) => t.status === TransactionStatus.APPROVED).length;
  const rejectedCount = adminTransactions.filter((t) => t.status === TransactionStatus.REJECTED).length;

  const approvalColumns = [
    {
      title: '陪玩',
      key: 'companion',
      width: 100,
      render: (_: unknown, record: TransactionItem) => <Text>{record.companion?.user?.username ?? '-'}</Text>,
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
      render: (s: TransactionStatus) => {
        const cfg = statusConfig[s];
        return <Tag color={cfg?.color}>{cfg?.label ?? s}</Tag>;
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
          {pendingCount > 0 && <span style={{ marginLeft: 6, color: '#1677ff' }}>({pendingCount})</span>}
        </span>
      ),
    },
    {
      key: TransactionStatus.APPROVED,
      label: (
        <span>
          已通过
          {approvedCount > 0 && <span style={{ marginLeft: 6, color: '#52c41a' }}>({approvedCount})</span>}
        </span>
      ),
    },
    {
      key: TransactionStatus.REJECTED,
      label: (
        <span>
          已拒绝
          {rejectedCount > 0 && <span style={{ marginLeft: 6, color: '#ff4d4f' }}>({rejectedCount})</span>}
        </span>
      ),
    },
  ];

  return (
    <div style={{ marginBottom: 12 }}>
      {/* Stats row */}
      <Row gutter={16} style={{ marginBottom: 12 }}>
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
          marginBottom: 12,
        }}
      >
        <Text strong style={{ fontSize: 16 }}>
          报账审核
        </Text>
        <Button
          icon={React.createElement(ReloadOutlined)}
          onClick={fetchAdminTransactions}
          loading={adminLoading}
        >
          刷新
        </Button>
      </div>

      {/* Tabs */}
      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setSelectedRowKeys([]);
          setActiveTab(key as TransactionStatus);
        }}
        items={tabItems}
      />

      {/* Batch action bar */}
      {selectedRowKeys.length > 0 && activeTab === TransactionStatus.PENDING && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 12px',
            background: '#e6f4ff',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Text>
            已选择 <strong>{selectedRowKeys.length}</strong> 条记录
          </Text>
          <Popconfirm
            title={`确认批量通过 ${selectedRowKeys.length} 条报账？`}
            onConfirm={handleBatchApprove}
            okText="确定"
            cancelText="取消"
          >
            <Button type="primary" size="small">
              批量通过
            </Button>
          </Popconfirm>
          <Popconfirm
            title={`确认批量拒绝 ${selectedRowKeys.length} 条报账？`}
            onConfirm={handleBatchReject}
            okText="确定"
            cancelText="取消"
          >
            <Button danger size="small">
              批量拒绝
            </Button>
          </Popconfirm>
          <Button size="small" onClick={() => setSelectedRowKeys([])}>
            取消选择
          </Button>
        </div>
      )}

      {/* Approval table */}
      <Table
        columns={approvalColumns}
        dataSource={adminTransactions}
        rowKey="id"
        loading={adminLoading}
        locale={{ emptyText: '暂无报账记录' }}
        rowSelection={
          activeTab === TransactionStatus.PENDING
            ? {
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys),
              }
            : undefined
        }
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条报账`,
        }}
      />
    </div>
  );
};

export default TransactionList;
