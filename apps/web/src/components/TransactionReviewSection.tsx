import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  Typography,
  Image,
  Modal,
  InputNumber,
  Input,
  message,
  Popconfirm,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  EditOutlined,
  ReloadOutlined,
  EyeOutlined,
} from '@ant-design/icons';
import { billingApi } from '../api/billing';
import { useAuthStore } from '../stores/authStore';
import { UserRole } from '@chunlv/shared';

const { Text } = Typography;

const statusConfig: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'orange', label: '待审核' },
  APPROVED: { color: 'green', label: '已通过' },
  REJECTED: { color: 'red', label: '已驳回' },
  NEGOTIATING: { color: 'gold', label: '协商中' },
};

const typeConfig: Record<string, string> = {
  NEW: '首单',
  RENEW: '续单',
  REPURCHASE: '复购',
  TIP: '打赏',
};

const TransactionReviewSection: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isCompanion = user?.role === UserRole.COMPANION;
  const isManager =
    user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN || user?.role === UserRole.CS;

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<any>(null);
  const [adjustAmount, setAdjustAmount] = useState<number | undefined>(undefined);
  const [adjustNote, setAdjustNote] = useState('');
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await billingApi.list();
      setRows(data.data ?? []);
    } catch {
      message.error('加载报账审核失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
    const timer = setInterval(fetchList, 30_000);
    return () => clearInterval(timer);
  }, [fetchList]);

  const handleApprove = async (id: string) => {
    try {
      await billingApi.approve(id);
      message.success('已通过');
      fetchList();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '操作失败');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await billingApi.reject(id);
      message.success('已驳回');
      fetchList();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '操作失败');
    }
  };

  const openAdjust = (record: any) => {
    setAdjustTarget(record);
    setAdjustAmount(record.amount);
    setAdjustNote('');
  };

  const submitAdjust = async () => {
    if (!adjustTarget) return;
    if (adjustAmount == null || adjustAmount <= 0) {
      message.warning('请输入有效金额');
      return;
    }
    setAdjustSubmitting(true);
    try {
      await billingApi.propose(adjustTarget.id, {
        amount: adjustAmount,
        note: adjustNote || undefined,
      });
      message.success('已发起金额协商，等待陪玩确认');
      setAdjustTarget(null);
      setAdjustAmount(undefined);
      setAdjustNote('');
      fetchList();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '发起协商失败');
    } finally {
      setAdjustSubmitting(false);
    }
  };

  const handleAcceptProposal = async (id: string) => {
    try {
      await billingApi.acceptProposal(id);
      message.success('已确认调整金额');
      fetchList();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '确认失败');
    }
  };

  const handleRejectProposal = async (id: string) => {
    try {
      await billingApi.rejectProposal(id);
      message.success('已拒绝调整，金额恢复原值并退回待审核');
      fetchList();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '拒绝失败');
    }
  };

  const columns: any[] = [
    {
      title: '金额',
      dataIndex: 'amount',
      width: 100,
      render: (v: number) => <Text strong style={{ color: '#EF4444' }}>¥{v?.toFixed(1)}</Text>,
    },
    {
      title: '协商后',
      dataIndex: 'reviewAmount',
      width: 100,
      render: (v: number | null) => (v != null ? <Text type="warning">¥{v.toFixed(1)}</Text> : '-'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: string) => {
        const cfg = statusConfig[s] ?? { color: 'default', label: s };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: '陪玩',
      width: 90,
      render: (_: unknown, r: any) => r.companion?.user?.username || '-',
    },
    {
      title: '订单',
      width: 70,
      render: (_: unknown, r: any) => typeConfig[r.order?.type] || r.order?.type || '-',
    },
    {
      title: '支付方式',
      dataIndex: 'paymentMethod',
      width: 90,
      render: (v: string) => v || '-',
    },
    {
      title: '协商说明',
      dataIndex: 'reviewNote',
      width: 150,
      ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: '截图',
      dataIndex: 'screenshotUrl',
      width: 70,
      render: (v: string) =>
        v ? (
          <Button
            size="small"
            type="link"
            icon={<EyeOutlined />}
            onClick={() => setPreview(v)}
          />
        ) : (
          '-'
        ),
    },
    {
      title: '操作',
      width: 170,
      render: (_: unknown, r: any) => {
        if (isManager && r.status === 'PENDING') {
          return (
            <Space size="small">
              <Popconfirm title="确认通过？" onConfirm={() => handleApprove(r.id)} okText="通过" cancelText="取消">
                <Button size="small" type="primary" icon={<CheckOutlined />}>通过</Button>
              </Popconfirm>
              <Popconfirm title="确认驳回？" onConfirm={() => handleReject(r.id)} okText="驳回" cancelText="取消">
                <Button size="small" danger icon={<CloseOutlined />}>驳回</Button>
              </Popconfirm>
              <Button size="small" icon={<EditOutlined />} onClick={() => openAdjust(r)}>改价</Button>
            </Space>
          );
        }
        if (isCompanion && r.status === 'NEGOTIATING') {
          return (
            <Space size="small">
              <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => handleAcceptProposal(r.id)}>接受</Button>
              <Button size="small" danger icon={<CloseOutlined />} onClick={() => handleRejectProposal(r.id)}>拒绝</Button>
            </Space>
          );
        }
        if (r.status === 'NEGOTIATING' && isManager) {
          return <Text type="secondary">等待陪玩确认</Text>;
        }
        return <Text type="secondary">-</Text>;
      },
    },
  ];

  return (
    <Card
      title="订单报账审核"
      extra={<Button size="small" icon={<ReloadOutlined />} onClick={fetchList} loading={loading}>刷新</Button>}
      style={{ marginTop: 16 }}
    >
      <Table
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={loading}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
        locale={{ emptyText: '暂无报账记录' }}
      />

      <Modal
        title="发起金额协商"
        open={!!adjustTarget}
        onOk={submitAdjust}
        onCancel={() => setAdjustTarget(null)}
        confirmLoading={adjustSubmitting}
        okText="发起协商"
        cancelText="取消"
        destroyOnClose
      >
        <Text>原报账金额：</Text>
        <Text strong>¥{adjustTarget?.amount?.toFixed(1) ?? '0.00'}</Text>
        <div style={{ marginTop: 12 }}>
          <Text>调整为（元）：</Text>
          <InputNumber
            style={{ width: '100%', marginTop: 8 }}
            min={0}
            precision={1}
            value={adjustAmount}
            onChange={(v) => setAdjustAmount(v ?? undefined)}
            prefix="¥"
            placeholder="请输入调整后的最终金额"
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <Text>调整说明：</Text>
          <Input.TextArea
            rows={3}
            maxLength={200}
            value={adjustNote}
            onChange={(e) => setAdjustNote(e.target.value)}
            placeholder="如：截图实际到账 60 元，按 60 元审核"
          />
        </div>
      </Modal>

      <Modal open={!!preview} footer={null} onCancel={() => setPreview(null)} width={640}>
        {preview && <Image src={preview} style={{ width: '100%' }} />}
      </Modal>
    </Card>
  );
};

export default TransactionReviewSection;