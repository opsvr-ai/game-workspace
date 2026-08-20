// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Select,
  DatePicker,
  Table,
  Modal,
  Input,
  InputNumber,
  Tag,
  Typography,
  Space,
  message,
  Spin,
  Upload,
} from 'antd';
import {
  DollarOutlined,
  WalletOutlined,
  BankOutlined,
  SwapOutlined,
  LockOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined, UploadOutlined,
  ThunderboltOutlined,
  HourglassOutlined,
} from '@ant-design/icons';
const IconCheck = React.createElement(CheckCircleOutlined);
const IconClose = React.createElement(CloseCircleOutlined);
const IconReload = React.createElement(ReloadOutlined);
import { UserRole } from '@chunlv/shared';
import http from '../api/client';
import { companionsApi } from '../api/companions';
import { useAuthStore } from '../stores/authStore';
import PageHeader from '../components/PageHeader';
import CardSkeleton from '../components/CardSkeleton';
import TransactionReviewSection from '../components/TransactionReviewSection';
import { serviceTypeConfig } from '../constants/orders';
import dayjs, { Dayjs } from 'dayjs';

const { Text, Title } = Typography;

const IconDollar = React.createElement(DollarOutlined);
const IconWallet = React.createElement(WalletOutlined);
const IconBank = React.createElement(BankOutlined);
const IconHourglass = React.createElement(HourglassOutlined);
const IconSwap = React.createElement(SwapOutlined);
const IconLock = React.createElement(LockOutlined);
const IconThunder = React.createElement(ThunderboltOutlined);

const typeConfig: Record<string, { color: string; label: string }> = {
  DEPOSIT: { color: 'blue', label: '充值' },
  WITHDRAW: { color: 'orange', label: '支取' },
  FREEZE: { color: 'red', label: '冻结' },
  UNFREEZE: { color: 'green', label: '解冻' },
  SETTLEMENT: { color: 'purple', label: '结算' },
};

const statusConfig: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'orange', label: '待审核' },
  APPROVED: { color: 'green', label: '已通过' },
  REJECTED: { color: 'red', label: '已驳回' },
};

