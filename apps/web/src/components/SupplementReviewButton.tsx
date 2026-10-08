// craftsman-ignore: TS001,TS002
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Modal, Segmented, Space, Table, Tag, Typography} from 'antd';
import { message } from '../utils/feedback';
import { ordersApi } from '../api/orders';
import { extractErrorMessage } from '../utils/error-handler';
import { ordersPathWithOrder } from '../utils/chatOrder';
import { isRowClickIgnored } from '../utils/rowClick';
import { useAuthStore } from '../stores/authStore';

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
  const role = useAuthStore((s) => s.user?.role);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'pending' | 'due' | 'records'>('pending');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<{ pending: number; due: number; approvedToday: number }>({
    pending: 0,
    due: 0,
    approvedToday: 0,
  });

  /**
   * 老板 2026-10-08：「第一张图这个界面，给我直接跳转到订单管理的该订单，方便客服查看」。
   * 点订单（或整行）就跳到订单管理里那一单：整行高亮 + 自动打开详情
   * （这一条是**明确要详情**的入口，所以多带 `detail=1`；聊天框顶上那个「查看订单」不带，
   * 2026-10-09 起那边只标阴影、不弹窗）。
   * 先把审核弹窗关掉，免得它盖在订单详情上面。
   */
  const gotoOrder = (r: any) => {
    const id = r?.order?.id || r?.orderId;
    if (!id) return;
    setOpen(false);
    navigate(ordersPathWithOrder(role, id, { detail: true }));
  };

  const loadSummary = useCallback(async () => {
    try {
      const { data } = await ordersApi.supplementSummary();
      setSummary({
        pending: data?.data?.pending ?? 0,
        due: data?.data?.due ?? 0,
        approvedToday: data?.data?.approvedToday ?? 0,
      });
    } catch {
      /* 拿不到就先不显示角标，别打扰用户 */
    }
  }, []);

  const loadRows = useCallback(async (scope: 'pending' | 'due' | 'records') => {
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

  // 陪玩一提交补单申请，服务端会推 order:supplement_request、AppLayout 收到后发这个事件：
  // 红点（以及正开着的列表）立刻刷新，不用干等下面那 60 秒轮询（老板 2026-10-04：双方都要有提示）。
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (open) void loadRows(tab);
  }, [open, tab, loadRows, refreshTick]);

  useEffect(() => {
    const onRefresh = () => {
      void loadSummary();
      setRefreshTick((v) => v + 1);
    };
    window.addEventListener('supplement:refresh', onRefresh as EventListener);
    return () => window.removeEventListener('supplement:refresh', onRefresh as EventListener);
  }, [loadSummary]);

  // 老板 2026-10-05：订单管理页顶头的提醒横幅点「🧾 去补单审核」直接把它打开，
  // 不用再自己在右上角找那个按钮。
  useEffect(() => {
    const onOpen = () => {
      setTab('pending');
      setOpen(true);
      void loadSummary();
    };
    window.addEventListener('supplement:open', onOpen as EventListener);
    return () => window.removeEventListener('supplement:open', onOpen as EventListener);
  }, [loadSummary]);

  const decide = async (row: any, decision: 'APPROVE' | 'REJECT' | 'CS_PASS') => {
    try {
      await ordersApi.decideSupplement(row.id, decision);
      const isRefund = row.type === 'REFUND';
      message.success(
        decision === 'CS_PASS'
          ? '已核对无异议，这条退单已转到店长那里拍板'
          : decision === 'APPROVE'
            ? isRefund
              ? `已同意退单：${row.companionName || '该陪玩'} 这张单已退掉（不计利润与提成），抢单次数 +1`
              : `已同意补单：${row.companionName || '该陪玩'} 的抢单次数 +1`
            : isRefund
              ? '已驳回这条退单申请，这张单照旧'
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
      const { data } = await ordersApi.reviewSupplement(row.id, result);
      // 老板 2026-10-04 简化：第一次「仍未通过」→ 7 天后再提醒一次；第二次才结案。
      const closed = data?.data?.reviewStatus === 'CLOSED';
      message.success(
        result === 'ACCEPTED'
          ? '已记「客户后来通过了」，这张单自动改成「已添加」'
          : closed
            ? '已记「仍未通过」，这条核查结案，不会再提醒'
            : '已记「仍未通过」，7 天后再提醒你来核查一次',
      );
      await loadRows(tab);
      await loadSummary();
    } catch (e) {
      message.error(extractErrorMessage(e, '操作失败'));
    }
  };

  const total = summary.pending + summary.due;

  const reviewColumns: any[] = [
    {
      title: '陪玩',
      dataIndex: 'companionName',
      width: 110,
      render: (v: string) => <Text strong>{v || '—'}</Text>,
    },
    {
      title: '订单（点一下跳到订单管理）',
      width: 200,
      render: (_: any, r: any) => (
        <Space direction="vertical" size={0}>
          <a onClick={() => gotoOrder(r)} style={{ fontSize: 12 }}>
            {r.order?.orderCode || r.orderId}
          </a>
          <Space size={4}>
            {r.type === 'REFUND' && (
              <Tag color="red" style={{ margin: 0 }}>
                退单
              </Tag>
            )}
            <Text type="secondary" style={{ fontSize: 11 }}>
              {r.order?.gameName || ''} {r.order?.contactStatus === 'not_accepted' ? '· 未添加' : r.order?.contactStatus === 'added' ? '· 已添加' : ''}
            </Text>
          </Space>
        </Space>
      ),
    },
    {
      title: '客户微信',
      width: 150,
      render: (_: any, r: any) => <Text style={{ fontSize: 12 }}>{r.order?.customerWechat || '—'}</Text>,
    },
    {
      title: '原因（陪玩填的）',
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
          r.type === 'REFUND' ? (
            <Tag color="warning">{r.csReviewedAt ? '待店长拍板' : '待客服核对'}</Tag>
          ) : (
            <Tag color="warning">{STATUS_LABEL[r.status] || r.status}</Tag>
          )
        ) : r.type === 'REFUND' ? (
          <Tag color="red">已同意退单</Tag>
        ) : (
          <Tag color="processing">已同意 · 待核查</Tag>
        ),
    },
    {
      title: '操作',
      width: 190,
      render: (_: any, r: any) =>
        tab === 'pending' ? (
          // 「退单」是两段式（老板 2026-10-08：「客服端审核 无异议到店长这里」）：
          // 客服只能「无异议，转店长」或「驳回」；真正拍板（同意退单 = 这单退掉 + 名额 +1）是店长 / 老板。
          r.type === 'REFUND' ? (
            role === 'CS' ? (
              <Space>
                <Button size="small" type="primary" onClick={() => decide(r, 'CS_PASS')}>
                  无异议，转店长
                </Button>
                <Button size="small" danger onClick={() => decide(r, 'REJECT')}>
                  驳回
                </Button>
              </Space>
            ) : (
              <Space>
                <Button size="small" type="primary" danger onClick={() => decide(r, 'APPROVE')}>
                  同意退单
                </Button>
                <Button size="small" danger onClick={() => decide(r, 'REJECT')}>
                  驳回
                </Button>
              </Space>
            )
          ) : (
            <Space>
              <Button size="small" type="primary" onClick={() => decide(r, 'APPROVE')}>
                同意补单
              </Button>
              <Button size="small" danger onClick={() => decide(r, 'REJECT')}>
                驳回
              </Button>
            </Space>
          )
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

  /** 「补单记录」页签：谁、给哪张单、谁批的、什么时候 —— 老板要的「今天到底发生了什么」。 */
  const recordsColumns: any[] = [
    {
      title: '陪玩',
      dataIndex: 'companionName',
      width: 110,
      render: (v: string) => <Text strong>{v || '—'}</Text>,
    },
    {
      title: '订单（点一下跳到订单管理）',
      width: 200,
      render: (_: any, r: any) => (
        <a onClick={() => gotoOrder(r)} style={{ fontSize: 12 }}>
          {r.order?.orderCode || r.orderId}
        </a>
      ),
    },
    {
      title: '来源',
      width: 110,
      render: (_: any, r: any) =>
        r.type === 'REFUND' ? (
          <Tag color="red">退单</Tag>
        ) : r.byAdmin ? (
          <Tag color="processing">管理端补单</Tag>
        ) : (
          <Tag>陪玩申请</Tag>
        ),
    },
    {
      title: '原因',
      width: 200,
      render: (_: any, r: any) => (
        <Text style={{ fontSize: 12 }}>
          {r.decisionNote || String(r.reason || '').replace('【管理端补单】', '') || '—'}
        </Text>
      ),
    },
    {
      title: '处理人',
      width: 100,
      render: (_: any, r: any) => <Text style={{ fontSize: 12 }}>{r.decidedByName || '—'}</Text>,
    },
    {
      title: '补单时间',
      width: 150,
      render: (_: any, r: any) => (
        <Text style={{ fontSize: 12 }}>
          {r.decidedAt ? new Date(r.decidedAt).toLocaleString('zh-CN') : '—'}
        </Text>
      ),
    },
  ];

  const columns: any[] = tab === 'records' ? recordsColumns : reviewColumns;

  return (
    <>
      <Badge count={total} size="small" offset={[-2, 2]}>
        <Button onClick={() => setOpen(true)}>🧾 补单审核</Button>
      </Badge>
      <Modal
        open={open}
        title="🧾 补单 / 退单审核"
        footer={null}
        width={980}
        onCancel={() => setOpen(false)}
      >
        <div style={{ marginBottom: 10 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            陪玩点「添加失败」就会在这里生成一条待审；同意 = 他的抢单次数 +1。
            同意后 **24 小时**提醒你来核查「客户后来到底通过了没有」——通过就点一下，系统自动改成「已添加」。
            点「仍未通过」→ **再等 7 天**提醒你一次；第二次再点「仍未通过」就结案，不再提醒
            （客户哪天真通过了，去「客户管理」把他捞回来就行）。
            <br />
            <Text strong>退单</Text>（老板 2026-10-08）：「客户同意了但是没打成」（客户没转钱 / 转钱了最后不打）
            也走这个入口 —— <Text strong>客服先核对，无异议转到店长拍板</Text>（客服那一格是「无异议，转店长」），
            钱的事只有店长 / 老板能拍板；店长同意 = 这张单退掉（按退款处理，不计利润与提成）+ 陪玩抢单次数 +1。
            **退单没有上面那段「24 小时核查」**：同意就结束。
            <br />
            点订单（或整行）直接跳到订单管理里那一单；「补单记录」里能看到今天给谁补过名额、是谁批的。
          </Text>
        </div>
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as 'pending' | 'due' | 'records')}
          options={[
            { label: `待审核（${summary.pending}）`, value: 'pending' },
            { label: `到期核查（${summary.due}）`, value: 'due' },
            { label: `补单记录（今日 ${summary.approvedToday}）`, value: 'records' },
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
          onRow={(r: any) => ({
            onClick: (e: any) => {
              if (!isRowClickIgnored(e)) gotoOrder(r);
            },
            style: { cursor: 'pointer' },
          })}
          locale={{
            emptyText:
              tab === 'pending'
                ? '没有待审核的补单申请'
                : tab === 'due'
                  ? '没有到期要核查的客户'
                  : '今天还没有补单记录',
          }}
          scroll={{ x: 900 }}
        />
      </Modal>
    </>
  );
};

export default SupplementReviewButton;