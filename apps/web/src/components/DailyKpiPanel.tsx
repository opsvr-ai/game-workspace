// craftsman-ignore: TS001,TS002,TS003
/**
 * 每日数据（老板 2026-10-07）：
 *   「陪玩端 + 管理端清清楚楚的知道每天打了多少单，多少续了，续单率多少，
 *     多少复购了，复购率多少，以及客户的情况，一目了然的那种，而且能点开查看明细」
 *
 * 一个营业日一行（12:00 为界，跟运营看板 / 实时看板 / 客户看板同一条时间线），
 * 点任意一行 → 抽屉里看这一天的**每张单**和**每个客户**（当天 + 累计）。
 *
 * ⚠️ 续单率 / 复购率**全站只有一套「按客户」口径**（老板 2026-10-08：「续单率现在有两套算法……
 * 统一成一套」）：这里跟优秀度 / 陪玩 KPI 共用同一套判定 —— 同一个单里加打一段也算续单。
 *   · 续单客户 = 有第 2 段及以后打完的会话，或有一张完成的续单 / 复购单；
 *   · 复购客户 = 今天来打的这个客户，之前（更早的营业日）已经成交过；
 *   · 率 = 续单（复购）客户 ÷ 当天服务过、且在他这打过首单的客户数。
 *
 * 陪玩端（COMPANION）只能看自己（服务端强制），管理端看全店、可筛某一个陪玩。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Drawer,
  Empty,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { Link } from 'react-router-dom';
import http from '../api/client';
import StatCard from './StatCard';
import LoadingState from './LoadingState';
import { message } from '../utils/feedback';
import { businessDayKeyOf } from '../utils/businessDay';
import { BORDER, BRAND, SEMANTIC, TEXT } from '../styles/tokens';

const { Text } = Typography;

interface DailyRow {
  date: string;
  orders: number;
  partnerOrders: number;
  first: number;
  renew: number;
  repurchase: number;
  other: number;
  renewRate: number;
  repurchaseRate: number;
  customers: number;
  newCustomers: number;
  amount: number;
  hours: number;
}

interface DailyKpiData {
  scope: 'STORE' | 'COMPANION';
  dateFrom: string;
  dateTo: string;
  companionId: string | null;
  companionName: string | null;
  rows: DailyRow[];
  total: DailyRow;
  companions: Array<{ id: string; name: string; resigned: boolean }>;
}

interface DetailOrder {
  id: string;
  orderCode: string | null;
  type: string;
  gameName: string;
  amount: number;
  hours: number;
  customerId: string;
  customerCode: string;
  customerWechat: string;
  companionName: string | null;
  coCompanionName: string | null;
  csName: string | null;
  iAmPartner: boolean;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

interface DetailCustomer {
  customerId: string;
  customerCode: string;
  customerWechat: string;
  orders: number;
  hours: number;
  amount: number;
  totalOrders: number;
  totalHours: number;
  totalAmount: number;
  firstAt: string | null;
  lastAt: string | null;
  kinds: string[];
  /** 当天算成续单客户（跟 KPI 同一套判定，且进了分母） */
  renewed: boolean;
  /** 当天算成复购客户 */
  repurchased: boolean;
  /** 在当天的分母里（服务过 + 在他这打过首单）—— 只有 counted 的客户才参与当天两栏的率 */
  counted: boolean;
}

interface DetailData {
  date: string;
  scope: 'STORE' | 'COMPANION';
  orders: DetailOrder[];
  customers: DetailCustomer[];
}

const TYPE_META: Record<string, { label: string; color: string }> = {
  NEW: { label: '首单', color: 'blue' },
  RENEW: { label: '续单', color: 'green' },
  REPURCHASE: { label: '复购', color: 'purple' },
  TIP: { label: '打赏', color: 'gold' },
};

const yuan = (v: unknown) => `¥${(Number(v) || 0).toFixed(1)}`;
const pct = (v: unknown) => `${Math.round(Number(v) || 0)}%`;
const hours = (v: unknown) => {
  const n = Number(v) || 0;
  return n > 0 ? `${Math.round(n * 10) / 10} 小时` : '—';
};
const hhmm = (iso: string | null) => (iso ? dayjs(iso).format('HH:mm') : '—');
const ymd = (iso: string | null) => (iso ? dayjs(iso).format('YYYY-MM-DD') : '—');
/** 营业日显示成「10-07 周三」，一眼知道是哪天 */
const dayLabel = (key: string) => `${key.slice(5)} ${'日一二三四五六'[dayjs(key).day()]}`;