const StatBlock: React.FC<{
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
}> = ({ label, value, icon, color }) => (
  <Card size="small" style={{ textAlign: 'center', borderRadius: 8, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
    <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}12`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
      <span style={{ fontSize: 20, color }}>{icon}</span>
    </div>
    <div style={{ fontSize: 20, fontWeight: 700, color: '#1E293B', lineHeight: 1.2 }}>{value}</div>
    <Text style={{ fontSize: 12, color: '#94A3B8' }}>{label}</Text>
  </Card>
);

const BillingOverview: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN;
  const isCompanion = user?.role === UserRole.COMPANION;

  const [companions, setCompanions] = useState<any[]>([]);
  const [selectedCompanionId, setSelectedCompanionId] = useState<string | undefined>();
  const [selectedMonth, setSelectedMonth] = useState<Dayjs>(dayjs());
  const [overviewData, setOverviewData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const [withdrawVisible, setWithdrawVisible] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState<number>(0);
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [todayOrders, setTodayOrders] = useState<any[]>([]);
  const [reportScreenshots, setReportScreenshots] = useState<Record<string,string>>({});
  const [reportAmounts, setReportAmounts] = useState<Record<string,number>>({});
  const [reportRemarks, setReportRemarks] = useState<Record<string,string>>({});
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [transferVisible, setTransferVisible] = useState(false);
  const [transferAmount, setTransferAmount] = useState<number | null>(null);
  const [transferScreenshot, setTransferScreenshot] = useState('');
  const [transferSubmitting, setTransferSubmitting] = useState(false);

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [dailyReports, setDailyReports] = useState<any[]>([]);
  const [viewScreenshots, setViewScreenshots] = useState<string[]>([]);

  const fetchDailyReports = useCallback(async () => {
    try {
      const { data: res } = await http.get('/expense-reports', {
        params: { status: isAdmin ? undefined : undefined },
      });
      const all = (res.data || []).filter((r: any) => r.type === 'TODAY_REVENUE');
      // Group by date
      const grouped: Record<string, any> = {};
      all.forEach((r: any) => {
        const day = dayjs(r.createdAt).format('YYYY-MM-DD');
        if (!grouped[day]) grouped[day] = { date: day, reports: [], totalAmount: 0, items: [] as any[] };
        grouped[day].reports.push(r);
        grouped[day].totalAmount += r.amount || 0;
        // Parse V2 items
        try {
          const data = JSON.parse(r.description || '{}');
          if (data.items) grouped[day].items.push(...data.items);
        } catch {}
      });
      setDailyReports(Object.values(grouped).sort((a: any, b: any) => b.date.localeCompare(a.date)));
    } catch {}
  }, [isAdmin]);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const month = selectedMonth.format('YYYY-MM');
      const params: any = { month };
      if (selectedCompanionId) params.companionId = selectedCompanionId;
      const { data: res } = await http.get('/billing/overview', { params });
      setOverviewData(res.data);
      setCompanions(res.data?.companions ?? []);
    } catch {
      message.error('加载报账概览失败');
    } finally {
      setLoading(false);
    }
  }, [selectedCompanionId, selectedMonth]);

  // Fetch on mount and when params change
  useEffect(() => {
    fetchOverview();
    fetchDailyReports();
  }, [fetchOverview, fetchDailyReports]);

  // Auto-refresh: 30s polling
  useEffect(() => {
    const t = setInterval(() => { fetchOverview(); fetchDailyReports(); }, 30_000);
    return () => clearInterval(t);
  }, [fetchOverview, fetchDailyReports]);

  // Refresh on visibility change and focus
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') { fetchOverview(); fetchDailyReports(); }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [fetchOverview, fetchDailyReports]);

  // For companions, auto-set their own companionId
  useEffect(() => {
    if (isCompanion && user?.companionId) {
      setSelectedCompanionId(user.companionId);
    }
  }, [isCompanion, user?.companionId]);

  const handleWithdraw = async () => {
    if (withdrawAmount <= 0) {
      message.warning('请输入有效金额');
      return;
    }
    setWithdrawSubmitting(true);
    try {
      await http.post('/companions/me/withdraw', { amount: withdrawAmount });
      message.success('支取申请已提交');
      setWithdrawVisible(false);
      setWithdrawAmount(0);
      fetchOverview();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '申请失败');
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  const handleSingleApprove = async (id: string) => {
    try {
      await http.put(`/transactions/${id}/approve`);
      message.success('已通过');
      fetchOverview();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '操作失败');
    }
  };

  const handleSingleReject = async (id: string) => {
    try {
      await http.put(`/transactions/${id}/reject`);
      message.success('已驳回');
      fetchOverview();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '操作失败');
    }
  };

  const handleBatchApprove = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请选择要操作的记录');
      return;
    }
    setBatchProcessing(true);
    try {
      await http.put('/transactions/batch', { ids: selectedRowKeys, action: 'approve' });
      message.success(`批量通过 ${selectedRowKeys.length} 条`);
      setSelectedRowKeys([]);
      fetchOverview();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '批量操作失败');
    } finally {
      setBatchProcessing(false);
    }
  };

  const handleBatchReject = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请选择要操作的记录');
      return;
    }
    setBatchProcessing(true);
    try {
      await http.put('/transactions/batch', { ids: selectedRowKeys, action: 'reject' });
      message.success(`批量驳回 ${selectedRowKeys.length} 条`);
      setSelectedRowKeys([]);
      fetchOverview();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '批量操作失败');
    } finally {
      setBatchProcessing(false);
    }
  };

  const handleSettlement = async () => {
    setBatchProcessing(true);
    try {
      const month = selectedMonth.format('YYYY-MM');
      await http.post('/monthly-settlement', { month });
      message.success('月结算完成');
      fetchOverview();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '结算失败');
    } finally {
      setBatchProcessing(false);
    }
  };

  const records = overviewData?.records ?? [];

  const columns: any[] = [
    {
      title: '类型', dataIndex: 'type', key: 'type', width: 80,
      render: (t: string) => {
        const cfg = typeConfig[t] ?? { color: 'default', label: t };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '金额', dataIndex: 'amount', key: 'amount', width: 100,
      render: (v: number) => (
        <Text strong style={{ color: '#EF4444' }}>¥{v?.toFixed(1) ?? '0.00'}</Text>
      ),
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (s: string) => {
        const cfg = statusConfig[s] ?? { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '陪玩', dataIndex: 'companionName', key: 'companionName', width: 90,
      render: (v: string) => v || '-',
    },
    {
      title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 150,
      render: (d: string) => (d ? new Date(d).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '备注', dataIndex: 'note', key: 'note', width: 120, ellipsis: true,
      render: (v: string) => v || '-',
    },
    ...(isAdmin
      ? [{
          title: '操作', key: 'action', width: 130,
          render: (_: unknown, record: any) => {
            if (record.status !== 'PENDING') return <Text type="secondary">-</Text>;
            return (
              <Space size="small">
                <Button type="link" size="small" icon={IconCheck} onClick={() => handleSingleApprove(record.id)}>通过</Button>
                <Button type="link" size="small" danger icon={IconClose} onClick={() => handleSingleReject(record.id)}>驳回</Button>
              </Space>
            );
          },
        }]
      : []),
  ];

  const rowSelection = isAdmin
    ? {
        selectedRowKeys,
        onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
        getCheckboxProps: (record: any) => ({
          disabled: record.status !== 'PENDING',
        }),
      }
    : undefined;

  return (
    <div>
      {/* Title Bar */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
        <Col>
          <PageHeader title="报账系统" />
        </Col>
        <Col>
          <Space>
            {!isCompanion && (
              <Select
                placeholder="选择陪玩"
                allowClear
                style={{ width: 180 }}
                value={selectedCompanionId}
                onChange={(v) => setSelectedCompanionId(v)}
                loading={loading}
              >
                {companions.map((c: any) => (
                  <Select.Option key={c.id} value={c.id}>
                    {c.name}
                  </Select.Option>
                ))}
              </Select>
            )}
            <DatePicker
              picker="month"
              value={selectedMonth}
              onChange={(v) => v && setSelectedMonth(v)}
              allowClear={false}
            />
            <Button icon={IconReload} onClick={fetchOverview} loading={loading}>
              刷新
            </Button>
          </Space>
        </Col>
      </Row>

      {loading && !overviewData ? (
        <CardSkeleton lines={6} />
      ) : (
        <>
        {/* 6 Stat Cards */}
        <Row gutter={[16, 16]} style={{ marginBottom: 12 }}>
          <Col span={4}>
            <StatBlock
              label="今日流水"
              value={`¥${(overviewData?.summary?.todayRevenue ?? 0).toFixed(1)}`}
              icon={IconDollar}
              color="#2563EB"
            />
          </Col>
          <Col span={4}>
            <StatBlock
              label="总流水"
              value={`¥${(overviewData?.summary?.totalRevenue ?? 0).toFixed(1)}`}
              icon={IconWallet}
              color="#7C3AED"
            />
          </Col>
          <Col span={4}>
            <StatBlock
              label="已支取"
              value={`¥${(overviewData?.summary?.totalWithdrawn ?? 0).toFixed(1)}`}
              icon={IconBank}
              color="#16A34A"
            />
          </Col>
          <Col span={4}>
            <StatBlock
              label="审核中"
              value={`¥${(overviewData?.summary?.pendingWithdraw ?? 0).toFixed(1)}`}
              icon={IconHourglass}
              color="#F59E0B"
            />
          </Col>
          <Col span={4}>
            <StatBlock
              label="待支取"
              value={`¥${(overviewData?.summary?.withdrawable ?? 0).toFixed(1)}`}
              icon={IconSwap}
              color="#F59E0B"
            />
          </Col>
          <Col span={4}>
            <StatBlock
              label="押金"
              value={`¥${(overviewData?.summary?.deposit ?? 0).toFixed(1)}`}
              icon={IconLock}
              color="#06B6D4"
            />
          </Col>
        </Row>

        {/* Daily Billing Reports */}
        {dailyReports.length > 0 && (
          <Card title="📋 日报记录" size="small" style={{ borderRadius: 8, marginBottom: 12 }}>
            {dailyReports.map((day: any) => {
              const allScreenshots: string[] = [];
              day.reports.forEach((r: any) => {
                try {
                  const data = JSON.parse(r.description || '{}');
                  const ss = data.screenshots || data;
                  Object.values(ss).forEach((url: any) => { if (typeof url === 'string' && url) allScreenshots.push(url); });
                } catch {}
              });
              return (
                <Card key={day.date} size="small" style={{ marginBottom: 8, background: '#FAFBFC' }}
                  title={
                    <Space>
                      <Text strong>{day.date}</Text>
                      <Tag color="blue">{day.reports.length}条报账</Tag>
                      <Text style={{ color: '#EF4444', fontWeight: 600 }}>¥{day.totalAmount.toFixed(1)}</Text>
                      <Tag>{allScreenshots.length}张截图</Tag>
                    </Space>
                  }
                >
                  {allScreenshots.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      {allScreenshots.map((url: string, i: number) => (
                        <img
                          key={i}
                          src={url}
                          alt={`截图${i + 1}`}
                          onClick={() => setViewScreenshots([url])}
                          style={{
                            width: 120, height: 120, objectFit: 'cover', borderRadius: 6,
                            border: '1px solid #E5E7EB', cursor: 'pointer',
                          }}
                        />
                      ))}
                    </div>
                  )}
                  {/* Order items (V2 format) */}
                  {day.items && day.items.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      {day.items.map((item: any, i: number) => (
                        <div key={i} style={{ padding: '4px 8px', fontSize: 12, background: '#fff', borderRadius: 4, marginBottom: 2 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Space size={8}>
                              <Text type="secondary">{item.gameName}</Text>
                              {item.claimedMode && <Tag color="geekblue" style={{ fontSize: 10, margin: 0 }}>{item.claimedMode}</Tag>}
                              <Text type="secondary">{item.customerWechat}</Text>
                              {item.coName && <Text type="secondary">搭档：{item.coName}</Text>}
                              {item.screenshotUrl && (
                                <img src={item.screenshotUrl} alt="截图" onClick={() => setViewScreenshots([item.screenshotUrl])}
                                  style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 3, cursor: 'pointer', border: '1px solid #E5E7EB' }} />
                              )}
                            </Space>
                            <Space size={6}>
                              {item.claimedPrice != null && (
                                <Text type="secondary" style={{ fontSize: 10 }}>{item.claimedPrice}×{item.duration || 1}h</Text>
                              )}
                              <Text strong style={{ color: '#EF4444' }}>¥{item.amount}</Text>
                            </Space>
                          </div>
                          {item.remark && (
                            <div style={{ fontSize: 12, color: '#B45309', background: '#FFFBEB', padding: '4px 8px', borderRadius: 4, marginTop: 4 }}>
                              💬 {item.remark}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {day.reports.map((r: any, i: number) => (
                    <div key={r.id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: i < day.reports.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                      <Space size={12}>
                        <Tag color={r.status === 'APPROVED' ? 'green' : r.status === 'REJECTED' ? 'red' : 'orange'}>
                          {statusConfig[r.status]?.label || r.status}
                        </Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(r.createdAt).format('HH:mm')}</Text>
                      </Space>
                    </div>
                  ))}
                </Card>
              );
            })}
          </Card>
        )}

        {/* Screenshot Viewer Modal */}
        <Modal
          title="转账截图"
          open={viewScreenshots.length > 0}
          footer={null}
          onCancel={() => setViewScreenshots([])}
          width={800}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {viewScreenshots.map((url, i) => (
              <img key={i} src={url} alt={`截图${i + 1}`} style={{ maxWidth: '100%', maxHeight: 500, borderRadius: 8, border: '1px solid #E5E7EB' }} />
            ))}
          </div>
        </Modal>

        {/* Withdrawal Records Table */}
        <Card title="支取记录" size="small" style={{ borderRadius: 8 }}>
          <Table
            dataSource={records}
            rowKey="id"
            size="middle"
            rowSelection={rowSelection}
            columns={columns}
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
            }}
            locale={{ emptyText: '暂无记录' }}
            scroll={{ x: 750 }}
          />
        </Card>
        </>
      )}

      {/* Bottom Action Bar */}
      <div style={{ marginTop: 16, textAlign: 'right' }}>
        {isCompanion && (
          <Space>
            <Button icon={<UploadOutlined />} onClick={() => {
              companionsApi.todaySessions().then(({data}:any) => {
                const sessions = data.data || [];
                const mapped = sessions.map((s:any) => ({
                  id: s.parentOrderId || s.id,
                  sessionId: s.id,
                  gameName: s.gameName,
                  type: s.type,
                  customerWechat: s.customerWechat,
                  duration: s.duration,
                  actualHours: s.actualHours,
                  serviceType: s.serviceType,
                  claimedMode: s.claimedMode,
                  claimedPrice: s.claimedPrice,
                  unitPrice: s.unitPrice,
                  systemAmount: s.systemAmount,
                  transferScreenshotUrl: s.transferScreenshotUrl,
                  coName: s.coName,
                  isPartner: s.isPartner,
                  dual: s.dual,
                  amount: s.myAmount,
                  startedAt: s.startedAt,
                  endedAt: s.endedAt,
                  createdAt: s.createdAt,
                }));
                setTodayOrders(mapped);
                setReportRemarks({});
                const amounts: Record<string,number> = {};
                const shots: Record<string,string> = {};
                mapped.forEach((o:any) => {
                  amounts[o.id] = o.systemAmount || o.amount || 0;
                  if (o.transferScreenshotUrl) shots[o.id] = o.transferScreenshotUrl;
                });
                setReportAmounts(amounts);
                setReportScreenshots(shots);
                setReportVisible(true);
              }).catch(()=>{});
            }}>上报今日流水</Button>
              <Button type="primary" icon={IconBank} onClick={() => {
                setTransferAmount(null);
                setTransferScreenshot('');
                setTransferVisible(true);
              }}>转公户</Button>
              <Button type="primary" icon={IconSwap} onClick={() => setWithdrawVisible(true)}>申请支取</Button>
            </Space>
          )}
        {isAdmin && (
          <Space>
            <Button
              type="primary"
              icon={IconCheck}
              onClick={handleBatchApprove}
              loading={batchProcessing}
              disabled={selectedRowKeys.length === 0}
            >
              批量通过
            </Button>
            <Button
              danger
              icon={IconClose}
              onClick={handleBatchReject}
              loading={batchProcessing}
              disabled={selectedRowKeys.length === 0}
            >
              批量驳回
            </Button>
            <Button
              icon={IconThunder}
              onClick={handleSettlement}
              loading={batchProcessing}
            >
              执行月结算
            </Button>
          </Space>
        )}
      </div>

      {/* Report Today Modal */}
      <Modal title="📋 上报今日流水" open={reportVisible} width={1400}
        onOk={async () => {
          setReportSubmitting(true);
          try {
            // Submit amounts and screenshots
            const items = todayOrders.map(o => ({
              orderId: o.id,
              sessionId: o.sessionId,
              gameName: o.gameName,
              amount: reportAmounts[o.id] || 0,
              screenshotUrl: reportScreenshots[o.id] || '',
              customerWechat: o.customerWechat || '',
              claimedMode: o.claimedMode,
              claimedPrice: o.claimedPrice,
              duration: o.duration,
              coName: o.coName,
              remark: reportRemarks[o.id] || '',
            }));
            await http.post('/billing/report-today-v2', { items });
            message.success('已提交审核');
            setReportVisible(false);
            fetchOverview();
            fetchDailyReports();
          } catch(e:any) { message.error(e?.response?.data?.message||'提交失败'); }
          finally { setReportSubmitting(false); }
        }}
        onCancel={() => setReportVisible(false)}
        okText="提交审核" cancelText="取消" confirmLoading={reportSubmitting} destroyOnClose>
        {todayOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#94A3B8' }}>
            今天还没有已完成的订单
          </div>
        ) : (
          <div style={{ maxHeight: 620, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #E2E8F0' }}>
                  <th style={{ padding: '8px 10px', fontSize: 12, color: '#64748B', width: 44 }}>序号</th>
                  <th style={{ padding: '8px 10px', fontSize: 12, color: '#64748B', width: 240 }}>订单</th>
                  <th style={{ padding: '8px 10px', fontSize: 12, color: '#64748B', width: 150 }}>开始时间</th>
                  <th style={{ padding: '8px 10px', fontSize: 12, color: '#64748B', width: 150 }}>结束时间</th>
                  <th style={{ padding: '8px 10px', fontSize: 12, color: '#64748B', width: 70 }}>时长</th>
                  <th style={{ padding: '8px 10px', fontSize: 12, color: '#64748B', width: 80 }}>服务</th>
                  <th style={{ padding: '8px 10px', fontSize: 12, color: '#64748B', width: 60 }}>模式</th>
                  <th style={{ padding: '8px 10px', fontSize: 12, color: '#64748B', width: 90 }}>单价</th>
                  <th style={{ padding: '8px 10px', fontSize: 12, color: '#64748B', width: 100 }}>系统应上报</th>
                  <th style={{ padding: '8px 10px', fontSize: 12, color: '#64748B', width: 100 }}>实际</th>
                  <th style={{ padding: '8px 10px', fontSize: 12, color: '#64748B', width: 80 }}>截图</th>
                  <th style={{ padding: '8px 10px', fontSize: 12, color: '#64748B', width: 180 }}>备注</th>
                </tr>
              </thead>
              <tbody>
                {todayOrders.map((o: any, idx: number) => (
                  <tr key={o.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                    <td style={{ padding: '8px 10px', fontSize: 12, color: '#94A3B8' }}>{idx + 1}</td>
                    <td style={{ padding: '8px 10px', fontSize: 12 }}>
                      <Space size={4} wrap>
                        <Text>{o.gameName}</Text>
                        <Tag color={o.type === 'NEW' ? 'green' : o.type === 'RENEW' ? 'blue' : o.type === 'REPURCHASE' ? 'purple' : 'orange'} style={{ fontSize: 10, margin: 0 }}>
                          {({NEW:'首',RENEW:'续',REPURCHASE:'复',TIP:'赏'} as Record<string, string>)[o.type] || o.type}
                        </Tag>
                        <Tag color={o.dual ? 'magenta' : 'cyan'} style={{ fontSize: 10, margin: 0 }}>{o.dual ? '双陪' : '单陪'}</Tag>
                        {o.isPartner && <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>副陪</Tag>}
                        {o.coName && <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>{o.isPartner ? '主陪' : '搭档'}：{o.coName}</Tag>}
                      </Space>
                      <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{o.customerWechat || '-'}</div>
                    </td>
                    <td style={{ padding: '8px 10px', fontSize: 12, whiteSpace: 'nowrap' }}>{o.startedAt ? dayjs(o.startedAt).format('YYYY-MM-DD HH:mm') : '-'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 12, whiteSpace: 'nowrap' }}>{o.endedAt ? dayjs(o.endedAt).format('YYYY-MM-DD HH:mm') : '-'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'center' }}>{Number(o.actualHours || o.duration || 0).toFixed(1)}h</td>
                    <td style={{ padding: '8px 10px', fontSize: 12 }}>{serviceTypeConfig[o.serviceType]?.label || '陪玩'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 12 }}>{o.claimedMode || '-'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }}>{Number(o.unitPrice || o.claimedPrice || 0).toFixed(1)}/时</td>
                    <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'right', color: '#2563EB', fontWeight: 600, whiteSpace: 'nowrap' }}>¥{Number(o.systemAmount || o.amount || 0).toFixed(1)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <InputNumber
                        size="small"
                        min={0}
                        value={reportAmounts[o.id] ?? 0}
                        onChange={(v) => setReportAmounts(prev => ({ ...prev, [o.id]: v ?? 0 }))}
                        style={{ width: 90 }}
                        prefix="¥"
                      />
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      {reportScreenshots[o.id] ? (
                        <img src={reportScreenshots[o.id]} alt="预览"
                          onClick={() => setViewScreenshots([reportScreenshots[o.id]])}
                          style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: '1px solid #E5E7EB' }}
                        />
                      ) : (
                        <Upload showUploadList={false} accept="image/*" beforeUpload={async (file) => {
                          const fd = new FormData(); fd.append('file', file);
                          try { const { data } = await http.post('/upload/screenshot', fd);
                            setReportScreenshots(prev => ({ ...prev, [o.id]: data.data?.url || '' }));
                          } catch { message.error('上传失败'); }
                          return false;
                        }}>
                          <Button size="small" icon={<UploadOutlined />} style={{ fontSize: 12 }}>上传</Button>
                        </Upload>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <Input
                        size="small"
                        placeholder="备注"
                        value={reportRemarks[o.id] || ''}
                        onChange={(e) => setReportRemarks(prev => ({ ...prev, [o.id]: e.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {todayOrders.length > 0 && (
          <div style={{ background:'#F0FDF4', borderRadius:8, padding:12, marginTop:12 }}>
            <Text strong>合计：共 {todayOrders.length} 单 · ¥{Object.values(reportAmounts).reduce((s:number, v:number) => s + v, 0)}</Text>
            <Text type="secondary" style={{ marginLeft: 16 }}>
              已传截图：{Object.values(reportScreenshots).filter(Boolean).length}/{todayOrders.length}
            </Text>
          </div>
        )}
      </Modal>

      {/* Company Transfer Modal */}
      <Modal
        title="🏦 转公户（当日实际流水最终口径）"
        open={transferVisible}
        onOk={async () => {
          if (!transferAmount || transferAmount <= 0) {
            message.warning('请填写业绩金额');
            return;
          }
          if (!transferScreenshot) {
            message.warning('请上传转给公户的转账截图');
            return;
          }
          setTransferSubmitting(true);
          try {
            await http.post('/billing/company-transfer', {
              amount: transferAmount,
              screenshotUrl: transferScreenshot,
            });
            message.success('转公户已提交，以该金额作为今日实际流水');
            setTransferVisible(false);
            fetchOverview();
            fetchDailyReports();
          } catch (err: any) {
            message.error(err?.response?.data?.message || '提交失败');
          } finally {
            setTransferSubmitting(false);
          }
        }}
        onCancel={() => setTransferVisible(false)}
        okText="提交"
        cancelText="取消"
        confirmLoading={transferSubmitting}
        destroyOnClose
      >
        <div style={{ marginBottom: 12 }}>
          <Text>业绩金额（今日实际转入公户的金额）</Text>
          <InputNumber
            min={0}
            style={{ width: '100%', marginTop: 4 }}
            value={transferAmount}
            onChange={(v) => setTransferAmount(v || null)}
            prefix="¥"
            placeholder="例如 290"
          />
        </div>
        <div>
          <Text>转给公户的转账截图（必传，作为最终流水依据）</Text>
          <div style={{ marginTop: 4 }}>
            <Upload
              showUploadList={false}
              accept="image/*"
              beforeUpload={async (file) => {
                const fd = new FormData();
                fd.append('file', file);
                try {
                  const res: any = await http.post('/upload/screenshot', fd);
                  const url = res?.data?.data?.url || res?.data?.url;
                  if (url) {
                    setTransferScreenshot(url);
                    message.success('截图已上传');
                  } else {
                    message.error('上传失败');
                  }
                } catch {
                  message.error('上传失败');
                }
                return false;
              }}
            >
              <Button icon={<UploadOutlined />}>
                {transferScreenshot ? '重新上传截图' : '上传转账截图'}
              </Button>
            </Upload>
            {transferScreenshot && (
              <Tag color="green" style={{ marginLeft: 8 }}>已上传</Tag>
            )}
          </div>
        </div>
        <div style={{ marginTop: 12, background: '#FFF7E6', borderRadius: 8, padding: 10 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            说明：每次开始服务/续单/复购上传的客户转账截图是参考；下班前转给公户的这笔金额才是当日实际流水，最终以这笔为准。
          </Text>
        </div>
      </Modal>

      {/* Withdraw Modal */}
      <Modal
        title="申请支取"
        open={withdrawVisible}
        onOk={handleWithdraw}
        onCancel={() => {
          setWithdrawVisible(false);
          setWithdrawAmount(0);
        }}
        confirmLoading={withdrawSubmitting}
        okText="提交申请"
        cancelText="取消"
      >
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              background: '#F0FDF4',
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <Text>
              总流水：
              <Text strong>¥{(overviewData?.summary?.totalRevenue ?? 0).toFixed(1)}</Text>
            </Text>
            <br />
            <Text>
              已支取：
              <Text strong>¥{(overviewData?.summary?.totalWithdrawn ?? 0).toFixed(1)}</Text>
            </Text>
            <br />
            <Text>
              可支取余额：
              <Text strong style={{ color: '#faad14', fontSize: 18 }}>
                ¥{(overviewData?.summary?.withdrawable ?? 0).toFixed(1)}
              </Text>
            </Text>
          </div>
          <Text type="secondary">提示：提交后需管理员审核通过。</Text>
        </div>
        <div>
          <Text>支取金额：</Text>
          <InputNumber
            style={{ width: '100%', marginTop: 8 }}
            min={0}
            max={overviewData?.summary?.withdrawable ?? 0}
            value={withdrawAmount}
            onChange={(v) => setWithdrawAmount(v ?? 0)}
            placeholder="请输入支取金额"
            addonAfter="元"
          />
        </div>
      </Modal>
      <TransactionReviewSection />
    </div>
  );
};

export default BillingOverview;
