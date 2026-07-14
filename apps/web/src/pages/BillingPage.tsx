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
  DatePicker,
  Alert,
  Descriptions,
  Modal,
  InputNumber,
  Input,
} from 'antd';
import {
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { TransactionStatus, UserRole } from '@chunlv/shared';
import { billingApi } from '../api/billing';
import { expenseReportsApi } from '../api/expenses';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';
import dayjs, { Dayjs } from 'dayjs';

const { Text } = Typography;

const statusConfig: Record<
  TransactionStatus,
  { color: string; label: string }
> = {
  [TransactionStatus.PENDING]: { color: 'processing', label: '待审核' },
  [TransactionStatus.APPROVED]: { color: 'green', label: '已通过' },
  [TransactionStatus.REJECTED]: { color: 'error', label: '已拒绝' },
};

const reviewStatusConfig: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'orange', label: '待审核' },
  APPROVED: { color: 'green', label: '已通过' },
  REJECTED: { color: 'red', label: '已驳回' },
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

const formatDateShort = (iso: string): string => {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('zh-CN');
};

const BillingPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN;

  // ═══════════════════════════════════════════════
  // Companion state — 我的报账
  // ═══════════════════════════════════════════════
  const [compTransactions, setCompTransactions] = useState<any[]>([]);
  const [compLoading, setCompLoading] = useState(false);
  const [compTotal, setCompTotal] = useState(0);

  // ═══════════════════════════════════════════════
  // Companion state — 报账/支取申请
  // ═══════════════════════════════════════════════
  const [reportModal, setReportModal] = useState(false);
  const [reportType, setReportType] = useState<'EXPENSE' | 'WITHDRAW'>('EXPENSE');
  const [reportAmount, setReportAmount] = useState<number>(0);
  const [reportDesc, setReportDesc] = useState('');
  const [compExpenseReports, setCompExpenseReports] = useState<any[]>([]);
  const [compReportsLoading, setCompReportsLoading] = useState(false);

  // ═══════════════════════════════════════════════
  // Admin state — 报账审核 (transaction approval)
  // ═══════════════════════════════════════════════
  const [activeTab, setActiveTab] = useState<TransactionStatus>(
    TransactionStatus.PENDING,
  );
  const [adminTransactions, setAdminTransactions] = useState<TransactionItem[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // ═══════════════════════════════════════════════
  // Admin state — expense report review
  // ═══════════════════════════════════════════════
  const [reports, setReports] = useState<any[]>([]);
  const [reportFilter, setReportFilter] = useState<string>('');
  const [summary, setSummary] = useState<any>(null);
  const [reportsLoading, setReportsLoading] = useState(false);

  // ═══════════════════════════════════════════════
  // Admin state — wallet transaction review
  // ═══════════════════════════════════════════════
  const [walletTxns, setWalletTxns] = useState<any[]>([]);
  const [walletTxnsLoading, setWalletTxnsLoading] = useState(false);
  const [walletTxnsFilter, setWalletTxnsFilter] = useState<string>('');

  // ═══════════════════════════════════════════════
  // Admin state — monthly settlement
  // ═══════════════════════════════════════════════
  const [settlementMonth, setSettlementMonth] = useState<Dayjs>(dayjs());
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [settlementResult, setSettlementResult] = useState<any>(null);
  const [pastSettlements, setPastSettlements] = useState<any[]>([]);
  const [pastSettlementsLoading, setPastSettlementsLoading] = useState(false);

  // ═══════════════════════════════════════════════
  // Companion: fetch personal transactions
  // ═══════════════════════════════════════════════
  const fetchCompTransactions = useCallback(async () => {
    if (!user?.companionId) return;
    setCompLoading(true);
    try {
      const { data } = await http.get(`/companions/${user.companionId}/revenue`);
      setCompTransactions(data.data?.transactions ?? []);
      setCompTotal(data.data?.total ?? 0);
    } catch {
      message.error('加载失败');
    } finally {
      setCompLoading(false);
    }
  }, [user?.companionId]);

  useEffect(() => {
    fetchCompTransactions();
  }, [fetchCompTransactions]);

  // ═══════════════════════════════════════════════
  // Companion: fetch expense reports
  // ═══════════════════════════════════════════════
  const fetchCompExpenseReports = useCallback(async () => {
    setCompReportsLoading(true);
    try {
      const { data } = await expenseReportsApi.list();
      setCompExpenseReports(data.data ?? []);
    } catch {
      /* ignore */
    } finally {
      setCompReportsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompExpenseReports();
  }, [fetchCompExpenseReports]);

  // ═══════════════════════════════════════════════
  // Companion: submit expense report
  // ═══════════════════════════════════════════════
  const submitReport = async () => {
    if (reportAmount <= 0) {
      message.warning('请输入金额');
      return;
    }
    try {
      await expenseReportsApi.create({
        type: reportType,
        amount: reportAmount,
        description: reportDesc,
      });
      message.success('提交成功');
      setReportModal(false);
      setReportAmount(0);
      setReportDesc('');
      fetchCompExpenseReports();
    } catch (e: any) {
      message.error(e?.response?.data?.message ?? '提交失败');
    }
  };

  // ═══════════════════════════════════════════════
  // Admin: fetch transactions (approval table)
  // ═══════════════════════════════════════════════
  const fetchAdminTransactions = useCallback(async () => {
    setAdminLoading(true);
    try {
      const { data } = await billingApi.list({ status: activeTab });
      setAdminTransactions(data.data ?? []);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || '加载报账列表失败';
      message.error(msg);
    } finally {
      setAdminLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (isAdmin) {
      fetchAdminTransactions();
    }
  }, [fetchAdminTransactions, isAdmin]);

  // ═══════════════════════════════════════════════
  // Admin: approve single transaction
  // ═══════════════════════════════════════════════
  const handleApprove = async (id: string) => {
    try {
      await billingApi.approve(id);
      message.success('审核通过');
      fetchAdminTransactions();
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || '审核失败';
      message.error(msg);
    }
  };

  // ═══════════════════════════════════════════════
  // Admin: reject single transaction
  // ═══════════════════════════════════════════════
  const handleReject = async (id: string) => {
    try {
      await billingApi.reject(id);
      message.success('已拒绝');
      fetchAdminTransactions();
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || '操作失败';
      message.error(msg);
    }
  };

  // ═══════════════════════════════════════════════
  // Admin: batch approve
  // ═══════════════════════════════════════════════
  const handleBatchApprove = async () => {
    const ids = selectedRowKeys as string[];
    try {
      const { data } = await billingApi.batchApprove(ids);
      const result = data.data;
      message.success(
        data.message || `批量通过：成功 ${result?.succeeded ?? ids.length} 条`,
      );
      setSelectedRowKeys([]);
      fetchAdminTransactions();
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || '批量操作失败';
      message.error(msg);
    }
  };

  // ═══════════════════════════════════════════════
  // Admin: batch reject
  // ═══════════════════════════════════════════════
  const handleBatchReject = async () => {
    const ids = selectedRowKeys as string[];
    try {
      const { data } = await billingApi.batchReject(ids);
      const result = data.data;
      message.success(
        data.message || `批量拒绝：成功 ${result?.succeeded ?? ids.length} 条`,
      );
      setSelectedRowKeys([]);
      fetchAdminTransactions();
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || '批量操作失败';
      message.error(msg);
    }
  };

  // ═══════════════════════════════════════════════
  // Admin: fetch expense reports for review
  // ═══════════════════════════════════════════════
  const fetchReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const { data } = await expenseReportsApi.list({
        status: reportFilter || undefined,
      });
      setReports(data.data ?? []);
    } catch {
      message.error('加载报账记录失败');
    } finally {
      setReportsLoading(false);
    }
  }, [reportFilter]);

  useEffect(() => {
    if (isAdmin) {
      fetchReports();
    }
  }, [fetchReports, isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      expenseReportsApi
        .monthlySummary()
        .then(({ data }) => setSummary(data.data))
        .catch(() => {});
    }
  }, [isAdmin]);

  // ═══════════════════════════════════════════════
  // Admin: review expense report
  // ═══════════════════════════════════════════════
  const handleReview = async (id: string, status: string) => {
    try {
      await expenseReportsApi.review(id, status);
      message.success(status === 'APPROVED' ? '已通过' : '已驳回');
      fetchReports();
    } catch {
      message.error('操作失败');
    }
  };

  // ═══════════════════════════════════════════════
  // Admin: fetch wallet transactions
  // ═══════════════════════════════════════════════
  const fetchWalletTxns = useCallback(async () => {
    setWalletTxnsLoading(true);
    try {
      const { data } = await billingApi.walletTransactions({
        status: walletTxnsFilter || undefined,
      });
      setWalletTxns(data.data ?? []);
    } catch {
      message.error('加载钱包交易失败');
    } finally {
      setWalletTxnsLoading(false);
    }
  }, [walletTxnsFilter]);

  useEffect(() => {
    if (isAdmin) {
      fetchWalletTxns();
    }
  }, [fetchWalletTxns, isAdmin]);

  // ═══════════════════════════════════════════════
  // Admin: review wallet transaction
  // ═══════════════════════════════════════════════
  const handleWalletReview = async (id: string, status: string) => {
    try {
      await billingApi.reviewWalletTransaction(id, status);
      message.success(status === 'APPROVED' ? '已通过' : '已驳回');
      fetchWalletTxns();
    } catch {
      message.error('操作失败');
    }
  };

  // ═══════════════════════════════════════════════
  // Admin: run monthly settlement
  // ═══════════════════════════════════════════════
  const handleRunSettlement = async () => {
    const monthStr = settlementMonth.format('YYYY-MM');
    setSettlementLoading(true);
    try {
      const { data } = await billingApi.runSettlement(monthStr);
      setSettlementResult(data.data);
      message.success(data.message || '月底结算完成');
      fetchPastSettlements();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '结算失败';
      message.error(msg);
    } finally {
      setSettlementLoading(false);
    }
  };

  // ═══════════════════════════════════════════════
  // Admin: fetch past settlements
  // ═══════════════════════════════════════════════
  const fetchPastSettlements = useCallback(async () => {
    const monthStr = settlementMonth.format('YYYY-MM');
    setPastSettlementsLoading(true);
    try {
      const { data } = await billingApi.getSettlement(monthStr);
      setPastSettlements(data.data ?? []);
    } catch {
      // silently fail
    } finally {
      setPastSettlementsLoading(false);
    }
  }, [settlementMonth]);

  useEffect(() => {
    if (isAdmin) {
      fetchPastSettlements();
    }
  }, [fetchPastSettlements, isAdmin]);

  // ═══════════════════════════════════════════════
  // Computed values
  // ═══════════════════════════════════════════════
  const pendingCount = adminTransactions.filter(
    (t) => t.status === TransactionStatus.PENDING,
  ).length;
  const approvedCount = adminTransactions.filter(
    (t) => t.status === TransactionStatus.APPROVED,
  ).length;
  const rejectedCount = adminTransactions.filter(
    (t) => t.status === TransactionStatus.REJECTED,
  ).length;

  // ═══════════════════════════════════════════════
  // Admin: transaction approval columns
  // ═══════════════════════════════════════════════
  const approvalColumns = [
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
          <Image
            src={url}
            width={60}
            height={60}
            style={{ objectFit: 'cover', borderRadius: 4 }}
          />
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

  // ═══════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════
  return (
    <div>
      {/* ═══════════════════════════════════════════
          Companion: 我的报账
          ═══════════════════════════════════════════ */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <div>
            <Text strong style={{ fontSize: 16 }}>
              报账系统
            </Text>
            <br />
            <Text type="secondary">查看已提交的报账记录和审核状态</Text>
          </div>
          <Button
            icon={React.createElement(ReloadOutlined)}
            onClick={fetchCompTransactions}
            loading={compLoading}
          >
            刷新
          </Button>
        </div>

        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}>
            <Card size="small">
              <Statistic
                title="报账总数"
                value={compTransactions.length}
                valueStyle={{ color: '#007AFF' }}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic
                title="已通过"
                value={
                  compTransactions.filter(
                    (t: any) => t.status === 'APPROVED',
                  ).length
                }
                valueStyle={{ color: '#34C759' }}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic
                title="总收入"
                value={`¥${compTotal.toFixed(2)}`}
                valueStyle={{ color: '#FF4757' }}
              />
            </Card>
          </Col>
        </Row>

        <Table
          size="small"
          dataSource={compTransactions}
          rowKey="id"
          loading={compLoading}
          locale={{ emptyText: '暂无报账记录' }}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
        >
          <Table.Column
            title="订单号"
            dataIndex={['order', 'id']}
            width={100}
            render={(v: string) => v?.slice(0, 8) ?? '-'}
          />
          <Table.Column
            title="金额"
            dataIndex="amount"
            width={100}
            render={(v: number) => (
              <Text strong style={{ color: '#cf1322' }}>
                ¥{v?.toFixed(2)}
              </Text>
            )}
          />
          <Table.Column
            title="支付方式"
            dataIndex="paymentMethod"
            width={100}
            render={(v: string) => v || '-'}
          />
          <Table.Column
            title="状态"
            dataIndex="status"
            width={100}
            render={(s: string) => {
              const cfg = statusConfig[s as TransactionStatus] || reviewStatusConfig[s];
              return <Tag color={cfg?.color}>{cfg?.label ?? s}</Tag>;
            }}
          />
          <Table.Column
            title="提交时间"
            dataIndex="createdAt"
            render={(v: string) =>
              v ? new Date(v).toLocaleString('zh-CN') : '-'
            }
          />
        </Table>
      </div>

      {/* ═══════════════════════════════════════════
          Companion: 报账/支取申请
          ═══════════════════════════════════════════ */}
      <div style={{ marginBottom: 32 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <div>
            <Text strong style={{ fontSize: 16 }}>
              报账/支取申请
            </Text>
            <br />
            <Text type="secondary">提交消费报账或支取申请，由管理员审核</Text>
          </div>
        </div>

        <Space style={{ marginBottom: 12 }}>
          <Button
            type="primary"
            onClick={() => {
              setReportType('EXPENSE');
              setReportModal(true);
            }}
          >
            报账
          </Button>
          <Button
            onClick={() => {
              setReportType('WITHDRAW');
              setReportModal(true);
            }}
          >
            申请支取
          </Button>
        </Space>

        <Table
          size="small"
          dataSource={compExpenseReports}
          rowKey="id"
          loading={compReportsLoading}
          locale={{ emptyText: '暂无申请记录' }}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
          }}
        >
          <Table.Column
            title="类型"
            dataIndex="type"
            width={80}
            render={(t: string) => (t === 'EXPENSE' ? '报账' : '支取')}
          />
          <Table.Column
            title="金额"
            dataIndex="amount"
            width={100}
            render={(v: number) => (
              <Text strong style={{ color: '#cf1322' }}>
                ¥{v?.toFixed(2)}
              </Text>
            )}
          />
          <Table.Column
            title="备注"
            dataIndex="description"
            ellipsis
            render={(v: string) => v || '-'}
          />
          <Table.Column
            title="状态"
            dataIndex="status"
            width={100}
            render={(s: string) => {
              const cfg = reviewStatusConfig[s];
              return <Tag color={cfg?.color}>{cfg?.label ?? s}</Tag>;
            }}
          />
          <Table.Column
            title="审核备注"
            dataIndex="reviewNote"
            ellipsis
            render={(v: string) => v || '-'}
          />
          <Table.Column
            title="提交时间"
            dataIndex="createdAt"
            width={160}
            render={(v: string) =>
              v ? new Date(v).toLocaleString('zh-CN') : '-'
            }
          />
        </Table>

        <Modal
          title={reportType === 'EXPENSE' ? '报账' : '申请支取'}
          open={reportModal}
          onOk={submitReport}
          onCancel={() => setReportModal(false)}
          okText="提交"
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            <div>
              <Text>金额（元）</Text>
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                value={reportAmount}
                onChange={(v) => setReportAmount(v ?? 0)}
              />
            </div>
            <div>
              <Text>备注</Text>
              <Input.TextArea
                value={reportDesc}
                onChange={(e) => setReportDesc(e.target.value)}
                placeholder="可选：填写备注信息"
                rows={3}
              />
            </div>
          </Space>
        </Modal>
      </div>

      {/* ═══════════════════════════════════════════
          Admin-only sections
          ═══════════════════════════════════════════ */}
      {isAdmin && (
        <>
          {/* ── Transaction Approval ── */}
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
            {selectedRowKeys.length > 0 &&
              activeTab === TransactionStatus.PENDING && (
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

          {/* ── Expense Report Review ── */}
          <Card title="报账与财务" style={{ marginTop: 16 }}>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={6}>
                <Statistic
                  title="本月报账"
                  value={`¥${(summary?.totalExpense ?? 0).toFixed(2)}`}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="已通过"
                  value={`¥${(
                    (summary?.totalExpense ?? 0) +
                    (summary?.totalWithdraw ?? 0)
                  ).toFixed(2)}`}
                  valueStyle={{ color: '#3f8600' }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="待审核"
                  value={`${summary?.pendingCount ?? 0}笔`}
                  valueStyle={{ color: '#faad14' }}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="已驳回"
                  value={`${summary?.rejectedCount ?? 0}笔`}
                  valueStyle={{ color: '#cf1322' }}
                />
              </Col>
            </Row>

            <Tabs
              activeKey={reportFilter}
              onChange={setReportFilter}
              items={[
                { key: '', label: '全部' },
                { key: 'PENDING', label: '待审核' },
                { key: 'APPROVED', label: '已通过' },
                { key: 'REJECTED', label: '已驳回' },
              ]}
            />
            <Table
              dataSource={reports}
              rowKey="id"
              size="small"
              loading={reportsLoading}
              locale={{ emptyText: '暂无报账申请' }}
              pagination={{
                pageSize: 10,
                showTotal: (total) => `共 ${total} 条`,
              }}
            >
              <Table.Column
                title="报账人"
                dataIndex={['companion', 'user', 'username']}
              />
              <Table.Column
                title="类型"
                dataIndex="type"
                render={(t: string) => (t === 'EXPENSE' ? '报账' : '支取')}
              />
              <Table.Column
                title="金额"
                dataIndex="amount"
                render={(v: number) => `¥${v.toFixed(2)}`}
              />
              <Table.Column
                title="备注"
                dataIndex="description"
                ellipsis
                render={(v: string) => v || '-'}
              />
              <Table.Column
                title="状态"
                dataIndex="status"
                render={(s: string) => {
                  const cfg = reviewStatusConfig[s];
                  return <Tag color={cfg?.color}>{cfg?.label ?? s}</Tag>;
                }}
              />
              <Table.Column
                title="日期"
                dataIndex="createdAt"
                render={(d: string) => formatDateShort(d)}
              />
              <Table.Column
                title="操作"
                render={(_: any, r: any) =>
                  r.status === 'PENDING' ? (
                    <Space>
                      <Button
                        size="small"
                        type="primary"
                        onClick={() => handleReview(r.id, 'APPROVED')}
                      >
                        通过
                      </Button>
                      <Button
                        size="small"
                        danger
                        onClick={() => handleReview(r.id, 'REJECTED')}
                      >
                        驳回
                      </Button>
                    </Space>
                  ) : (
                    <Text type="secondary">-</Text>
                  )
                }
              />
            </Table>
          </Card>

          {/* ── Monthly Settlement ── */}
          <Card title="月底结算" style={{ marginTop: 16 }}>
            <Alert
              message="结算后陪玩当月业绩将清零并计入可支取余额，请确认当月订单已全部审核完毕。"
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
            />

            <Row gutter={16} align="middle" style={{ marginBottom: 12 }}>
              <Col>
                <DatePicker
                  picker="month"
                  value={settlementMonth}
                  onChange={(d) => {
                    if (d) {
                      setSettlementMonth(d);
                      setSettlementResult(null);
                    }
                  }}
                  style={{ width: 160 }}
                  allowClear={false}
                />
              </Col>
              <Col>
                <Button
                  type="primary"
                  onClick={handleRunSettlement}
                  loading={settlementLoading}
                  danger
                >
                  执行结算
                </Button>
              </Col>
            </Row>

            {/* Settlement result summary */}
            {settlementResult && (
              <Card
                size="small"
                style={{
                  marginBottom: 12,
                  background: '#f6ffed',
                  border: '1px solid #b7eb8f',
                }}
              >
                <Descriptions column={3} size="small">
                  <Descriptions.Item label="结算月份">
                    {settlementResult.month}
                  </Descriptions.Item>
                  <Descriptions.Item label="结算人数">
                    {settlementResult.results?.length ?? 0} 人
                  </Descriptions.Item>
                  <Descriptions.Item label="总计分配">
                    <Text strong style={{ color: '#cf1322' }}>
                      ¥{(settlementResult.totalDistributed ?? 0).toFixed(2)}
                    </Text>
                  </Descriptions.Item>
                </Descriptions>

                <Table
                  dataSource={settlementResult.results ?? []}
                  rowKey="companionId"
                  size="small"
                  pagination={false}
                  style={{ marginTop: 8 }}
                  locale={{ emptyText: '暂无结算结果' }}
                >
                  <Table.Column
                    title="陪玩"
                    dataIndex="companionName"
                    width={100}
                  />
                  <Table.Column
                    title="当月业绩"
                    dataIndex="monthlyRevenue"
                    width={110}
                    render={(v: number) => (
                      <Text strong>¥{v.toFixed(2)}</Text>
                    )}
                  />
                  <Table.Column
                    title="分成比例"
                    dataIndex="tierCompanionPct"
                    width={90}
                    render={(v: number) => `${v}%`}
                  />
                  <Table.Column
                    title="陪玩分成"
                    dataIndex="companionShare"
                    width={110}
                    render={(v: number) => (
                      <Text style={{ color: '#3f8600' }}>
                        ¥{v.toFixed(2)}
                      </Text>
                    )}
                  />
                  <Table.Column
                    title="工作室分成"
                    dataIndex="studioShare"
                    width={110}
                    render={(v: number) => (
                      <Text style={{ color: '#1677ff' }}>
                        ¥{v.toFixed(2)}
                      </Text>
                    )}
                  />
                </Table>
              </Card>
            )}

            {/* Past settlements for selected month */}
            <Table
              dataSource={pastSettlements}
              rowKey="id"
              size="small"
              loading={pastSettlementsLoading}
              pagination={{
                pageSize: 10,
                showTotal: (total) => `共 ${total} 条`,
              }}
              locale={{ emptyText: '该月暂无结算记录' }}
            >
              <Table.Column
                title="陪玩"
                dataIndex={['companion', 'user', 'username']}
                width={100}
              />
              <Table.Column
                title="金额"
                dataIndex="amount"
                width={100}
                render={(v: number) => (
                  <Text strong style={{ color: '#3f8600' }}>
                    ¥{v.toFixed(2)}
                  </Text>
                )}
              />
              <Table.Column
                title="备注"
                dataIndex="note"
                ellipsis
                render={(v: string) => v || '-'}
              />
              <Table.Column
                title="日期"
                dataIndex="createdAt"
                width={160}
                render={(d: string) => new Date(d).toLocaleString('zh-CN')}
              />
            </Table>
          </Card>

          {/* ── Wallet Transaction Review ── */}
          <Card title="钱包审核" style={{ marginTop: 16 }}>
            <Tabs
              activeKey={walletTxnsFilter}
              onChange={setWalletTxnsFilter}
              items={[
                { key: '', label: '全部' },
                { key: 'PENDING', label: '待审核' },
                { key: 'APPROVED', label: '已通过' },
                { key: 'REJECTED', label: '已驳回' },
              ]}
            />
            <Table
              dataSource={walletTxns}
              rowKey="id"
              size="small"
              loading={walletTxnsLoading}
              locale={{ emptyText: '暂无钱包交易记录' }}
              pagination={{
                pageSize: 10,
                showTotal: (total) => `共 ${total} 条`,
              }}
            >
              <Table.Column
                title="陪玩"
                dataIndex={['companion', 'user', 'username']}
                width={100}
              />
              <Table.Column
                title="类型"
                dataIndex="type"
                width={90}
                render={(t: string) => {
                  const labels: Record<
                    string,
                    { color: string; text: string }
                  > = {
                    DEPOSIT: { color: 'blue', text: '充值' },
                    WITHDRAW: { color: 'orange', text: '支取' },
                    FREEZE: { color: 'red', text: '冻结' },
                    UNFREEZE: { color: 'green', text: '解冻' },
                    SETTLEMENT: { color: 'purple', text: '结算' },
                  };
                  return (
                    <Tag color={labels[t]?.color}>
                      {labels[t]?.text ?? t}
                    </Tag>
                  );
                }}
              />
              <Table.Column
                title="金额"
                dataIndex="amount"
                width={90}
                render={(v: number) => (
                  <Text strong style={{ color: '#cf1322' }}>
                    ¥{v.toFixed(2)}
                  </Text>
                )}
              />
              <Table.Column
                title="状态"
                dataIndex="status"
                width={90}
                render={(s: string) => {
                  const cfg = reviewStatusConfig[s];
                  return <Tag color={cfg?.color}>{cfg?.label ?? s}</Tag>;
                }}
              />
              <Table.Column
                title="日期"
                dataIndex="createdAt"
                width={160}
                render={(d: string) =>
                  new Date(d).toLocaleString('zh-CN')
                }
              />
              <Table.Column
                title="备注"
                dataIndex="note"
                ellipsis
                render={(v: string) => v || '-'}
              />
              <Table.Column
                title="操作"
                render={(_: any, r: any) =>
                  r.status === 'PENDING' ? (
                    <Space>
                      <Button
                        size="small"
                        type="primary"
                        onClick={() =>
                          handleWalletReview(r.id, 'APPROVED')
                        }
                      >
                        通过
                      </Button>
                      <Button
                        size="small"
                        danger
                        onClick={() =>
                          handleWalletReview(r.id, 'REJECTED')
                        }
                      >
                        驳回
                      </Button>
                    </Space>
                  ) : (
                    <Text type="secondary">-</Text>
                  )
                }
              />
            </Table>
          </Card>
        </>
      )}
    </div>
  );
};

export default BillingPage;