/** 表格里的类型标签 */
const TypeTag: React.FC<{ type: string }> = ({ type }) => {
  const meta = TYPE_META[type] || { label: type, color: 'default' };
  return (
    <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
      {meta.label}
    </Tag>
  );
};

const RANGE_OPTIONS = [
  { label: '今天', value: '1' },
  { label: '近 7 天', value: '7' },
  { label: '近 14 天', value: '14' },
  { label: '近 30 天', value: '30' },
  { label: '自定义', value: 'custom' },
];

export interface DailyKpiPanelProps {
  /** 管理端显示「筛陪玩」；陪玩端不用（服务端只会给他自己的数） */
  showCompanionFilter?: boolean;
  title?: string;
  style?: React.CSSProperties;
}

const DailyKpiPanel: React.FC<DailyKpiPanelProps> = ({
  showCompanionFilter = false,
  title = '每日数据（按营业日 12:00 为界）',
  style,
}) => {
  const todayKey = businessDayKeyOf();
  const [preset, setPreset] = useState('14');
  const [customRange, setCustomRange] = useState<[string, string] | null>(null);
  const [companionId, setCompanionId] = useState<string | undefined>(undefined);
  const [data, setData] = useState<DailyKpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailDate, setDetailDate] = useState<string | null>(null);
  const [detailKind, setDetailKind] = useState('ALL');
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /** 当前区间（营业日键） */
  const range = useMemo(() => {
    if (preset === 'custom' && customRange) return { dateFrom: customRange[0], dateTo: customRange[1] };
    const days = Number(preset) || 14;
    const to = todayKey;
    const from = dayjs(to).subtract(days - 1, 'day').format('YYYY-MM-DD');
    return { dateFrom: from, dateTo: to };
  }, [preset, customRange, todayKey]);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const res: any = await http.get('/stats/daily-kpi', {
          params: { dateFrom: range.dateFrom, dateTo: range.dateTo, companionId: companionId || undefined },
        });
        setData(res?.data?.data ?? null);
      } catch {
        if (!silent) message.error('每日数据没拉到，稍后重试');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [range.dateFrom, range.dateTo, companionId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(
    async (date: string, kind: string) => {
      setDetailLoading(true);
      try {
        const res: any = await http.get('/stats/daily-kpi/detail', {
          params: { date, companionId: companionId || undefined, kind: kind === 'ALL' ? undefined : kind },
        });
        setDetail(res?.data?.data ?? null);
      } catch {
        message.error('明细没拉到，稍后重试');
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [companionId],
  );

  const openDetail = (date: string, kind = 'ALL') => {
    setDetailDate(date);
    setDetailKind(kind);
    void loadDetail(date, kind);
  };

  const total = data?.total;

  // 10 列、固定宽度合计 670 —— 1024 宽窗口下不用横滚（守卫线是 760）
  const columns = useMemo(
    () => [
      {
        title: '营业日',
        dataIndex: 'date',
        width: 90,
        render: (v: string) => <Text strong>{dayLabel(v)}</Text>,
      },
      {
        title: '成交单',
        dataIndex: 'orders',
        width: 62,
        align: 'right' as const,
        render: (v: number, r: DailyRow) =>
          v ? (
            <Tooltip title={r.partnerOrders ? `其中当搭档打的 ${r.partnerOrders} 单` : '全部是自己主陪的单'}>
              <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</Text>
            </Tooltip>
          ) : (
            <Text type="secondary">0</Text>
          ),
      },
      { title: '首单', dataIndex: 'first', width: 56, align: 'right' as const },
      {
        title: (
          <Tooltip title="按客户去重：有多少个客户续了（同一个单里加打一段也算，跟陪玩 KPI 同一套算法）">
            <span>续单</span>
          </Tooltip>
        ),
        dataIndex: 'renew',
        width: 56,
        align: 'right' as const,
        render: (v: number) => (v ? <Text style={{ color: SEMANTIC.success, fontWeight: 600 }}>{v}</Text> : <Text type="secondary">0</Text>),
      },
      {
        title: (
          <Tooltip title="按客户去重：有多少个客户「隔了一个营业日又回来打」">
            <span>复购</span>
          </Tooltip>
        ),
        dataIndex: 'repurchase',
        width: 56,
        align: 'right' as const,
        render: (v: number) => (v ? <Text style={{ color: SEMANTIC.repurchase, fontWeight: 600 }}>{v}</Text> : <Text type="secondary">0</Text>),
      },
      {
        title: (
          <Tooltip title="续单客户 ÷ 当天服务过、且在他这打过首单的客户数（按客户，跟陪玩 KPI 同一套）">
            <span>续单率</span>
          </Tooltip>
        ),
        dataIndex: 'renewRate',
        width: 68,
        align: 'right' as const,
        render: (v: number) => <Text style={{ color: v >= 30 ? SEMANTIC.success : TEXT.secondary }}>{pct(v)}</Text>,
      },
      {
        title: (
          <Tooltip title="复购客户 ÷ 当天服务过、且在他这打过首单的客户数（按客户，跟陪玩 KPI 同一套）">
            <span>复购率</span>
          </Tooltip>
        ),
        dataIndex: 'repurchaseRate',
        width: 68,
        align: 'right' as const,
        render: (v: number) => <Text style={{ color: v >= 30 ? SEMANTIC.repurchase : TEXT.secondary }}>{pct(v)}</Text>,
      },
      { title: '服务客户', dataIndex: 'customers', width: 74, align: 'right' as const },
      { title: '新客', dataIndex: 'newCustomers', width: 56, align: 'right' as const },
      {
        title: '流水',
        dataIndex: 'amount',
        width: 84,
        align: 'right' as const,
        render: (v: number) => <Text strong>{yuan(v)}</Text>,
      },
    ],
    [],
  );

  const orderColumns = [
    {
      title: '单号',
      dataIndex: 'orderCode',
      width: 110,
      render: (v: string | null) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title: '客户',
      dataIndex: 'customerCode',
      width: 130,
      render: (v: string, r: DetailOrder) => (
        <Link to={`/customers/${r.customerId}`} title={r.customerWechat}>
          {v || r.customerWechat || '客户'}
        </Link>
      ),
    },
    { title: '类型', dataIndex: 'type', width: 70, render: (v: string) => <TypeTag type={v} /> },
    { title: '游戏', dataIndex: 'gameName', width: 90 },
    { title: '时长', dataIndex: 'hours', width: 70, render: (v: number) => hours(v) },
    { title: '金额', dataIndex: 'amount', width: 80, render: (v: number) => yuan(v) },
    {
      title: '陪玩',
      dataIndex: 'companionName',
      width: 96,
      render: (v: string | null, r: DetailOrder) => (
        <Space size={4}>
          <span>{v || '—'}</span>
          {r.iAmPartner ? <Tag style={{ marginInlineEnd: 0, fontSize: 10 }}>我是搭档</Tag> : null}
        </Space>
      ),
    },
    { title: '搭档', dataIndex: 'coCompanionName', width: 90, render: (v: string | null) => v || '—' },
    { title: '客服', dataIndex: 'csName', width: 90, render: (v: string | null) => v || '—' },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 110,
      render: (_: string, r: DetailOrder) => (
        <Tooltip title={`下单 ${dayjs(r.createdAt).format('MM-DD HH:mm')}`}>
          <span style={{ fontSize: 12 }}>{hhmm(r.startedAt)}–{hhmm(r.endedAt)}</span>
        </Tooltip>
      ),
    },
  ];

  const customerColumns = [
    {
      title: '客户',
      dataIndex: 'customerCode',
      width: 150,
      render: (v: string, r: DetailCustomer) => (
        <Space size={6}>
          <Link to={`/customers/${r.customerId}`}>{v || r.customerWechat || '客户'}</Link>
          {r.kinds.map((k) => (
            <TypeTag key={k} type={k} />
          ))}
        </Space>
      ),
    },
    {
      title: (
        <Tooltip title="这一天算不算续单 / 复购客户（只有算的才进上面那两栏的率）；「未计」= 这天在他这还没打过首单，按 KPI 口径不进分母">
          <span>判定</span>
        </Tooltip>
      ),
      key: 'verdict',
      width: 96,
      render: (_: unknown, r: DetailCustomer) => {
        if (!r.counted) return <Tag style={{ marginInlineEnd: 0 }}>未计</Tag>;
        const tags: React.ReactNode[] = [];
        if (r.renewed) tags.push(<Tag key="r" color="green" style={{ marginInlineEnd: 0 }}>续单客户</Tag>);
        if (r.repurchased) tags.push(<Tag key="b" color="purple" style={{ marginInlineEnd: 0 }}>复购客户</Tag>);
        if (!tags.length) tags.push(<Tag key="n" color="blue" style={{ marginInlineEnd: 0 }}>首单客户</Tag>);
        return <Space size={4}>{tags}</Space>;
      },
    },
    { title: '当天单数', dataIndex: 'orders', width: 80, align: 'right' as const },
    { title: '当天时长', dataIndex: 'hours', width: 80, align: 'right' as const, render: (v: number) => hours(v) },
    { title: '当天金额', dataIndex: 'amount', width: 90, align: 'right' as const, render: (v: number) => yuan(v) },
    { title: '累计单数', dataIndex: 'totalOrders', width: 80, align: 'right' as const },
    { title: '累计时长', dataIndex: 'totalHours', width: 80, align: 'right' as const, render: (v: number) => hours(v) },
    {
      title: '累计金额',
      dataIndex: 'totalAmount',
      width: 90,
      align: 'right' as const,
      render: (v: number) => <Text strong>{yuan(v)}</Text>,
    },
    { title: '首次', dataIndex: 'firstAt', width: 100, render: (v: string | null) => ymd(v) },
    { title: '最近', dataIndex: 'lastAt', width: 100, render: (v: string | null) => ymd(v) },
  ];

  return (
    <Card
      size="small"
      style={style}
      styles={{ body: { paddingTop: 10 } }}
      title={
        <Space size={8} wrap>
          <span>{title}</span>
          {data?.companionName ? <Tag color={BRAND.primary}>只看：{data.companionName}</Tag> : null}
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            单量按「下单时间 + 已完成」；时长按打完的会话（含加打的那段）；续单 / 复购按客户，跟陪玩 KPI 同一套口径；点一行看当天明细
          </Text>
        </Space>
      }
      extra={
        <Space size={8} wrap>
          {showCompanionFilter ? (
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="全店（可筛某个陪玩）"
              style={{ width: 180 }}
              value={companionId}
              onChange={(v) => setCompanionId(v || undefined)}
              options={(data?.companions || []).map((c) => ({
                value: c.id,
                label: c.resigned ? `${c.name}（已离职）` : c.name,
              }))}
            />
          ) : null}
          <Segmented
            size="small"
            value={preset}
            onChange={(v) => setPreset(String(v))}
            options={RANGE_OPTIONS}
          />
          {preset === 'custom' ? (
            <DatePicker.RangePicker
              size="small"
              allowClear={false}
              value={customRange ? [dayjs(customRange[0]), dayjs(customRange[1])] : [dayjs(todayKey), dayjs(todayKey)]}
              onChange={(v) => {
                if (!v || !v[0] || !v[1]) return;
                setCustomRange([v[0].format('YYYY-MM-DD'), v[1].format('YYYY-MM-DD')]);
              }}
            />
          ) : null}
          <Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={() => void load(true)}>
            刷新
          </Button>
        </Space>
      }
    >
      {loading && !data ? (
        <LoadingState minHeight={220} tip="正在算这几天的数据…" />
      ) : !data || !data.rows.length ? (
        <Empty description="这几天还没有打完的单" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <>
          <Row gutter={[10, 10]} style={{ marginBottom: 10 }}>
            <Col xs={12} md={5}>
              <StatCard
                size="sm"
                label="成交单"
                value={`${total?.orders ?? 0} 单`}
                sub={total?.partnerOrders ? `其中当搭档 ${total.partnerOrders} 单` : `时长 ${hours(total?.hours).replace(' 小时', ' 小时')}`}
                tint={BRAND.primary}
              />
            </Col>
            <Col xs={12} md={5}>
              <StatCard
                size="sm"
                label="续单"
                value={`${total?.renew ?? 0} 个客户`}
                sub={`续单率 ${pct(total?.renewRate)}（按客户）`}
                tint={SEMANTIC.success}
              />
            </Col>
            <Col xs={12} md={5}>
              <StatCard
                size="sm"
                label="复购"
                value={`${total?.repurchase ?? 0} 个客户`}
                sub={`复购率 ${pct(total?.repurchaseRate)}（按客户）`}
                tint={SEMANTIC.repurchase}
              />
            </Col>
            <Col xs={12} md={5}>
              <StatCard
                size="sm"
                label="服务客户"
                value={`${total?.customers ?? 0} 个`}
                sub={`新客 ${total?.newCustomers ?? 0} 个 · 首单 ${total?.first ?? 0} 单`}
                tint={SEMANTIC.customer}
              />
            </Col>
            <Col xs={12} md={4}>
              <StatCard size="sm" label="区间流水" value={yuan(total?.amount)} sub={`时长 ${hours(total?.hours)}`} tint={SEMANTIC.orangeDeeper} />
            </Col>
          </Row>

          <Table
            size="small"
            rowKey="date"
            dataSource={data.rows}
            columns={columns}
            pagination={false}
            scroll={{ y: 360 }}
            onRow={(r) => ({
              onClick: () => openDetail(r.date),
              style: { cursor: 'pointer' },
            })}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: BORDER.secondary }}>
                  <Table.Summary.Cell index={0}>
                    <Text strong>合计</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Text strong>{total?.orders ?? 0}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">
                    {total?.first ?? 0}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">
                    <Text strong style={{ color: SEMANTIC.success }}>{total?.renew ?? 0}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right">
                    <Text strong style={{ color: SEMANTIC.repurchase }}>{total?.repurchase ?? 0}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right">
                    {pct(total?.renewRate)}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="right">
                    {pct(total?.repurchaseRate)}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={7} align="right">
                    {total?.customers ?? 0}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={8} align="right">
                    {total?.newCustomers ?? 0}
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={9} align="right">
                    <Text strong>{yuan(total?.amount)}</Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
        </>
      )}

      <Drawer
        title={detailDate ? `${dayLabel(detailDate)}（${detailDate}）明细` : '明细'}
        width={1000}
        open={!!detailDate}
        onClose={() => setDetailDate(null)}
        destroyOnClose
      >
        <Space size={8} style={{ marginBottom: 10 }} wrap>
          <Segmented
            size="small"
            value={detailKind}
            onChange={(v) => {
              const kind = String(v);
              setDetailKind(kind);
              if (detailDate) void loadDetail(detailDate, kind);
            }}
            options={[
              { label: '全部', value: 'ALL' },
              { label: '只看首单', value: 'NEW' },
              { label: '只看续单', value: 'RENEW' },
              { label: '只看复购', value: 'REPURCHASE' },
            ]}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            客户那一列点进去 = 这个客户的完整档案（累计消费 / 时长 / 历史单）
          </Text>
        </Space>

        {detailLoading && !detail ? (
          <LoadingState minHeight={200} tip="正在拉明细…" />
        ) : !detail ? (
          <Empty description="没有明细" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <>
            <Text strong>这一天的单（{detail.orders.length} 张）</Text>
            <Table
              size="small"
              rowKey="id"
              style={{ marginTop: 6, marginBottom: 18 }}
              dataSource={detail.orders}
              columns={orderColumns}
              pagination={false}
              scroll={{ x: 990 }}
              locale={{ emptyText: <Empty description="这一天没有这一类单" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            />
            <Space size={8} wrap>
              <Text strong>这一天服务过的客户（{detail.customers.length} 个）</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                只加了段、没有新单的客户也在这儿（不再漏掉「同一个单里加打一段」）
              </Text>
            </Space>
            <Table
              size="small"
              rowKey="customerId"
              style={{ marginTop: 6 }}
              dataSource={detail.customers}
              columns={customerColumns}
              pagination={false}
              scroll={{ x: 990 }}
              locale={{ emptyText: <Empty description="没有客户" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            />
          </>
        )}
      </Drawer>
    </Card>
  );
};

export default DailyKpiPanel;
