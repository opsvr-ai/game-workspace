// craftsman-ignore: TS001,TS002,TS003
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, Tag, Progress, Table, Empty, Button, Typography, Segmented, Space, Tooltip as AntTooltip, Modal } from 'antd';
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
import DailyKpiPanel from '../../components/DailyKpiPanel';
import UnifiedDashboard from './UnifiedDashboard';

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
  // 跟陪玩首页顶部的状态 Tag 用同一套颜色（老板 2026-10-18）：
  // 接单中=红、娱乐中=金、空闲=绿、休息=橙、离线=灰。
  BUSY: { label: '接单中', color: '#F5222D', bg: SEMANTIC.dangerSoft },
  ENTERTAINMENT: { label: '娱乐中', color: '#FAAD14', bg: SEMANTIC.warningSoft },
  AVAILABLE: { label: '空闲', color: '#52C41A', bg: SEMANTIC.successSoft },
  RESTING: { label: '休息', color: '#FA8C16', bg: SEMANTIC.orangeSoft },
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
  const [bridgeDetail, setBridgeDetail] = useState<any>(null);
  const [bridgeFlow, setBridgeFlow] = useState<any[]>([]);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [rankMode, setRankMode] = useState<'score' | 'revenue' | 'customer'>('score');
  // 看板区块分类：一屏只放一类，别再把所有表 / 图 / 状态墙堆在一起（老板 2026-10-19「好乱」）
  const [boardTab, setBoardTab] = useState<'live' | 'overview' | 'daily' | 'orders' | 'customers' | 'cs'>('live');
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

  /**
   * 客服发单里的「桥接」点开：列出这张客服当天所有桥接单、合计金额，
   * 并带上这些单收款到的客服工作微信的今日收款 / 当前余额。
   */
  const openBridgeDetail = async (cs: any) => {
    const orders = (csStats?.orders || []).filter((o: any) => {
      if (!o?.companionStudioId || !o?.studioId) return false;
      const isBridge = o.companionStudioId !== o.studioId && o.companionStudioType !== 'RENTAL';
      return isBridge && String(o.csUserId || '') === String(cs.csUserId || '');
    });
    setBridgeDetail({
      cs,
      orders,
      total: orders.reduce((s: number, o: any) => s + (Number(o.amount) || 0), 0),
    });
    setBridgeFlow([]);
    setBridgeLoading(true);
    try {
      const flow = await safeGet('/orders/cs-wechat-flow');
      setBridgeFlow(Array.isArray(flow) ? flow : []);
    } finally {
      setBridgeLoading(false);
    }
  };

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
  // 双陪的两个人挨着显示，且**主陪在前、副陪在后**（老板 2026-10-18）。
  // 接口返回的行按状态/名字排，主陪和副陪中间可能夹着别人；这里重排成「主陪 → 副陪」相邻。
  const liveRowById = new Map(liveRows.map((r: any) => [r.companionId, r]));
  const displayRows: any[] = [];
  const placed = new Set<string>();
  for (const r of liveRows) {
    if (placed.has(r.companionId)) continue;
    const s = r.serving;
    const partner = s?.partnerId ? liveRowById.get(s.partnerId) : null;
    if (partner) {
      const main = s.role === 'CO' ? partner : r;
      const co = s.role === 'CO' ? r : partner;
      if (!placed.has(main.companionId)) {
        displayRows.push(main);
        placed.add(main.companionId);
      }
      if (!placed.has(co.companionId)) {
        displayRows.push(co);
        placed.add(co.companionId);
      }
      continue;
    }
    displayRows.push(r);
    placed.add(r.companionId);
  }
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
  const kpiById = new Map(rateList.map((r) => [r.id, r]));

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

      {/* 分类查看（老板 2026-10-19：「好乱，能不能分类」）：一屏只放一类，不再纵向堆七八块 */}
      <Segmented
        block
        size="large"
        value={boardTab}
        onChange={(v) => setBoardTab(v as typeof boardTab)}
        options={[
          { value: 'live', label: '陪玩状态' },
          { value: 'overview', label: '经营总览' },
          { value: 'daily', label: '每日数据' },
          { value: 'orders', label: '订单管理' },
          { value: 'customers', label: '客户管理' },
          { value: 'cs', label: '客服管理' },
        ]}
        style={{ marginBottom: 14 }}
      />

      {boardTab === 'overview' && (
        <>
      {/* ── KPI ── */}
      {/* alignItems: "stretch"：几张卡都是 height:100%，而 antd 的 Row 默认不拉伸 ——
          结果带副标题的那张比别的矮一截、一行的下沿参差不齐（看板最扎眼的地方）。
          （注意：antd 5.18 的 Row 上那个 align="stretch" 只会加个 class、并没有真的生成 CSS，
           实测 align-items 还是 flex-start，所以这里直接写行内样式。） */}
      <Row gutter={[12, 12]} style={{ marginBottom: 14, alignItems: 'stretch' }}>
        <Col xs={12} md={4}><StatCard label="今日业绩" value={dash ? yuan(dash.today?.totalRevenue) : '—'} tint={BRAND.primary} /></Col>
        <Col xs={12} md={4}><StatCard label="本月业绩" value={overview ? yuan(overview.monthlyRevenue) : '—'} tint="#52c41a" /></Col>
        {/* 今日单量 = 发单量（跟客服看板「全店发单」同一口径，老板 2026-10-07 定的）；
            已完成单独放副标题，免得跟旁边的「今日业绩」对不上号。 */}
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
          <Card size="small" title="近 14 天业绩" styles={{ body: { paddingTop: 8 } }}>
            {trendData.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trendData} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `¥${v}`} />
                  <Tooltip formatter={(v: any) => [`¥${Number(v).toFixed(1)}`, '业绩']} />
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
      {/* 本店营收已并入经营总览（老板 2026-10-19）：不再单开侧栏「本店营收」页 */}
      {!compact && <div style={{ marginTop: 14 }}><UnifiedDashboard embedded /></div>}
        </>
      )}

      {/* ── 每日数据（老板 2026-10-07）：每天多少单 / 多少续 / 续单率 / 多少复购 / 复购率 / 客户，
          点开某一天看明细。管理端看全店，可筛某个陪玩。 ── */}
      {boardTab === 'daily' && (
        <DailyKpiPanel showCompanionFilter style={{ marginBottom: 14 }} />
      )}

      {/* ── 订单管理：先看今天的量、本月结构和客服发单汇总 ── */}
      {boardTab === 'orders' && (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 14, alignItems: 'stretch' }}>
            <Col xs={12} md={6}><StatCard label="今日发单" value={dash ? `${dash.today?.publishedCount ?? 0} 单` : '—'} tint="#faad14" /></Col>
            <Col xs={12} md={6}><StatCard label="今日完成" value={dash ? `${dash.today?.orderCount ?? 0} 单` : '—'} tint="#52c41a" /></Col>
            <Col xs={12} md={6}><StatCard label="本月业绩" value={overview ? yuan(overview.monthlyRevenue) : '—'} tint={BRAND.primary} /></Col>
            <Col xs={12} md={6}><StatCard label="今日客服发单" value={csStats?.summary ? `${csStats.summary.totalOrders ?? 0} 单` : '—'} sub={csStats?.summary ? yuan(csStats.summary.totalAmount) : undefined} tint="#722ed1" /></Col>
          </Row>
          <Card size="small" title="本月订单结构" style={{ marginBottom: 14 }}>
            <Row gutter={[8, 8]}>
              {Object.keys(TYPE_LABELS).map((k) => (
                <Col xs={12} md={6} key={k}>
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
        </>
      )}

      {/* ── 客户管理：客户消费 Top（含今日在打） ── */}
      {boardTab === 'customers' && (
        <Card size="small" title="客户消费 Top（含今日在打）">
          {custTop.length ? custTop.map((r: any, i: number) => (
            <div key={r.id || i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0', color: TEXT.heading }}>
              <span>{r.customerCode || r.wechatId || '客户'}{r.live ? <Tag color={BRAND.primary} style={{ marginLeft: 6, fontSize: 10 }}>在打</Tag> : null}</span>
              <span style={{ fontWeight: 600 }}>{yuan(r.spent)}</span>
            </div>
          )) : <Empty description="暂无客户数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </Card>
      )}

      {/* ── 陪玩状态墙 + 排行 / KPI（同一类：看人） ── */}
      {boardTab === 'live' && (
        <>
      <Card
        size="small"
        title="陪玩状态墙（状态 · 上下班 · 接单/娱乐/空闲/休息占比 · 业绩 · 成单 · KPI）"
        style={{ marginBottom: 14 }}
      >
        {displayRows.length ? (
          <Row gutter={[10, 10]}>
            {displayRows.map((r) => {
              const meta = STATUS_META[r.serving ? 'BUSY' : r.online ? r.status : 'OFFLINE'] || STATUS_META.OFFLINE;
              const s = r.serving;
              const partner = s?.partnerId ? liveRowById.get(s.partnerId) : null;
              const mainName = s?.role === 'CO' ? (partner?.name || s?.partnerName || '') : (r.name || '');
              const coName = s?.role === 'CO' ? (r.name || '') : (partner?.name || s?.partnerName || '');
              const servingType = s?.partnerName || s?.partnerId
                ? `双陪 · ${mainName}${coName ? ` + ${coName}` : ''}`
                : s?.role === 'CO' ? '双陪' : '单陪';
              const kpi = kpiById.get(r.companionId);
              return (
                <Col xs={24} sm={12} md={8} lg={6} key={r.companionId}>
                  <div style={{ border: `1px solid ${meta.color}33`, borderLeft: `4px solid ${meta.color}`, background: meta.bg, borderRadius: 10, padding: '8px 10px', height: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      <Tag color={meta.color} style={{ marginInlineEnd: 0, fontSize: 11 }}>{meta.label}</Tag>
                    </div>
                    <div style={{ fontSize: 11, color: TEXT.secondary, marginTop: 4, lineHeight: 1.5 }}>
                      上班 {r.loginAt ? dayjs(r.loginAt).format('HH:mm') : '—'}
                      {' · '}
                      {r.logoutAt ? `下班 ${dayjs(r.logoutAt).format('HH:mm')}` : r.online ? '在线中' : '未在线'}
                      {' · '}
                      在线 {hm(r.onlineSec)}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 5 }}>
                      {[
                        ['接单', r.modeSeconds?.BUSY || 0, '#F5222D'],
                        ['娱乐', r.modeSeconds?.ENTERTAINMENT || 0, '#FAAD14'],
                        ['空闲', r.modeSeconds?.AVAILABLE || 0, '#52C41A'],
                        ['休息', r.modeSeconds?.RESTING || 0, '#FA8C16'],
                      ].map(([label, sec, color]) => {
                        const secNum = Number(sec) || 0;
                        const ratio = r.onlineSec > 0 ? Math.min(100, Math.round((secNum / r.onlineSec) * 100)) : 0;
                        return (
                          <div key={String(label)} style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 10, color: TEXT.secondary, whiteSpace: 'nowrap' }}>{label} {hm(secNum)}</div>
                            <div style={{ height: 3, background: `${color}22`, borderRadius: 2, marginTop: 2 }}>
                              <div style={{ width: `${ratio}%`, height: 3, background: color as string, borderRadius: 2 }} />
                            </div>
                            <div style={{ fontSize: 9, color: TEXT.tertiary }}>{ratio}%</div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 11, color: TEXT.secondary, marginTop: 5, lineHeight: 1.5 }}>
                      业绩 {r.earningsHidden ? '—' : yuan(r.todayRevenue)} · 接单 {r.todayOrders || 0}
                      {' · '}<span style={{ color: SEMANTIC.success }}>成功 {r.successCount || 0}</span>
                      {' · '}<span style={{ color: r.failCount ? SEMANTIC.dangerDeep : TEXT.tertiary }}>失败 {r.failCount || 0}</span>
                      {' · '}今日KPI 成单率 {pct(r.successRate)}
                      {r.supplementCount ? <> · <Tag color="orange" style={{ fontSize: 10, marginInlineEnd: 0 }}>补单 {r.supplementCount}</Tag></> : null}
                    </div>
                    {r.serving ? (
                      <div style={{ fontSize: 12, color: '#334155', marginTop: 3, lineHeight: 1.5 }}>
                        {servingType} · {r.serving.gameName || '游戏'} · {hm(r.serving.elapsedSec)}
                      </div>
                    ) : null}
                    {r.failureReasons?.length ? (
                      <div style={{ fontSize: 10, color: SEMANTIC.dangerDeep, marginTop: 3, lineHeight: 1.4 }}>
                        失败原因：{r.failureReasons.map((x: any) => `${x.reason}×${x.count}`).join('；')}
                      </div>
                    ) : null}
                    {kpi ? (
                      <div style={{ fontSize: 10, color: TEXT.tertiary, marginTop: 3 }}>
                        30天 KPI：综合 {Math.round(kpi.score)} 分 · 首单 {pct(kpi.newRate)} · 续单 {pct(kpi.renewRate)} · 复购 {pct(kpi.repurchaseRate)}
                      </div>
                    ) : null}
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
              { label: '本月业绩', value: 'revenue' },
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
                  { title: '本月业绩', dataIndex: 'month', width: 96, render: (v: number) => yuan(v) },
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
        </>
      )}

      {/* ── 今日考勤（迟到 / 早退 / 未打卡） ── */}
      {boardTab === 'live' && attRows.length ? (
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
      {boardTab === 'cs' && csStats?.csList?.length ? (
        <Card size="small" title="客服管理 · 今日发单">
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
              {
                title: '桥接', dataIndex: 'bridgeCount', width: 90,
                render: (v: number, r: any) => (
                  <Button type="link" size="small" style={{ padding: 0 }} onClick={() => void openBridgeDetail(r)}>
                    {v} 单
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      ) : null}

      {bridgeDetail ? (() => {
        const orderRows: any[] = bridgeDetail.orders || [];
        const wechatMap = new Map<string, { wechat: string; count: number; amount: number }>();
        for (const o of orderRows) {
          const wechat = o.csWorkWechatName || o.customerPaidTo || o.customerPaymentAccountName || '未记录';
          const cur = wechatMap.get(wechat) || { wechat, count: 0, amount: 0 };
          cur.count += 1;
          cur.amount += Number(o.amount) || 0;
          wechatMap.set(wechat, cur);
        }
        const flowMap = new Map(bridgeFlow.map((w: any) => [String(w.wechatId || ''), w]));
        const wechatRows = [...wechatMap.values()].map((w) => {
          const flow: any = flowMap.get(w.wechat);
          return {
            ...w,
            today: flow ? Number(flow.inTotal) || 0 : null,
            balance: flow ? Number(flow.balance) || 0 : null,
          };
        });
        return (
          <Modal
            open
            width={1000}
            title={`桥接明细 · ${bridgeDetail.cs?.csName || bridgeDetail.cs?.csDisplayName || ''}`}
            onCancel={() => setBridgeDetail(null)}
            footer={null}
          >
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Text strong>
                桥接 {orderRows.length} 单 · 合计 {yuan(bridgeDetail.total)}
              </Text>
              {bridgeLoading ? <Text type="secondary">正在拉客服微信收款数据…</Text> : null}
              <Table
                size="small"
                rowKey="wechat"
                pagination={false}
                dataSource={wechatRows}
                columns={[
                  { title: '收款微信', dataIndex: 'wechat' },
                  { title: '桥接单数', dataIndex: 'count', width: 90 },
                  { title: '桥接金额', dataIndex: 'amount', width: 110, render: (v: number) => yuan(v) },
                  { title: '该微信今日收款', dataIndex: 'today', width: 130, render: (v: number | null) => (v == null ? '—' : yuan(v)) },
                  { title: '该微信当前余额', dataIndex: 'balance', width: 130, render: (v: number | null) => (v == null ? '—' : yuan(v)) },
                ]}
              />
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={orderRows}
                columns={[
                  { title: '订单号', dataIndex: 'orderCode', width: 80 },
                  { title: '游戏', dataIndex: 'gameName', width: 120 },
                  { title: '订单金额', dataIndex: 'amount', width: 100, render: (v: number) => yuan(v) },
                  { title: '收款微信', width: 150, render: (_: any, o: any) => o.csWorkWechatName || o.customerPaidTo || o.customerPaymentAccountName || '未记录' },
                  { title: '接单陪玩', dataIndex: 'companionName', width: 100, render: (v: string) => v || '-' },
                  { title: '陪玩工作室', dataIndex: 'companionStudio', width: 150, render: (v: string) => v || '-' },
                  { title: '时间', dataIndex: 'createdAt', width: 150, render: (v: string) => (v ? dayjs(v).format('MM-DD HH:mm') : '-') },
                ]}
              />
              {orderRows.length === 0 ? <Empty description="今天这个客服没有桥接单" /> : null}
            </Space>
          </Modal>
        );
      })() : null}
    </div>
  );
};

export default OperationsBoard;
