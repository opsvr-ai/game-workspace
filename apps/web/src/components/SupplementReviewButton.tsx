// craftsman-ignore: TS001,TS002
import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Modal, Segmented, Space, Table, Tag, Typography, message } from 'antd';
import { ordersApi } from '../api/orders';
import { extractErrorMessage } from '../utils/error-handler';

const { Text } = Typography;

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待审核',
  APPROVED: '已同意',
  REJECTED: '已驳回',
};

const REASON_LABEL: Record<string, string> = {
  not_added: '加好友没同意',
  too_expensive: '嫌贵',
  voice_changer: '变声器',
  busy_now: '现在不打',
  audition: '要试音',
  other: '其他',
};

/**
 * 补单审核 + 到期核查（老板 2026-10-04）。
 *
 * 陪玩点「添加失败」→ 管理端这里出现一条待审；同意 = 他的抢单次数 +1，
 * 并排一次「这个客户后来到底通过了没有」的核查 —— 客户不能浪费。
 */
const SupplementReviewButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'pending' | 'due'>('pending');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<{ pending: number; due: number }>({ pending: 0, due: 0 });

  const loadSummary = useCallback(async () => {
    try {
      const { data } = await ordersApi.supplementSummary();
      setSummary({ pending: data?.data?.pending ?? 0, due: data?.data?.due ?? 0 });
    } catch {
      /* 拿不到就先不显示角标，别打扰用户 */
    }
  }, []);

  const loadRows = useCallback(async (scope: 'pending' | 'due') => {
    setLoading(true);
    try {
      const { data } = await ordersApi.listSupplements(scope);
      setRows(Array.isArray(data?.data) ? data.data : []);
    } catch (e) {
      message.error(extractErrorMessage(e, '加载补单申请失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
    const t = setInterval(() => void loadSummary(), 60 * 1000);
    return () => clearInterval(t);
  }, [loadSummary]);

  useEffect(() => {
    if (open) void loadRows(tab);
  }, [open, tab, loadRows]);

  const decide = async (row: any, decision: 'APPROVE' | 'REJECT') => {
    try {
      await ordersApi.decideSupplement(row.id, decision);
      message.success(
        decision === 'APPROVE'
          ? `已同意补单：${row.companionName || '该陪玩'} 的抢单次数 +1`
          : '已驳回这条补单申请',
      );
      await loadRows(tab);
      await loadSummary();
    } catch (e) {
      message.error(extractErrorMessage(e, '操作失败'));
    }
  };

  const review = async (row: any, result: 'ACCEPTED' | 'STILL_NOT') => {
    try {
      await ordersApi.reviewSupplement(row.id, result);
      message.success(
        result === 'ACCEPTED'
          ? '已记「客户后来通过了」，这张单自动改成「已添加」'
          : '已记「仍未通过」，3 天后再提醒你核查',
      );
      await loadRows(tab);
      await loadSummary();
    } catch (e) {
      message.error(extractErrorMessage(e, '操作失败'));
    }
  };

  const total = summary.pending + summary.due;

  const columns: any[] = [
    {
      title: '陪玩',
      dataIndex: 'companionName',
      width: 110,
      render: (v: string) => <Text strong>{v || '—'}</Text>,
    },
    {
      title: '订单',
      width: 190,
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <Text style={{ fontSize: 12 }}>{r.order?.orderCode || r.orderId}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {r.order?.gameName || ''} {r.order?.contactStatus === 'not_accepted' ? '· 未添加' : r.order?.contactStatus === 'added' ? '· 已添加' : ''}
          </Text>
        </Space>
      ),
    },
    {
      title: '客户微信',
      width: 150,
      render: (_: any, r: any) => <Text style={{ fontSize: 12 }}>{r.order?.customerWechat || '—'}</Text>,
    },
    {
      title: '陪玩填的原因',
      width: 140,
      render: (_: any, r: any) => (
        <Text style={{ fontSize: 12 }}>{REASON_LABEL[r.reason] || r.reason || '—'}</Text>
      ),
    },
    {
      title: '失败截图',
      width: 90,
      render: (_: any, r: any) =>
        r.evidenceUrl ? (
          <a href={r.evidenceUrl} target="_blank" rel="noreferrer">
            查看截图
          </a>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>无</Text>
        ),
    },
    {
      title: '状态',
      width: 110,
      render: (_: any, r: any) =>
        tab === 'pending' ? (
          <Tag color="warning">{STATUS_LABEL[r.status] || r.status}</Tag>
        ) : (
          <Tag color="processing">已同意 · 待核查</Tag>
        ),
    },
    {
      title: '操作',
      width: 190,
      render: (_: any, r: any) =>
        tab === 'pending' ? (
          <Space>
            <Button size="small" type="primary" onClick={() => decide(r, 'APPROVE')}>
              同意补单
            </Button>
            <Button size="small" danger onClick={() => decide(r, 'REJECT')}>
              驳回
            </Button>
          </Space>
        ) : (
          <Space>
            <Button size="small" type="primary" onClick={() => review(r, 'ACCEPTED')}>
              客户后来通过了
            </Button>
            <Button size="small" onClick={() => review(r, 'STILL_NOT')}>
              仍未通过
            </Button>
          </Space>
        ),
    },
  ];

  return (
    <>
      <Badge count={total} size="small" offset={[-2, 2]}>
        <Button onClick={() => setOpen(true)}>🧾 补单审核</Button>
      </Badge>
      <Modal
        open={open}
        title="🧾 补单审核 / 到期核查"
        footer={null}
        width={980}
        onCancel={() => setOpen(false)}
      >
        <div style={{ marginBottom: 10 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            陪玩点「添加失败」就会在这里生成一条待审；同意 = 他的抢单次数 +1。
            同意后 24 小时会提醒你来这里核查「客户后来到底通过了没有」——通过就点一下，系统自动改成「已添加」。
          </Text>
        </div>
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as 'pending' | 'due')}
          options={[
            { label: `待审核（${summary.pending}）`, value: 'pending' },
            { label: `到期核查（${summary.due}）`, value: 'due' },
          ]}
          style={{ marginBottom: 10 }}
        />
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          locale={{ emptyText: tab === 'pending' ? '没有待审核的补单申请' : '没有到期要核查的客户' }}
          scroll={{ x: 900 }}
        />
      </Modal>
    </>
  );
};

export default SupplementReviewButton;