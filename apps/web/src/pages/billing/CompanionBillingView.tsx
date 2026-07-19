// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { extractErrorMessage } from '../../utils/error-handler';
import {
  Table,
  Button,
  Tag,
  Typography,
  Space,
  message,
  Row,
  Col,
  Statistic,
  Card,
  Modal,
  InputNumber,
  Input,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { TransactionStatus } from '@chunlv/shared';
import { expenseReportsApi } from '../../api/expenses';
import http from '../../api/client';
import { useAuthStore } from '../../stores/authStore';

const { Text } = Typography;

const statusConfig: Record<TransactionStatus, { color: string; label: string }> = {
  [TransactionStatus.PENDING]: { color: 'processing', label: '待审核' },
  [TransactionStatus.APPROVED]: { color: 'green', label: '已通过' },
  [TransactionStatus.REJECTED]: { color: 'error', label: '已拒绝' },
};

const reviewStatusConfig: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'orange', label: '待审核' },
  APPROVED: { color: 'green', label: '已通过' },
  REJECTED: { color: 'red', label: '已驳回' },
};

const CompanionBillingView: React.FC = () => {
  const user = useAuthStore((s) => s.user);

  // My transactions
  const [compTransactions, setCompTransactions] = useState<any[]>([]);
  const [compLoading, setCompLoading] = useState(false);
  const [compTotal, setCompTotal] = useState(0);

  // Expense/withdraw application
  const [reportModal, setReportModal] = useState(false);
  const [reportType, setReportType] = useState<'EXPENSE' | 'WITHDRAW'>('EXPENSE');
  const [reportAmount, setReportAmount] = useState<number>(0);
  const [reportDesc, setReportDesc] = useState('');
  const [compExpenseReports, setCompExpenseReports] = useState<any[]>([]);
  const [compReportsLoading, setCompReportsLoading] = useState(false);

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
      message.error(extractErrorMessage(e, '提交失败'));
    }
  };

  return (
    <div>
      {/* My Transactions */}
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
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetchCompTransactions} loading={compLoading}>
            刷新
          </Button>
        </div>

        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}>
            <Card size="small">
              <Statistic title="报账总数" value={compTransactions.length} valueStyle={{ color: '#007AFF' }} />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic
                title="已通过"
                value={compTransactions.filter((t: any) => t.status === 'APPROVED').length}
                valueStyle={{ color: '#34C759' }}
              />
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Statistic title="总收入" value={`¥${compTotal.toFixed(2)}`} valueStyle={{ color: '#FF4757' }} />
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
          <Table.Column title="支付方式" dataIndex="paymentMethod" width={100} render={(v: string) => v || '-'} />
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
            render={(v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-')}
          />
        </Table>
      </div>

      {/* Expense / Withdraw Application */}
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
          <Table.Column title="备注" dataIndex="description" ellipsis render={(v: string) => v || '-'} />
          <Table.Column
            title="状态"
            dataIndex="status"
            width={100}
            render={(s: string) => {
              const cfg = reviewStatusConfig[s];
              return <Tag color={cfg?.color}>{cfg?.label ?? s}</Tag>;
            }}
          />
          <Table.Column title="审核备注" dataIndex="reviewNote" ellipsis render={(v: string) => v || '-'} />
          <Table.Column
            title="提交时间"
            dataIndex="createdAt"
            width={160}
            render={(v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-')}
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
    </div>
  );
};

export default CompanionBillingView;
