// craftsman-ignore: TS001,TS002,TS003
import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Tabs, Table, Button, Space, Typography, Tag, message, Modal, Select, Input, DatePicker, Statistic, Row, Col, Popconfirm,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import PageHeader from '../../components/PageHeader';
import { expenseReportsApi } from '../../api/expenses';
import { billingApi } from '../../api/billing';

const { Text } = Typography;
const { TextArea } = Input;

const expenseTypeConfig: Record<string, { color: string; label: string }> = {
  EXPENSE: { color: 'blue', label: '支出' },
  WITHDRAW: { color: 'orange', label: '支取' },
};

const walletTypeConfig: Record<string, { color: string; label: string }> = {
  DEPOSIT: { color: 'blue', label: '充值' },
  WITHDRAW: { color: 'orange', label: '支取' },
  FREEZE: { color: 'red', label: '冻结' },
  UNFREEZE: { color: 'green', label: '解冻' },
  SETTLEMENT: { color: 'purple', label: '结算' },
};

const reviewStatusConfig: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'gold', label: '待审核' },
  APPROVED: { color: 'green', label: '已通过' },
  REJECTED: { color: 'red', label: '已驳回' },
};

const ExpenseReviewPage: React.FC = () => {
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [summary, setSummary] = useState<any>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [wallets, setWallets] = useState<any[]>([]);
  const [expenseStatus, setExpenseStatus] = useState<string>('PENDING');
  const [walletStatus, setWalletStatus] = useState<string>('PENDING');
  const [loadingExpense, setLoadingExpense] = useState(false);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [reviewRecord, setReviewRecord] = useState<any>(null);
  const [reviewAction, setReviewAction] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await expenseReportsApi.monthlySummary(month.format('YYYY-MM'));
      setSummary((data as any)?.data || null);
    } catch {
      // summary 加载失败不打断主流程
    }
  }, [month]);

  const fetchExpenses = useCallback(async () => {
    setLoadingExpense(true);
    try {
      const { data } = await expenseReportsApi.list({ status: expenseStatus || undefined });
      const all = ((data as any)?.data || []);
      setExpenses(all.filter((r: any) => r.type === 'EXPENSE' || r.type === 'WITHDRAW'));
    } catch {
      message.error('加载支出/支取申请失败');
    } finally {
      setLoadingExpense(false);
    }
  }, [expenseStatus]);

  const fetchWallets = useCallback(async () => {
    setLoadingWallet(true);
    try {
      const { data } = await billingApi.walletTransactions({ status: walletStatus || undefined });
      setWallets((data as any)?.data || []);
    } catch {
      message.error('加载钱包流水失败');
    } finally {
      setLoadingWallet(false);
    }
  }, [walletStatus]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);
  useEffect(() => { fetchWallets(); }, [fetchWallets]);

  const openReview = (record: any, action: 'APPROVED' | 'REJECTED') => {
    setReviewRecord(record);
    setReviewAction(action);
    setReviewNote('');
  };

  const submitReview = async () => {
    if (!reviewRecord) return;
    setReviewing(true);
    try {
      await expenseReportsApi.review(reviewRecord.id, reviewAction, reviewNote || undefined);
      message.success('审核完成');
      setReviewRecord(null);
      await fetchExpenses();
      await fetchSummary();
    } catch {
      message.error('审核失败');
    } finally {
      setReviewing(false);
    }
  };

  const reviewWallet = async (record: any, status: 'APPROVED' | 'REJECTED') => {
    try {
      await billingApi.reviewWalletTransaction(record.id, status);
      message.success('审核完成');
      await fetchWallets();
    } catch {
      message.error('审核失败');
    }
  };

  const expenseColumns = [
    { title: '陪玩', dataIndex: ['companion', 'user', 'username'], render: (_: any, r: any) => r.companion?.user?.username || '-' },
    { title: '类型', dataIndex: 'type', render: (v: string) => <Tag color={expenseTypeConfig[v]?.color}>{expenseTypeConfig[v]?.label || v}</Tag> },
    { title: '金额', dataIndex: 'amount', render: (v: number) => <Text strong>¥{Number(v || 0).toFixed(2)}</Text> },
    { title: '说明', dataIndex: 'description', ellipsis: true },
    {
      title: '截图', dataIndex: 'screenshotUrl', width: 90,
      render: (v: string) => v ? (
        <img src={v} alt="截图" onClick={() => setPreviewUrl(v)} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', border: '1px solid #E5E7EB' }} />
      ) : '-',
    },
    { title: '申请时间', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('MM-DD HH:mm') },
    { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={reviewStatusConfig[v]?.color}>{reviewStatusConfig[v]?.label || v}</Tag> },
    {
      title: '操作', width: 150,
      render: (_: any, r: any) => r.status === 'PENDING' ? (
        <Space>
          <Button size="small" type="primary" onClick={() => openReview(r, 'APPROVED')}>通过</Button>
          <Button size="small" danger onClick={() => openReview(r, 'REJECTED')}>驳回</Button>
        </Space>
      ) : <Text type="secondary">{r.reviewNote || '-'}</Text>,
    },
  ];

  const walletColumns = [
    { title: '陪玩', dataIndex: ['companion', 'user', 'username'], render: (_: any, r: any) => r.companion?.user?.username || '-' },
    { title: '类型', dataIndex: 'type', render: (v: string) => <Tag color={walletTypeConfig[v]?.color}>{walletTypeConfig[v]?.label || v}</Tag> },
    { title: '金额', dataIndex: 'amount', render: (v: number) => <Text strong>¥{Number(v || 0).toFixed(2)}</Text> },
    { title: '变动前', dataIndex: 'balanceBefore', render: (v: number) => `¥${Number(v || 0).toFixed(2)}` },
    { title: '变动后', dataIndex: 'balanceAfter', render: (v: number) => `¥${Number(v || 0).toFixed(2)}` },
    { title: '备注', dataIndex: 'note', ellipsis: true },
    { title: '时间', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('MM-DD HH:mm') },
    { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={reviewStatusConfig[v]?.color}>{reviewStatusConfig[v]?.label || v}</Tag> },
    {
      title: '操作', width: 150,
      render: (_: any, r: any) => r.status === 'PENDING' ? (
        <Space>
          <Popconfirm title="确认通过该笔流水？" onConfirm={() => reviewWallet(r, 'APPROVED')}>
            <Button size="small" type="primary">通过</Button>
          </Popconfirm>
          <Popconfirm title="确认驳回该笔流水？" onConfirm={() => reviewWallet(r, 'REJECTED')}>
            <Button size="small" danger>驳回</Button>
          </Popconfirm>
        </Space>
      ) : '-',
    },
  ];

  return (
    <div>
      <PageHeader
        title="支出/支取审核"
        subtitle="审核陪玩提交的支出、支取申请与钱包流水，杜绝多报、重复支取"
        extra={
          <Space>
            <DatePicker picker="month" value={month} onChange={(v) => v && setMonth(v)} allowClear={false} />
            <Button icon={React.createElement(ReloadOutlined)} onClick={() => { fetchSummary(); fetchExpenses(); fetchWallets(); }}>刷新</Button>
          </Space>
        }
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title="当月已通过支出" value={summary?.totalExpense || 0} precision={2} prefix="¥" /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="当月已通过支取" value={summary?.totalWithdraw || 0} precision={2} prefix="¥" /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="待审金额" value={summary?.pendingAmount || 0} precision={2} prefix="¥" valueStyle={{ color: '#d48806' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="待审单数" value={summary?.pendingCount || 0} suffix="单" /></Card></Col>
      </Row>

      <Tabs
        defaultActiveKey="expense"
        items={[
          {
            key: 'expense',
            label: `支出/支取申请 (${expenses.length})`,
            children: (
              <Card size="small" title="支出/支取申请" extra={
                <Select size="small" style={{ width: 120 }} value={expenseStatus} onChange={setExpenseStatus}
                  options={[
                    { label: '待审核', value: 'PENDING' },
                    { label: '已通过', value: 'APPROVED' },
                    { label: '已驳回', value: 'REJECTED' },
                    { label: '全部', value: '' },
                  ]} />
              }>
                <Table rowKey="id" size="small" loading={loadingExpense} pagination={{ pageSize: 20 }} dataSource={expenses}
                  columns={expenseColumns as any} locale={{ emptyText: '暂无支出/支取申请' }} />
              </Card>
            ),
          },
          {
            key: 'wallet',
            label: `钱包流水 (${wallets.length})`,
            children: (
              <Card size="small" title="钱包流水审核" extra={
                <Select size="small" style={{ width: 120 }} value={walletStatus} onChange={setWalletStatus}
                  options={[
                    { label: '待审核', value: 'PENDING' },
                    { label: '已通过', value: 'APPROVED' },
                    { label: '已驳回', value: 'REJECTED' },
                    { label: '全部', value: '' },
                  ]} />
              }>
                <Table rowKey="id" size="small" loading={loadingWallet} pagination={{ pageSize: 20 }} dataSource={wallets}
                  columns={walletColumns as any} locale={{ emptyText: '暂无钱包流水' }} />
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title={reviewAction === 'APPROVED' ? '通过支出/支取申请' : '驳回支出/支取申请'}
        open={!!reviewRecord}
        onCancel={() => setReviewRecord(null)}
        onOk={submitReview}
        confirmLoading={reviewing}
        okText={reviewAction === 'APPROVED' ? '通过' : '驳回'}
        cancelText="取消"
      >
        {reviewRecord && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Text>{reviewRecord.companion?.user?.username || '-'} · {expenseTypeConfig[reviewRecord.type]?.label || reviewRecord.type} · </Text>
              <Text strong>¥{Number(reviewRecord.amount || 0).toFixed(2)}</Text>
            </div>
            <TextArea rows={3} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="审核备注（可选）" />
          </div>
        )}
      </Modal>

      <Modal open={!!previewUrl} footer={null} onCancel={() => setPreviewUrl(null)} title="截图预览">
        {previewUrl && <img src={previewUrl} alt="截图预览" style={{ width: '100%' }} />}
      </Modal>
    </div>
  );
};

export default ExpenseReviewPage;