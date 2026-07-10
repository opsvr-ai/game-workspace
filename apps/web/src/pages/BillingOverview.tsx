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
import { useAuthStore } from '../stores/authStore';
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
  <Card size="small" style={{ borderLeft: `3px solid ${color}`, textAlign: 'center' }}>
    <div style={{ fontSize: 24, color, opacity: 0.5, marginBottom: 4 }}>{icon}</div>
    <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
    <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
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
  const [reportSubmitting, setReportSubmitting] = useState(false);

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchProcessing, setBatchProcessing] = useState(false);

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
  }, [fetchOverview]);

  // Auto-refresh: 30s polling
  useEffect(() => {
    const t = setInterval(fetchOverview, 30_000);
    return () => clearInterval(t);
  }, [fetchOverview]);

  // Refresh on visibility change and focus
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchOverview();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [fetchOverview]);

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
      await http.put(`/billing/records/${id}/approve`);
      message.success('已通过');
      fetchOverview();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '操作失败');
    }
  };

  const handleSingleReject = async (id: string) => {
    try {
      await http.put(`/billing/records/${id}/reject`);
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
      await http.post('/billing/batch-approve', { ids: selectedRowKeys });
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
      await http.post('/billing/batch-reject', { ids: selectedRowKeys });
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
      await http.post('/billing/monthly-settlement', { month });
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
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 90,
      render: (t: string) => {
        const cfg = typeConfig[t] ?? { color: 'default', label: t };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 110,
      render: (v: number) => (
        <Text strong style={{ color: '#cf1322' }}>
          ¥{v?.toFixed(2) ?? '0.00'}
        </Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: string) => {
        const cfg = statusConfig[s] ?? { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '陪玩',
      dataIndex: 'companionName',
      key: 'companionName',
      width: 100,
      render: (v: string) => v || '-',
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (d: string) => (d ? new Date(d).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '备注',
      dataIndex: 'note',
      key: 'note',
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    ...(isAdmin
      ? [
          {
            title: '操作',
            key: 'action',
            width: 150,
            render: (_: unknown, record: any) => {
              if (record.status !== 'PENDING') return <Text type="secondary">-</Text>;
              return (
                <Space size="small">
                  <Button
                    type="link"
                    size="small"
                    icon={IconCheck}
                    onClick={() => handleSingleApprove(record.id)}
                  >
                    通过
                  </Button>
                  <Button
                    type="link"
                    size="small"
                    danger
                    icon={IconClose}
                    onClick={() => handleSingleReject(record.id)}
                  >
                    驳回
                  </Button>
                </Space>
              );
            },
          },
        ]
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
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Title level={3} style={{ margin: 0 }}>
            报账系统
          </Title>
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

      <Spin spinning={loading}>
        {/* 6 Stat Cards */}
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col span={4}>
            <StatBlock
              label="今日流水"
              value={`¥${(overviewData?.todayRevenue ?? 0).toFixed(2)}`}
              icon={IconDollar}
              color="#1677ff"
            />
          </Col>
          <Col span={4}>
            <StatBlock
              label="总流水"
              value={`¥${(overviewData?.totalRevenue ?? 0).toFixed(2)}`}
              icon={IconWallet}
              color="#722ed1"
            />
          </Col>
          <Col span={4}>
            <StatBlock
              label="已支取"
              value={`¥${(overviewData?.totalWithdrawn ?? 0).toFixed(2)}`}
              icon={IconBank}
              color="#52c41a"
            />
          </Col>
          <Col span={4}>
            <StatBlock
              label="审核中"
              value={`¥${(overviewData?.pendingWithdraw ?? 0).toFixed(2)}`}
              icon={IconHourglass}
              color="#fa8c16"
            />
          </Col>
          <Col span={4}>
            <StatBlock
              label="待支取"
              value={`¥${(overviewData?.withdrawable ?? 0).toFixed(2)}`}
              icon={IconSwap}
              color="#faad14"
            />
          </Col>
          <Col span={4}>
            <StatBlock
              label="押金"
              value={`¥${(overviewData?.deposit ?? 0).toFixed(2)}`}
              icon={IconLock}
              color="#13c2c2"
            />
          </Col>
        </Row>

        {/* Withdrawal Records Table */}
        <Card title="支取记录" size="small">
          <Table
            dataSource={records}
            rowKey="id"
            size="small"
            rowSelection={rowSelection}
            columns={columns}
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
            }}
            locale={{ emptyText: '暂无记录' }}
          />
        </Card>
      </Spin>

      {/* Bottom Action Bar */}
      <div style={{ marginTop: 16, textAlign: 'right' }}>
        {isCompanion && (
          <Space>
            <Button icon={<UploadOutlined />} onClick={() => {
              http.get('/orders?all=true').then(({data}:any) => {
                const list = data.data?.items ?? data.data ?? [];
                setTodayOrders(list.filter((o:any) => o.status === 'DONE' && new Date(o.createdAt).toDateString()===new Date().toDateString()));
                setReportScreenshots({});
                setReportVisible(true);
              }).catch(()=>{});
            }}>上报今日流水</Button>
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
      <Modal title="📋 上报今日流水" open={reportVisible} width={640}
        onOk={async () => {
          setReportSubmitting(true);
          try {
            await http.post('/billing/report-today', { screenshots: reportScreenshots });
            message.success('已提交审核');
            setReportVisible(false);
            fetchOverview();
          } catch(e:any) { message.error(e?.response?.data?.message||'提交失败'); }
          finally { setReportSubmitting(false); }
        }}
        onCancel={() => setReportVisible(false)}
        okText="提交审核" cancelText="取消" confirmLoading={reportSubmitting} destroyOnClose>
        {['NEW','RENEW','REPURCHASE','TIP'].map(type => {
          const orders = todayOrders.filter((o:any) => o.type === type);
          const labels: Record<string,string> = { NEW:'首单', RENEW:'续单', REPURCHASE:'复购', TIP:'打赏' };
          if (!orders.length) return null;
          return (
            <Card key={type} size="small" title={`${labels[type]} (${orders.length}单)`} style={{ marginBottom: 8 }}>
              {orders.map((o:any) => (
                <div key={o.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 4 }}>
                  <span>{o.gameName} · ¥{o.amount} · {o.customer?.wechatId || o.customFields?.customerWechat || '?'}</span>
                  <Upload showUploadList={false} accept="image/*" beforeUpload={async (file) => {
                    const fd = new FormData(); fd.append('file', file);
                    try { const { data } = await http.post('/upload/screenshot', fd);
                      setReportScreenshots(prev => ({ ...prev, [o.id]: data.data?.url || '' }));
                      message.success('截图已上传');
                    } catch { message.error('上传失败'); }
                    return false;
                  }}>
                    <Button size="small">{reportScreenshots[o.id] ? '✅ 已上传' : '📎 上传截图'}</Button>
                  </Upload>
                </div>
              ))}
            </Card>
          );
        })}
        <div style={{ background:'#f6ffed', borderRadius:8, padding:12, marginTop:8 }}>
          <Text strong>汇总：共 {todayOrders.length} 单 · ¥{todayOrders.reduce((s:number,o:any) => s+o.amount, 0)}</Text>
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
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              background: '#f6ffed',
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <Text>
              总流水：
              <Text strong>¥{(overviewData?.totalRevenue ?? 0).toFixed(2)}</Text>
            </Text>
            <br />
            <Text>
              已支取：
              <Text strong>¥{(overviewData?.totalWithdrawn ?? 0).toFixed(2)}</Text>
            </Text>
            <br />
            <Text>
              可支取余额：
              <Text strong style={{ color: '#faad14', fontSize: 18 }}>
                ¥{(overviewData?.withdrawable ?? 0).toFixed(2)}
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
            max={overviewData?.withdrawable ?? 0}
            value={withdrawAmount}
            onChange={(v) => setWithdrawAmount(v ?? 0)}
            placeholder="请输入支取金额"
            addonAfter="元"
          />
        </div>
      </Modal>
    </div>
  );
};

export default BillingOverview;
