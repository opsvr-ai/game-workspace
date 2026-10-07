// craftsman-ignore: TS001,TS002,TS003
import React, { useCallback, useEffect, useState } from 'react';
import { Card, Row, Col, Tag, Progress, Table, Empty, Button, Typography, Segmented, Space, Tooltip as AntTooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import dayjs from 'dayjs';
import http from '../../api/client';
import CardSkeleton from '../../components/CardSkeleton';
import { BG, BORDER, BRAND, TEXT, SEMANTIC } from '../../styles/tokens';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import { tierMeta } from '../../constants/tiers';

const { Text } = Typography;

const yuan = (v: unknown) => `¥${(Number(v) || 0).toFixed(1)}`;
const pct = (v: unknown) => `${Math.round(Number(v) || 0)}%`;
const hm = (sec: unknown) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}小时${m}分` : `${m}分钟`;
};

/** 接口失败（比如客服角色没有权限）就返回 null，那块儿自动不显示，不拖垮整页。 */
const safeGet = async (url: string, params?: any): Promise<any> => {
  try {
    const res: any = await http.get(url, params ? { params } : undefined);
    return res?.data?.data ?? null;
  } catch {
    return null;
  }
};

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  BUSY: { label: '接单中', color: '#1677ff', bg: '#E8F1FF' },
  ENTERTAINMENT: { label: '娱乐中', color: '#722ed1', bg: '#F4EBFF' },
  AVAILABLE: { label: '空闲', color: '#52c41a', bg: '#EAF7EA' },
  RESTING: { label: '休息', color: '#faad14', bg: SEMANTIC.warningSoft },
  OFFLINE: { label: '离线', color: TEXT.tertiary, bg: BORDER.secondary },
};
const ATT_ROLE_LABEL: Record<string, string> = { COMPANION: '陪玩', CS: '客服', ADMIN: '店长' };
const ATT_STATUS: Record<string, { label: string; color: string }> = {
  PRESENT: { label: '正常', color: 'green' },
  LATE: { label: '迟到', color: 'red' },
  EARLY_LEAVE: { label: '早退', color: 'orange' },
  LATE_EARLY: { label: '迟到+早退', color: 'red' },
  ABSENT: { label: '未打卡', color: 'default' },
  NOT_STARTED: { label: '未到点', color: 'default' },
};
const ATT_RANK: Record<string, number> = { LATE_EARLY: 0, LATE: 1, EARLY_LEAVE: 2, ABSENT: 3, PRESENT: 4, NOT_STARTED: 5 };

/** 一行「名字 + 进度条 + 数值」：老板要的进度条样式，从高到低排。 */
const RankBar: React.FC<{ name: string; value: number; max: number; text: string; color: string }> = ({ name, value, max, text, color }) => {
  const p = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      <span style={{ width: 62, fontSize: 12, color: TEXT.heading, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <div style={{ flex: 1 }}>
        <Progress percent={p} showInfo={false} strokeColor={color} size="small" />
      </div>
      <span style={{ width: 66, fontSize: 12, fontWeight: 600, color, textAlign: 'right' }}>{text}</span>
    </div>
  );
};

interface Props {
  /** 客服视角时用来收起「只有老板/店长才有权限」的区块（没数据自然就不显示，这里只影响文案）。 */
  compact?: boolean;
}

const OperationsBoard: React.FC<Props> = ({ compact }) => {
  const [loading, setLoading] = useState(true);
  const [dash, setDash] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [live, setLive] = useState<any>(null);
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [cust, setCust] = useState<any>(null);
  const [csStats, setCsStats] = useState<any>(null);
  const [rankMode, setRankMode] = useState<'score' | 'revenue' | 'customer'>('score');
  // 今日考勤：谁迟到、谁早退、谁没打卡（老板 2026-10-04）
  const [attendance, setAttendance] = useState<any>(null);

  const load = useCallback(async () => {
    const today = dayjs().format('YYYY-MM-DD');
    const [d, o, t, l, p, c, s, att] = await Promise.all([
      safeGet('/dashboard'),
      safeGet('/dashboard/revenue-overview'),
      safeGet('/dashboard/trend', { days: 14 }),
      safeGet('/companions/live-board'),
      safeGet('/personnel'),
      safeGet('/customers/board'),
      safeGet('/stats/daily', { date: today, dateFrom: today, dateTo: today }),
      safeGet('/companions/attendance-today'),
    ]);
    setDash(d);
    setOverview(o);
    setTrend(Array.isArray(t) ? t : []);
    setLive(l);
    setPersonnel(Array.isArray(p) ? p : []);
    setCust(c);
    setCsStats(s);
    setAttendance(att);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading) {
    return (
      <div>
        <Row gutter={12} style={{ marginBottom: 14 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Col xs={12} md={4} key={i}><CardSkeleton lines={1} /></Col>
          ))}
        </Row>
        <CardSkeleton lines={8} />
      </div>
    );
  }

  const companions = personnel.filter((u: any) => u.role === 'COMPANION' && u.companionId);
  const liveRows: any[] = live?.rows || [];
  const servingCount = liveRows.filter((r) => r.serving).length;
  const counts = cust?.counts || null;

  // 三个排行榜（首单成功率最低 / 续单率最低 / 综合分最低）——老板要「谁的约首单率最低、还有多少没激活」。
  const rateList = companions.map((u: any) => ({
    id: u.companionId,
    name: u.displayName || u.username,
    tier: u.tier || 'MIDDLE',
    score: Number(u.rankScore) || 0,
    newRate: Number(u.newRate) || 0,
    renewRate: Number(u.renewRate) || 0,
    repurchaseRate: Number(u.repurchaseRate) || 0,
    orders: Number(u.orderCount) || 0,
    month: Number(u.monthlyRevenue) || 0,
    online: !!u.isOnline,
    customers: Number(u.customerCount) || 0,
  }));

  const custByCompanion: Record<string, { count: number; spent: number }> = {};
  (cust?.rows || []).forEach((r: any) => {
    const cid = r.companion?.id || r.companionId;
    if (!cid) return;
    const e = (custByCompanion[cid] = custByCompanion[cid] || { count: 0, spent: 0 });
    e.count += 1;
    e.spent += Number(r.spent) || 0;
  });
  rateList.forEach((r) => { r.customers = custByCompanion[r.id]?.count ?? 0; });

  const topByRevenue = [...rateList].sort((a, b) => b.month - a.month).slice(0, 10);
  const topByScore = [...rateList].sort((a, b) => b.score - a.score).slice(0, 10);
  const worstByNew = [...rateList].filter((r) => r.orders > 0).sort((a, b) => a.newRate - b.newRate || a.orders - b.orders).slice(0, 10);
  const byCustomer = [...rateList].sort((a, b) => b.customers - a.customers).slice(0, 10);
  const maxRev = Math.max(1, ...topByRevenue.map((r) => r.month));
  const maxScore = Math.max(1, ...topByScore.map((r) => r.score));
  const maxCust = Math.max(1, ...byCustomer.map((r) => r.customers));

  const trendData = trend.map((t: any) => ({ date: String(t.date || '').slice(5), revenue: Number(t.revenue) || 0, orders: Number(t.orderCount) || 0 }));
  const typeBreak = overview?.typeBreakdown || {};
  const TYPE_COLORS: Record<string, string> = { NEW: '#1677ff', RENEW: '#52c41a', REPURCHASE: '#faad14', TIP: '#eb2f96' };
  const TYPE_LABELS: Record<string, string> = { NEW: '首单', RENEW: '续单', REPURCHASE: '复购', TIP: '打赏' };

  const attRows: any[] = Object.entries(attendance?.roles || {}).flatMap(([role, r]: any) =>
    // 行上带上这一块的班次时间：「班外打卡」的提示要用（老板 2026-10-07）。
    (r?.rows || []).map((row: any) => ({ ...row, roleKey: role, workStart: r?.workStart, workEnd: r?.workEnd })),
  );
  attRows.sort((a, b) => (ATT_RANK[a.status] ?? 9) - (ATT_RANK[b.status] ?? 9) || String(a.name).localeCompare(String(b.name)));

  const custTop = [...(cust?.rows || [])]
    .sort((a: any, b: any) => (Number(b.spent) || 0) - (Number(a.spent) || 0))
    .slice(0, 8);

  return (
    <div>
      <PageHeader
        title="运营看板"
        subtitle={`${compact ? '客服' : '老板 / 店长'}视角的经营总览 · 每 60 秒自动刷新（上次 ${dayjs().format('HH:mm')}）`}
        extra={
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
        }
      />

      {/* ── KPI ── */}
      {/* alignItems: "stretch"：几张卡都是 height:100%，而 antd 的 Row 默认不拉伸 ——
          结果带副标题的那张比别的矮一截、一行的下沿参差不齐（看板最扎眼的地方）。
          （注意：antd 5.18 的 Row 上那个 align="stretch" 只会加个 class、并没有真的生成 CSS，
           实测 align-items 还是 flex-start，所以这里直接写行内样式。） */}
      <Row gutter={[12, 12]} style={{ marginBottom: 14, alignItems: 'stretch' }}>
        <Col xs={12} md={4}><StatCard label="今日流水" value={dash ? yuan(dash.today?.totalRevenue) : '—'} tint={BRAND.primary} /></Col>
        <Col xs={12} md={4}><StatCard label="本月流水" value={overview ? yuan(overview.monthlyRevenue) : '—'} tint="#52c41a" /></Col>
        {/* 今日单量 = 发单量（跟客服看板「全店发单」同一口径，老板 2026-10-07 定的）；
            已完成单独放副标题，免得跟旁边的「今日流水」对不上号。 */}
        <Col xs={12} md={4}>
          <StatCard
            label="今日单量"
            value={dash ? `${dash.today?.publishedCount ?? 0} 单` : '—'}
            // 两行分开写：窄屏（1024）下挤在一行会断在「接单率」和数字中间。
            sub={dash ? (
              <>
                <div>已完成 {dash.today?.orderCount ?? 0} 单</div>
                <div>接单率 {pct(dash.today?.acceptRate)}</div>
              </>
            ) : undefined}
            tint="#faad14"
          />
        </Col>
        <Col xs={12} md={4}><StatCard label="在线陪玩" value={dash ? `${dash.today?.onlineCount ?? 0} / ${dash.today?.totalCount ?? 0}` : '—'} sub={`打单中 ${servingCount} 人`} tint="#722ed1" /></Col>
        <Col xs={12} md={4}><StatCard label="今日娱乐费" value={dash ? yuan(dash.today?.entertainmentFee) : '—'} tint="#13c2c2" /></Col>
        <Col xs={12} md={4}>
          <StatCard
            label="客户"
            value={counts ? `${counts.customers ?? 0} 个` : '—'}
            sub={counts ? `今日消费 ${yuan(counts.todaySpentTotal)} · 在打 ${counts.serving ?? 0}` : undefined}
            tint="#eb2f96"
          />
        </Col>
      </Row>

      {/* ── 图表 ── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 14, alignItems: 'stretch' }}>
        <Col xs={24} lg={15}>
          <Card size="small" title="近 14 天流水" styles={{ body: { paddingTop: 8 } }}>
            {trendData.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trendData} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `¥${v}`} />
                  <Tooltip formatter={(v: any) => [`¥${Number(v).toFixed(1)}`, '流水']} />
                  <Bar dataKey="revenue" fill={BRAND.primary} radius={[4, 4, 0, 0]} maxBarSize={26}>
                    <LabelList dataKey="revenue" position="top" formatter={(v: any) => (Number(v) > 0 ? Number(v).toFixed(0) : '')} style={{ fontSize: 10, fill: TEXT.tertiary }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card size="small" title="本月订单结构">
            <Row gutter={[8, 8]}>
              {Object.keys(TYPE_LABELS).map((k) => (
                <Col span={12} key={k}>
                  <div style={{ background: BG.base, borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 12, color: TEXT.secondary }}>
                      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 2, background: TYPE_COLORS[k], marginRight: 6 }} />
                      {TYPE_LABELS[k]}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: TYPE_COLORS[k] }}>{yuan(typeBreak[k] || 0)}</div>
                  </div>
                </Col>
              ))}
            </Row>
            {csStats?.summary ? (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${BORDER.base}`, fontSize: 12, color: TEXT.heading }}>
                今日客服发单 <b>{csStats.summary.totalOrders ?? 0}</b> 单 · 合计 <b>{yuan(csStats.summary.totalAmount)}</b>
                （直派 {csStats.summary.directCount ?? 0} · 抢单 {csStats.summary.claimedCount ?? 0} · 桥接 {csStats.summary.bridgeCount ?? 0}）
              </div>
            ) : null}
          </Card>
        </Col>
      </Row>

      {/* ── 陪玩状态墙 ── */}
      <Card
        size="small"
        title="陪玩状态墙（谁在跟谁打 · 打了多久）"
        style={{ marginBottom: 14 }}
      >
        {liveRows.length ? (
          <Row gutter={[10, 10]}>
            {liveRows.map((r) => {
              const meta = STATUS_META[r.serving ? 'BUSY' : r.online ? r.status : 'OFFLINE'] || STATUS_META.OFFLINE;
              return (
                <Col xs={12} sm={8} md={6} lg={4} key={r.companionId}>
                  <div style={{ border: `1px solid ${meta.color}33`, borderLeft: `4px solid ${meta.color}`, background: meta.bg, borderRadius: 10, padding: '8px 10px', height: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      <Tag color={meta.color} style={{ marginInlineEnd: 0, fontSize: 11 }}>{meta.label}</Tag>
                    </div>
                    {r.serving ? (
                      <div style={{ fontSize: 12, color: '#334155', marginTop: 4, lineHeight: 1.5 }}>
                        {r.serving.partnerName ? `双陪 · 跟 ${r.serving.partnerName}` : r.serving.role === 'CO' ? '双陪' : '单陪'}<br />
                        {r.serving.gameName || '游戏'} · {hm(r.serving.elapsedSec)}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: TEXT.secondary, marginTop: 4, lineHeight: 1.5 }}>
                        今日 {r.todayOrders || 0} 单 · {r.earningsHidden ? '—' : yuan(r.todayRevenue)}<br />
                        工时 {r.todayMinutes || 0} 分钟
                      </div>
                    )}
                    {r.isBridged ? <div style={{ fontSize: 11, color: TEXT.tertiary, marginTop: 2 }}>桥接 · {r.studioName}</div> : null}
                  </div>
                </Col>
              );
            })}
          </Row>
        ) : <Empty description="暂无陪玩数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      </Card>

      {/* ── 排行榜 ── */}
      {/* 今日段位变动（老板 2026-10-04）：服务端每天 12:05 复核后留档，有才显示 */}
      {dash?.tierChanges?.length ? (
        <Card size="small" title="今日段位变动（升级 / 降级）" style={{ marginBottom: 14 }}>
          <Space wrap size={[8, 8]}>
            {dash.tierChanges.map((c: any, i: number) => (
              <Tag key={`${c.companionId}-${i}`} color={tierMeta(c.to).color} style={{ padding: '4px 10px', fontSize: 12 }}>
                {c.name}：{tierMeta(c.from).label} → {tierMeta(c.to).label}（{c.score} 分）
              </Tag>
            ))}
          </Space>
        </Card>
      ) : null}

      <Card
        size="small"
        title="陪玩排行"
        extra={
          <Segmented
            size="small"
            value={rankMode}
            onChange={(v) => setRankMode(v as any)}
            options={[
              { label: '综合分', value: 'score' },
              { label: '本月流水', value: 'revenue' },
              { label: '客户数', value: 'customer' },
            ]}
          />
        }
        style={{ marginBottom: 14 }}
      >
        {rankMode === 'score' && (topByScore.length
          ? topByScore.map((r) => <RankBar key={r.id} name={r.name} value={r.score} max={100} text={`${r.score} 分`} color={tierMeta(r.tier).color} />)
          : <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />)}
        {rankMode === 'revenue' && (topByRevenue.length
          ? topByRevenue.map((r) => <RankBar key={r.id} name={r.name} value={r.month} max={maxRev} text={yuan(r.month)} color="#52c41a" />)
          : <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />)}
        {rankMode === 'customer' && (byCustomer.length
          ? byCustomer.map((r) => <RankBar key={r.id} name={r.name} value={r.customers} max={maxCust} text={`${r.customers} 个`} color="#eb2f96" />)
          : <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />)}
      </Card>

      {/* ── 质量榜 + 最该关注的 ── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 14, alignItems: 'stretch' }}>
        <Col xs={24} lg={15}>
          <Card size="small" title="陪玩 KPI（首单成功率 / 续单率 / 复购率）">
            {rateList.length ? (
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                scroll={{ y: 340 }}
                dataSource={[...rateList].sort((a, b) => b.score - a.score)}
                columns={[
                  {
                    title: '陪玩', dataIndex: 'name', width: 120,
                    render: (v: string, r: any) => (
                      <Space size={4}>
                        <span>{v}</span>
                        <Tag color={tierMeta(r.tier).color} style={{ fontSize: 10, marginInlineEnd: 0 }}>{tierMeta(r.tier).label}</Tag>
                        {!r.online ? <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>离线</Tag> : null}
                      </Space>
                    ),
                  },
                  {
                    title: '综合分', dataIndex: 'score', width: 110,
                    render: (v: number) => <Progress percent={Math.min(100, v)} size="small" strokeColor={BRAND.primary} format={() => `${v}`} />,
                  },
                  { title: '首单成功率', dataIndex: 'newRate', width: 100, render: (v: number) => <span style={{ color: v < 50 ? SEMANTIC.dangerDeep : '#3f8600', fontWeight: 600 }}>{pct(v)}</span> },
                  { title: '续单率', dataIndex: 'renewRate', width: 84, render: (v: number) => pct(v) },
                  { title: '复购率', dataIndex: 'repurchaseRate', width: 84, render: (v: number) => pct(v) },
                  { title: '成单(30天)', dataIndex: 'orders', width: 84 },
                  { title: '本月流水', dataIndex: 'month', width: 96, render: (v: number) => yuan(v) },
                  { title: '客户', dataIndex: 'customers', width: 64, render: (v: number) => `${v} 个` },
                ]}
              />
            ) : <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card size="small" title="最该盯的（首单成功率最低）" style={{ marginBottom: 12 }}>
            {worstByNew.length ? worstByNew.map((r) => (
              <RankBar key={r.id} name={r.name} value={r.newRate} max={100} text={`${pct(r.newRate)} · ${r.orders}单`} color={r.newRate < 50 ? SEMANTIC.dangerDeep : '#faad14'} />
            )) : <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
          <Card size="small" title="客户消费 Top（含今日在打）">
            {custTop.length ? custTop.map((r: any, i: number) => (
              <div key={r.id || i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: TEXT.heading }}>
                <span>{r.customerCode || r.wechatId || '客户'}{r.live ? <Tag color={BRAND.primary} style={{ marginLeft: 6, fontSize: 10 }}>在打</Tag> : null}</span>
                <span style={{ fontWeight: 600 }}>{yuan(r.spent)}</span>
              </div>
            )) : <Empty description="暂无客户数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>
      </Row>

      {/* ── 今日考勤（迟到 / 早退 / 未打卡） ── */}
      {attRows.length ? (
        <Card size="small" title="🕘 今日考勤（迟到 / 早退 / 未打卡）" style={{ marginBottom: 14 }}>
          <Space size={18} wrap style={{ marginBottom: 8 }}>
            {Object.entries(attendance?.roles || {}).map(([role, r]: any) => (
              <Text key={role} style={{ fontSize: 12 }}>
                <b>{ATT_ROLE_LABEL[role] || role}</b>
                （{r.workStart}–{r.workEnd}）：迟到{' '}
                <Text style={{ color: r.counts.late ? SEMANTIC.dangerDeep : TEXT.tertiary, fontWeight: 600 }}>{r.counts.late}</Text> · 早退{' '}
                <Text style={{ color: r.counts.earlyLeave ? '#FA8C16' : TEXT.tertiary, fontWeight: 600 }}>{r.counts.earlyLeave}</Text> · 未打卡{' '}
                <Text style={{ color: r.counts.absent ? SEMANTIC.dangerDeep : TEXT.tertiary, fontWeight: 600 }}>{r.counts.absent}</Text> · 正常 {r.counts.present}/{r.counts.total}
                {r.counts.outsideShift ? (
                  <>
                    {'（含'}
                    <Text style={{ color: SEMANTIC.warningDeep, fontWeight: 600 }}>班外打卡 {r.counts.outsideShift}</Text>
                    {'）'}
                  </>
                ) : null}
              </Text>
            ))}
          </Space>
          <Table
            size="small"
            rowKey={(r: any) => `${r.roleKey}-${r.id}`}
            pagination={false}
            scroll={{ y: 240 }}
            dataSource={attRows}
            columns={[
              { title: '姓名', dataIndex: 'name', width: 130, render: (v: string, r: any) => <Space size={4}><span>{v}</span>{r.onDuty ? <Tag color="blue" style={{ fontSize: 10, marginInlineEnd: 0 }}>在班</Tag> : null}</Space> },
              { title: '职位', dataIndex: 'roleKey', width: 70, render: (v: string) => ATT_ROLE_LABEL[v] || v },
              {
                title: '上班', dataIndex: 'loginAt', width: 118,
                render: (v: string, r: any) => {
                  if (!v) return '—';
                  const time = dayjs(v).format('HH:mm');
                  // 班外打卡（老板 2026-10-07）：凌晨开机自启 / 深夜重连写下的时间，
                  // 不是人来上班了，单独标出来，免得看着像正常签到。
                  if (!r.outsideShift) return time;
                  return (
                    <AntTooltip title={'这次上线在上班时间（' + (r.workStart || '—') + '–' + (r.workEnd || '—') + '）之外，不算当天上班打卡'}>
                      <Space size={4}>
                        <span style={{ color: TEXT.tertiary }}>{time}</span>
                        <Tag color="gold" style={{ fontSize: 10, marginInlineEnd: 0 }}>班外</Tag>
                      </Space>
                    </AntTooltip>
                  );
                },
              },
              { title: '下班', dataIndex: 'logoutAt', width: 80, render: (v: string) => (v ? dayjs(v).format('HH:mm') : '—') },
              {
                title: '状态', dataIndex: 'status', width: 100,
                render: (v: string) => <Tag color={ATT_STATUS[v]?.color}>{ATT_STATUS[v]?.label || v}</Tag>,
              },
            ]}
          />
        </Card>
      ) : null}

      {/* ── 客服今日发单 ── */}
      {csStats?.csList?.length ? (
        <Card size="small" title="客服今日发单">
          <Table
            size="small"
            rowKey={(r: any) => r.csUserId}
            pagination={false}
            dataSource={csStats.csList}
            columns={[
              { title: '客服', dataIndex: 'csDisplayName', render: (v: string, r: any) => v || r.csName },
              { title: '发单', dataIndex: 'totalOrders', width: 80 },
              { title: '金额', dataIndex: 'totalAmount', width: 110, render: (v: number) => yuan(v) },
              { title: '抢单', dataIndex: 'claimedCount', width: 80 },
              { title: '直派', dataIndex: 'directCount', width: 80 },
              { title: '桥接', dataIndex: 'bridgeCount', width: 80 },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
};

export default OperationsBoard;
