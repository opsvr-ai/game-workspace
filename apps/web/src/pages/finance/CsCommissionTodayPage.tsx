// craftsman-ignore: TS001,TS002,TS003
import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Space,
  Typography,
  message,
  Table,
  Tag,
  Statistic,
  Row,
  Col,
  Drawer,
  Tooltip,
} from 'antd';
import { ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { financeApi } from '../../api/finance';
import { useAuthStore } from '../../stores/authStore';
import PageHeader from '../../components/PageHeader';
import OrderOutcomeModal from '../../components/OrderOutcome';
import { orderTypeConfig } from '../../constants/orders';

const { Text } = Typography;

/**
 * 客服提成 · 今日看板（老板 2026-09-29 重做）。
 *
 * 老板原话：「并不是订单派出去了，被抢走了就计算了……线上不好判定，需要接单者给我反馈，
 * 比如派给桥接俱乐部一个订单，对方对陪玩不满意，那么这单就不成功。」
 * 所以这一页的单数 / 提成只认**成功单**：
 *  - 本店线下单：陪玩点「开始首单」系统就判成功，不用反馈；
 *  - 桥接 / 线上单：等接单方反馈「成功」才算，没反馈就是「待反馈」，先不计提成；
 *  - 不成功要选原因（原因在「选项字典 → 反馈不成功的原因」里能改），原因排行在点开的明细里。
 *
 * 一屏看清每人：发单 / 派出 / 线下·桥接·线上各几单 / 成功·不成功·待反馈 / 成功率 /
 * 应发提成 / 罚后提成 / 底薪日发 / 今日应发 / 当月累计。老板、店长、客服都看得见。
 */

/** 入池方式（老板 2026-09-29）：线下+线上流转入池 / 线上入池。 */
const POOL_SCOPE: Record<string, { label: string; color: string }> = {
  OFFLINE_FIRST: { label: '线下+线上流转', color: 'blue' },
  ONLINE_FIRST: { label: '线上入池', color: 'purple' },
};

const CHANNEL: Record<string, { label: string; color: string }> = {
  offline: { label: '线下', color: 'green' },
  bridge: { label: '桥接', color: 'purple' },
  online: { label: '线上', color: 'geekblue' },
};

const STATE: Record<string, { label: string; color: string }> = {
  SUCCESS: { label: '成功', color: '#15803D' },
  FAILED: { label: '不成功', color: '#DC2626' },
  PENDING: { label: '待反馈', color: '#B45309' },
  NONE: { label: '未开始', color: '#94A3B8' },
};

const yuan = (v: any, digits = 1) => `¥${Number(v || 0).toFixed(digits)}`;

const CsCommissionTodayPage: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  // 点开某一行：这个客服今天发出的单 + 每张单的结果
  const [drill, setDrill] = useState<any>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [outcomeTarget, setOutcomeTarget] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await financeApi.commission.today();
      setData((res as any)?.data || null);
    } catch (err: any) {
      message.error(err?.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 客服只能点开自己那一行（后端也只返回自己的明细）；店长 / 老板点谁都行
  const isCs = user?.role === 'CS';
  const canOpenRow = (row: any) => !isCs || row.userId === user?.id;

  const openRow = async (row: any) => {
    if (!canOpenRow(row)) return;
    setDrill({ row, orders: null });
    setDrillLoading(true);
    try {
      const { data: res } = await financeApi.commission.csTodayOrders(row.userId);
      setDrill({ row, orders: (res as any)?.data || [] });
    } catch (err: any) {
      message.error(err?.response?.data?.message || '加载明细失败');
      setDrill({ row, orders: [] });
    } finally {
      setDrillLoading(false);
    }
  };

  const s = data?.summary || null;
  const csList: any[] = data?.csList || [];
  const todayPayTotal = csList.reduce((sum, r) => sum + Number(r.todayPay || 0), 0);
  const failReasons: Array<[string, number]> = Object.entries(s?.failReasons || {}).sort(
    (a: any, b: any) => b[1] - a[1],
  ) as Array<[string, number]>;

  const summaryCards = [
    { title: '今日发单', value: s?.published ?? 0, suffix: '单', hint: '客服今天建了多少单' },
    { title: '派出去了', value: s?.dispatched ?? 0, suffix: '单', hint: '有人接、进了单量统计的' },
    { title: '成功', value: s?.success ?? 0, suffix: '单', hint: '线下开始首单 / 桥接线上反馈成功' },
    { title: '不成功', value: s?.failed ?? 0, suffix: '单', hint: '接单方反馈不成功，不计提成' },
    { title: '待反馈', value: s?.pending ?? 0, suffix: '单', hint: '桥接 / 线上还没反馈结果' },
    {
      title: '成功率',
      value: s?.successRate ?? 0,
      suffix: '%',
      hint: '成功 ÷（成功 + 不成功），待反馈的不算分母',
    },
  ];

  const columns: any[] = [
    {
      title: '客服',
      dataIndex: 'displayName',
      fixed: 'left' as const,
      width: 128,
      render: (v: string, r: any) => (
        <div>
          <Text strong>{v || r.username || '-'}</Text>
          <div style={{ marginTop: 2 }}>
            <Tag style={{ marginInlineEnd: 0 }} color={POOL_SCOPE[r.poolScope]?.color || 'default'}>
              {POOL_SCOPE[r.poolScope]?.label || '先本店线下'}
            </Tag>
          </div>
        </div>
      ),
    },
    { title: '发单', dataIndex: 'published', width: 62, render: (v: number) => <Text strong>{v ?? 0}</Text> },
    { title: '派出', dataIndex: 'dispatched', width: 62, render: (v: number) => <Text strong>{v ?? 0}</Text> },
    {
      title: '线下',
      width: 92,
      render: (_: unknown, r: any) => (
        <div>
          <Text strong>{r.offlineOrders ?? 0} 单</Text>
          <div style={{ fontSize: 11, color: '#94A3B8' }}>流水 {yuan(r.offlineFlow)}</div>
          <div style={{ fontSize: 11, color: '#cf1322' }}>提成 {yuan(r.offlineCommission)}</div>
        </div>
      ),
    },
    {
      title: '桥接 / 目标',
      width: 110,
      render: (_: unknown, r: any) => (
        <div>
          <Text type={r.bridgeMet ? 'success' : 'danger'} strong>
            {r.bridgeOrders ?? 0} / {r.bridgeTarget ?? 0}
          </Text>
          <div style={{ marginTop: 2 }}>
            {r.bridgeMet ? <Tag color="green">达标</Tag> : <Tag color="red">未达标</Tag>}
          </div>
          <div style={{ fontSize: 11, color: '#cf1322' }}>提成 {yuan(r.bridgeCommission)}</div>
        </div>
      ),
    },
    {
      title: '线上',
      width: 92,
      render: (_: unknown, r: any) => (
        <div>
          <Text strong>{r.onlineOrders ?? 0} 单</Text>
          <div style={{ fontSize: 11, color: '#cf1322' }}>提成 {yuan(r.onlineCommission)}</div>
        </div>
      ),
    },
    {
      title: '成功 / 不成功 / 待反馈',
      width: 132,
      render: (_: unknown, r: any) => (
        <div>
          <span style={{ color: STATE.SUCCESS.color, fontWeight: 600 }}>{r.success ?? 0}</span>
          <span style={{ color: '#cbd5e1' }}> / </span>
          <span style={{ color: STATE.FAILED.color, fontWeight: 600 }}>{r.failed ?? 0}</span>
          <span style={{ color: '#cbd5e1' }}> / </span>
          <span style={{ color: STATE.PENDING.color, fontWeight: 600 }}>{r.pending ?? 0}</span>
        </div>
      ),
    },
    {
      title: '成功率',
      dataIndex: 'successRate',
      width: 74,
      render: (v: number | null) => (v == null ? <Text type="secondary">-</Text> : `${v.toFixed(0)}%`),
    },
    {
      title: '应发提成',
      dataIndex: 'totalCommission',
      width: 84,
      render: (v: number) => yuan(v),
    },
    {
      title: '罚后提成',
      dataIndex: 'commissionAfter',
      width: 84,
      render: (v: number, r: any) => (
        <Text strong style={{ color: r.bridgeMet ? '#cf1322' : '#fa541c' }}>
          {yuan(v)}
        </Text>
      ),
    },
    {
      title: '底薪(日)',
      dataIndex: 'salaryDaily',
      width: 82,
      render: (v: number, r: any) => (
        <Tooltip title={`月薪 ${yuan(r.baseSalaryYuan)} ÷ 出勤天数 ${data?.config?.fullAttendance ?? '-'}`}>
          <span>{yuan(v)}</span>
        </Tooltip>
      ),
    },
    {
      title: '今日应发',
      dataIndex: 'todayPay',
      width: 88,
      render: (v: number) => (
        <Text strong style={{ color: '#cf1322', fontSize: 15 }}>
          {yuan(v)}
        </Text>
      ),
    },
    {
      title: '当月累计',
      dataIndex: 'monthTotalYuan',
      width: 88,
      render: (v: number) => <Text type="secondary">{yuan(v)}</Text>,
    },
    {
      title: '明细',
      width: 66,
      fixed: 'right' as const,
      render: (_: unknown, r: any) =>
        canOpenRow(r) ? (
          <Button size="small" type="link" style={{ padding: 0 }} onClick={() => openRow(r)}>
            看单子
          </Button>
        ) : (
          <Tooltip title="客服只能看自己的明细">
            <Text type="secondary" style={{ fontSize: 12 }}>
              -
            </Text>
          </Tooltip>
        ),
    },
  ];

  const drillOrders: any[] = drill?.orders || [];

  return (
    <div>
      <PageHeader
        title="客服提成 · 今日看板"
        subtitle={`今日（营业日 ${data?.date || dayjs().format('YYYY-MM-DD')}，12:00 起算）。只认成功单：线下陪玩点「开始首单」即成功，桥接 / 线上要接单方反馈成功才算。`}
        extra={
          <Space>
            {(user?.role === 'OWNER' || user?.role === 'ADMIN') && (
              <Button icon={<SettingOutlined />} onClick={() => navigate('/admin/cs-settings')}>
                去设置
              </Button>
            )}
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        {summaryCards.map((c) => (
          <Col xs={12} sm={8} md={4} key={c.title}>
            <Tooltip title={c.hint}>
              <Card size="small">
                <Statistic
                  title={c.title}
                  value={c.value}
                  suffix={c.suffix}
                  valueStyle={c.title === '不成功' ? { color: '#cf1322' } : undefined}
                />
              </Card>
            </Tooltip>
          </Col>
        ))}
      </Row>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Text type="secondary">线下（本店陪玩）</Text>
            <div>
              <Text strong style={{ fontSize: 20 }}>
                {s?.offlineOrders ?? 0}
              </Text>{' '}
              <Text type="secondary">单</Text>
            </div>
            <Text style={{ color: '#cf1322', fontSize: 12 }}>
              流水 {yuan(s?.offlineFlow)} · 提成 {yuan(s?.offlineCommission)}
            </Text>
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Text type="secondary">桥接（别家工作室）</Text>
            <div>
              <Text strong style={{ fontSize: 20 }}>
                {s?.bridgeOrders ?? 0}
              </Text>{' '}
              <Text type="secondary">单</Text>
            </div>
            <Text style={{ color: '#cf1322', fontSize: 12 }}>提成 {yuan(s?.bridgeCommission)}</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Text type="secondary">线上（租赁俱乐部）</Text>
            <div>
              <Text strong style={{ fontSize: 20 }}>
                {s?.onlineOrders ?? 0}
              </Text>{' '}
              <Text type="secondary">单</Text>
            </div>
            <Text style={{ color: '#cf1322', fontSize: 12 }}>提成 {yuan(s?.onlineCommission)}</Text>
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Text type="secondary">桥接达标</Text>
            <div>
              <Text
                strong
                style={{
                  fontSize: 20,
                  color:
                    (s?.bridgeMetCount ?? 0) === (s?.csCount ?? 0) && (s?.csCount ?? 0) > 0
                      ? '#52c41a'
                      : '#cf1322',
                }}
              >
                {s?.bridgeMetCount ?? 0}
              </Text>{' '}
              <Text type="secondary">/ {s?.csCount ?? 0} 人</Text>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              目标：每人 {s?.bridgeTarget ?? 10} 单/日（未达标提成 {data?.config?.missCommissionRate ?? 50}%、底薪{' '}
              {data?.config?.missSalaryRate ?? 80}%）
            </Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={8}>
          <Card size="small">
            <Statistic title="今日应发合计（全体客服）" value={todayPayTotal} precision={1} prefix="¥" valueStyle={{ color: '#cf1322' }} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              = 底薪按天折算 + 罚后提成；桥接没达标会按比例下调
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={16}>
          <Card size="small" title="不成功的原因（今天）">
            {failReasons.length === 0 ? (
              <Text type="secondary">今天还没有「不成功」的单</Text>
            ) : (
              <Space size={[6, 6]} wrap>
                {failReasons.map(([reason, count]) => (
                  <Tag key={reason} color="red">
                    {reason} × {count}
                  </Tag>
                ))}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" title={`客服明细（${csList.length}人）`}>
        <Table
          rowKey="userId"
          size="small"
          loading={loading}
          pagination={false}
          dataSource={csList}
          locale={{ emptyText: '今日暂无客服提成数据' }}
          scroll={{ x: 1240 }}
          onRow={(r: any) => ({
            onClick: () => openRow(r),
            style: { cursor: canOpenRow(r) ? 'pointer' : 'default' },
          })}
          columns={columns}
        />
      </Card>

      <Drawer
        open={!!drill}
        onClose={() => setDrill(null)}
        width={720}
        title={drill ? `${drill.row?.displayName || drill.row?.username || '客服'} 今天发出的单` : ''}
      >
        {drill?.row && (
          <Space size={[6, 6]} wrap style={{ marginBottom: 12 }}>
            <Tag color="blue">发单 {drill.row.published ?? 0}</Tag>
            <Tag color="green">成功 {drill.row.success ?? 0}</Tag>
            <Tag color="red">不成功 {drill.row.failed ?? 0}</Tag>
            <Tag color="orange">待反馈 {drill.row.pending ?? 0}</Tag>
            <Tag color="purple">今日应发 {yuan(drill.row.todayPay)}</Tag>
          </Space>
        )}
        <Table
          rowKey="orderId"
          size="small"
          loading={drillLoading}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          dataSource={drillOrders}
          locale={{ emptyText: '今天还没有发出去的单' }}
          scroll={{ x: 640 }}
          columns={[
            {
              title: '订单',
              dataIndex: 'orderCode',
              width: 96,
              render: (v: string, r: any) => (
                <div>
                  <Text strong>{v || r.orderId?.slice(0, 8)}</Text>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>
                    {orderTypeConfig[r.type]?.label || r.type || '首单'}
                  </div>
                </div>
              ),
            },
            {
              title: '渠道',
              dataIndex: 'channel',
              width: 108,
              render: (v: string, r: any) => (
                <div>
                  <Tag color={CHANNEL[v]?.color || 'default'} style={{ marginInlineEnd: 0 }}>
                    {CHANNEL[v]?.label || v}
                  </Tag>
                  {r.units === 2 && (
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>主+副 2 份</div>
                  )}
                </div>
              ),
            },
            {
              title: '客户 / 陪玩',
              width: 190,
              render: (_: unknown, r: any) => (
                <div>
                  <div>
                    <Text>{r.customerCode || r.customerWechat || '—'}</Text>
                  </div>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>
                    {r.companionName || '还没人接'}
                    {r.companionStudio ? ` · ${r.companionStudio}` : ''}
                  </div>
                </div>
              ),
            },
            { title: '金额', dataIndex: 'amount', width: 74, render: (v: number) => yuan(v, 0) },
            {
              title: '结果',
              width: 132,
              render: (_: unknown, r: any) => {
                const st = STATE[r.state] || STATE.NONE;
                return (
                  <div>
                    <Text strong style={{ color: st.color }}>
                      {st.label}
                    </Text>
                    {r.state === 'FAILED' && r.outcomeReason && (
                      <div style={{ fontSize: 11, color: '#DC2626' }}>{r.outcomeReason}</div>
                    )}
                    {r.refundedAt && <div style={{ fontSize: 11, color: '#94A3B8' }}>已退款</div>}
                  </div>
                );
              },
            },
            {
              title: '操作',
              width: 82,
              fixed: 'right' as const,
              render: (_: unknown, r: any) =>
                r.channel !== 'offline' ? (
                  <Button size="small" onClick={() => setOutcomeTarget(r)}>
                    记结果
                  </Button>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    线下自动判
                  </Text>
                ),
            },
          ]}
        />
      </Drawer>

      <OrderOutcomeModal
        open={!!outcomeTarget}
        order={outcomeTarget ? { ...outcomeTarget, id: outcomeTarget.orderId } : {}}
        channel={outcomeTarget?.channel}
        onClose={() => setOutcomeTarget(null)}
        onSaved={() => {
          load();
          if (drill?.row) openRow(drill.row);
        }}
      />
    </div>
  );
};

export default CsCommissionTodayPage;
