// craftsman-ignore: TS001,TS002,TS003
import React, { useCallback, useEffect, useState } from 'react';
import { Card, Row, Col, Tag, Progress, Table, Empty, Button, Typography, Segmented, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import http from '../../api/client';
import CardSkeleton from '../../components/CardSkeleton';

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
  RESTING: { label: '休息', color: '#faad14', bg: '#FFF7E6' },
  OFFLINE: { label: '离线', color: '#94a3b8', bg: '#F1F5F9' },
};
const TIER_META: Record<string, { label: string; color: string }> = {
  TOP: { label: '上等马', color: '#d4a017' },
  MIDDLE: { label: '中等马', color: '#1677ff' },
  LOW: { label: '下等马', color: '#8c8c8c' },
};

const Kpi: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; tint: string }> = ({ label, value, sub, tint }) => (
  <div className="ui-panel" style={{ position: 'relative', overflow: 'hidden', padding: '12px 14px', height: '100%' }}>
    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: `linear-gradient(180deg, ${tint}, ${tint}66)` }} />
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#64748B' }}>
      <span style={{ width: 6, height: 6, borderRadius: 2, background: tint }} />
      {label}
    </div>
    <div style={{ marginTop: 4, fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px', lineHeight: 1.25, color: tint }}>{value}</div>
    {sub ? <div style={{ marginTop: 2, fontSize: 12, color: '#94a3b8' }}>{sub}</div> : null}
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode; extra?: React.ReactNode }> = ({ children, extra }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 10px' }}>
    <Text strong style={{ fontSize: 15 }}>{children}</Text>
    {extra}
  </div>
);

/** 一行「名字 + 进度条 + 数值」：老板要的进度条样式，从高到低排。 */
const RankBar: React.FC<{ name: string; value: number; max: number; text: string; color: string }> = ({ name, value, max, text, color }) => {
  const p = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      <span style={{ width: 62, fontSize: 12, color: '#475569', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
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
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [dash, setDash] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [live, setLive] = useState<any>(null);
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [cust, setCust] = useState<any>(null);
  const [csStats, setCsStats] = useState<any>(null);
  const [rankMode, setRankMode] = useState<'score' | 'revenue' | 'customer'>('score');

  const load = useCallback(async () => {
    const today = dayjs().format('YYYY-MM-DD');
    const [d, o, t, l, p, c, s] = await Promise.all([
      safeGet('/dashboard'),
      safeGet('/dashboard/revenue-overview'),
      safeGet('/dashboard/trend', { days: 14 }),
      safeGet('/companions/live-board'),
      safeGet('/personnel'),
      safeGet('/customers/board'),
      safeGet('/stats/daily', { date: today, dateFrom: today, dateTo: today }),
    ]);
    setDash(d);
    setOverview(o);
    setTrend(Array.isArray(t) ? t : []);
    setLive(l);
    setPersonnel(Array.isArray(p) ? p : []);
    setCust(c);
    setCsStats(s);
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

  const custTop = [...(cust?.rows || [])]
    .sort((a: any, b: any) => (Number(b.spent) || 0) - (Number(a.spent) || 0))
    .slice(0, 8);

  return (
    <div>
      <SectionTitle
        extra={
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              每 60 秒自动刷新 · {dayjs().format('HH:mm')}
            </Text>
            <Button size="small" icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          </Space>
        }
      >
        📊 运营看板{compact ? '' : ' · 老板 / 店长'}
      </SectionTitle>

      {/* ── KPI ── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={12} md={4}><Kpi label="今日流水" value={dash ? yuan(dash.today?.totalRevenue) : '—'} tint="#1677ff" /></Col>
        <Col xs={12} md={4}><Kpi label="本月流水" value={overview ? yuan(overview.monthlyRevenue) : '—'} tint="#52c41a" /></Col>
        <Col xs={12} md={4}><Kpi label="今日单量" value={dash ? `${dash.today?.orderCount ?? 0} 单` : '—'} sub={dash ? `接单率 ${pct(dash.today?.acceptRate)}` : undefined} tint="#faad14" /></Col>
        <Col xs={12} md={4}><Kpi label="在线陪玩" value={dash ? `${dash.today?.onlineCount ?? 0} / ${dash.today?.totalCount ?? 0}` : '—'} sub={`打单中 ${servingCount} 人`} tint="#722ed1" /></Col>
        <Col xs={12} md={4}><Kpi label="今日娱乐费" value={dash ? yuan(dash.today?.entertainmentFee) : '—'} tint="#13c2c2" /></Col>
        <Col xs={12} md={4}>
          <Kpi
            label="客户"
            value={counts ? `${counts.customers ?? 0} 个` : '—'}
            sub={counts ? `今日消费 ${yuan(counts.todaySpentTotal)} · 在打 ${counts.serving ?? 0}` : undefined}
            tint="#eb2f96"
          />
        </Col>
      </Row>

      {/* ── 图表 ── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={24} lg={15}>
          <Card size="small" title="近 14 天流水" styles={{ body: { paddingTop: 8 } }}>
            {trendData.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={trendData} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `¥${v}`} />
                  <Tooltip formatter={(v: any) => [`¥${Number(v).toFixed(1)}`, '流水']} />
                  <Bar dataKey="revenue" fill="#1677ff" radius={[4, 4, 0, 0]} maxBarSize={26}>
                    <LabelList dataKey="revenue" position="top" formatter={(v: any) => (Number(v) > 0 ? Number(v).toFixed(0) : '')} style={{ fontSize: 10, fill: '#94a3b8' }} />
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
                  <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 12, color: '#64748B' }}>
                      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 2, background: TYPE_COLORS[k], marginRight: 6 }} />
                      {TYPE_LABELS[k]}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: TYPE_COLORS[k] }}>{yuan(typeBreak[k] || 0)}</div>
                  </div>
                </Col>
              ))}
            </Row>
            {csStats?.summary ? (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #e2e8f0', fontSize: 12, color: '#475569' }}>
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
        extra={<Button size="small" type="link" onClick={() => navigate(compact ? '/cs/live-board' : '/admin/live-board')}>打开实时看板</Button>}
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
                        {r.serving.role === 'CO' ? '搭档' : '主陪'}：{r.serving.partnerName || '（找搭档中）'}<br />
                        {r.serving.gameName || '游戏'} · {hm(r.serving.elapsedSec)}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: '#64748B', marginTop: 4, lineHeight: 1.5 }}>
                        今日 {r.todayOrders || 0} 单 · {r.earningsHidden ? '—' : yuan(r.todayRevenue)}<br />
                        工时 {r.todayMinutes || 0} 分钟
                      </div>
                    )}
                    {r.isBridged ? <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>桥接 · {r.studioName}</div> : null}
                  </div>
                </Col>
              );
            })}
          </Row>
        ) : <Empty description="暂无陪玩数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      </Card>

      {/* ── 排行榜 ── */}
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
          ? topByScore.map((r) => <RankBar key={r.id} name={r.name} value={r.score} max={100} text={`${r.score} 分`} color={TIER_META[r.tier]?.color || '#1677ff'} />)
          : <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />)}
        {rankMode === 'revenue' && (topByRevenue.length
          ? topByRevenue.map((r) => <RankBar key={r.id} name={r.name} value={r.month} max={maxRev} text={yuan(r.month)} color="#52c41a" />)
          : <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />)}
        {rankMode === 'customer' && (byCustomer.length
          ? byCustomer.map((r) => <RankBar key={r.id} name={r.name} value={r.customers} max={maxCust} text={`${r.customers} 个`} color="#eb2f96" />)
          : <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />)}
      </Card>

      {/* ── 质量榜 + 最该关注的 ── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
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
                        <Tag color={TIER_META[r.tier]?.color} style={{ fontSize: 10, marginInlineEnd: 0 }}>{TIER_META[r.tier]?.label || r.tier}</Tag>
                        {!r.online ? <Tag style={{ fontSize: 10, marginInlineEnd: 0 }}>离线</Tag> : null}
                      </Space>
                    ),
                  },
                  {
                    title: '综合分', dataIndex: 'score', width: 110,
                    render: (v: number) => <Progress percent={Math.min(100, v)} size="small" strokeColor="#1677ff" format={() => `${v}`} />,
                  },
                  { title: '首单成功率', dataIndex: 'newRate', width: 100, render: (v: number) => <span style={{ color: v < 50 ? '#cf1322' : '#3f8600', fontWeight: 600 }}>{pct(v)}</span> },
                  { title: '续单率', dataIndex: 'renewRate', width: 84, render: (v: number) => pct(v) },
                  { title: '复购率', dataIndex: 'repurchaseRate', width: 84, render: (v: number) => pct(v) },
                  { title: '成单', dataIndex: 'orders', width: 64 },
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
              <RankBar key={r.id} name={r.name} value={r.newRate} max={100} text={`${pct(r.newRate)} · ${r.orders}单`} color={r.newRate < 50 ? '#cf1322' : '#faad14'} />
            )) : <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
          <Card size="small" title="客户消费 Top（含今日在打）">
            {custTop.length ? custTop.map((r: any, i: number) => (
              <div key={r.id || i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: '#475569' }}>
                <span>{r.customerCode || r.wechatId || '客户'}{r.live ? <Tag color="#1677ff" style={{ marginLeft: 6, fontSize: 10 }}>在打</Tag> : null}</span>
                <span style={{ fontWeight: 600 }}>{yuan(r.spent)}</span>
              </div>
            )) : <Empty description="暂无客户数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>
      </Row>

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
