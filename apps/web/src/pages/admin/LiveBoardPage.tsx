// craftsman-ignore: TS001,TS002
/**
 * 实时看板（老板 2026-10-03）。
 *
 * 老板原话：「效果就跟网吧管理系统那样，几十个小人按照顺序排列，然后显示状态，
 * 然后注明谁在跟谁打什么、打了多久了、目前多少应该多少业绩了……让管理端一目了然。」
 *
 * 所以这一版做成「一人一格」的网格：
 *  - 顶上 5 个数（接单中 / 娱乐中 / 空闲 / 休息 / 离线），点一下只看这一类，再点一下看全部；
 *  - 下面按 接单中 → 娱乐中 → 空闲 → 休息 → 离线 的顺序，一格一个人排开；
 *  - 打单中那一格写清楚：在打什么游戏、跟谁一起、打了多久（本地每秒走字）、
 *    单号 / 客户编号、本单多少钱、今天已经多少业绩；
 *  - 离线的人灰掉，鼠标移上去看最后心跳时间。
 *
 * 数据每 15 秒拉一次；时长每秒本地走字，不用等下一次刷新。
 * 只有客户**编号**，没有客户微信 —— 看板是给派单用的，不是给谁抄客户的。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Badge, Button, Card, Spin, Tooltip, Typography, message } from 'antd';
import EmptyState from '../../components/EmptyState';
import { ReloadOutlined } from '@ant-design/icons';
import PageHeader from '../../components/PageHeader';
import { companionsApi } from '../../api/companions';
import { statusDotColor } from '../../constants/companions';
import { useAuthStore } from '../../stores/authStore';
import { BG, BORDER, TEXT } from '../../styles/tokens';

const { Text } = Typography;

interface ServingInfo {
  sessionId: string;
  orderId: string;
  orderCode: string;
  gameName: string;
  duration: number;
  customerCode: string;
  orderStudioName: string;
  startedAt: string;
  paused: boolean;
  elapsedSec: number;
  role: 'MAIN' | 'CO';
  partnerId?: string | null;
  partnerName: string;
  myAmount?: number | null;
}

interface BoardRow {
  companionId: string;
  name: string;
  username: string;
  avatar?: string | null;
  status: string;
  online: boolean;
  lastHeartbeat?: string | null;
  studioName: string;
  /** 今日业绩（元）—— 口径与结算一致（主陪扣搭档/分成、搭档拿 coAmount） */
  todayRevenue?: number;
  /** 今日已完成单数 */
  todayOrders?: number;
  /** 今日接单时长（分钟） */
  todayMinutes?: number;
  /** 桥接工作室的人（不是查看者本店）；只给订单信息，不给业绩 */
  isBridged?: boolean;
  /** 业绩对本查看者隐藏（桥接工作室；陪玩端看别人也隐藏） */
  earningsHidden?: boolean;
  serving: ServingInfo | null;
}

interface BoardData {
  rows: BoardRow[];
  updatedAt: string;
  counts?: { serving: number; entertainment: number; available: number; resting: number; offline: number };
}

const REFRESH_MS = 15_000;

type Bucket = 'serving' | 'entertainment' | 'available' | 'resting' | 'other' | 'offline';

const BUCKET_META: Array<{ key: Bucket; label: string; dot: string; color: string; bg: string }> = [
  { key: 'serving', label: '接单中', dot: '#EF4444', color: '#B91C1C', bg: '#FEF2F2' },
  { key: 'entertainment', label: '娱乐中', dot: '#F59E0B', color: '#B45309', bg: '#FFFBEB' },
  { key: 'available', label: '空闲', dot: '#22C55E', color: '#15803D', bg: '#F0FDF4' },
  { key: 'resting', label: '休息', dot: '#F97316', color: '#C2410C', bg: '#FFF7ED' },
  { key: 'offline', label: '离线', dot: TEXT.tertiary, color: TEXT.secondary, bg: BG.base },
];

function bucketOf(r: BoardRow): Bucket {
  // 有活跃会话就算「打单中」，客户端掉线也不藏起来（这一格会单独标「客户端已掉线」）。
  if (r.serving) return 'serving';
  if (!r.online) return 'offline';
  if (r.status === 'ENTERTAINMENT') return 'entertainment';
  if (r.status === 'AVAILABLE') return 'available';
  if (r.status === 'RESTING') return 'resting';
  return 'other';
}

/** 秒 → 「1小时23分」/「23分07秒」 */
function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}小时${String(m).padStart(2, '0')}分`;
  if (m > 0) return `${m}分${String(ss).padStart(2, '0')}秒`;
  return `${ss}秒`;
}

function money(v?: number | null): string {
  const n = Number(v || 0);
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const LiveBoardPage: React.FC = () => {
  const role = useAuthStore((st) => st.user?.role);
  const isCompanionViewer = role === 'COMPANION';
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [filter, setFilter] = useState<'all' | Bucket>('all');
  const fetchedAtRef = useRef<number>(Date.now());

  const fetchBoard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: res } = await companionsApi.liveBoard();
      const body = (res as any)?.data ?? res;
      setData(body?.rows ? body : { rows: [], updatedAt: new Date().toISOString() });
      fetchedAtRef.current = Date.now();
    } catch {
      if (!silent) message.error('看板加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBoard();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchBoard(true);
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchBoard]);

  // 时长本地走字：不刷新也能看到秒数在跳
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const rows = data?.rows || [];

  const grouped = useMemo(() => {
    const map: Record<Bucket, BoardRow[]> = {
      serving: [], entertainment: [], available: [], resting: [], other: [], offline: [],
    };
    for (const r of rows) map[bucketOf(r)].push(r);
    return map;
  }, [rows]);

  const visibleRows = useMemo(
    () => (filter === 'all' ? rows : grouped[filter]),
    [filter, rows, grouped],
  );

  const elapsedOf = (s: ServingInfo) =>
    s.paused ? s.elapsedSec : s.elapsedSec + (nowMs - fetchedAtRef.current) / 1000;

  const tile = (r: BoardRow) => {
    const b = bucketOf(r);
    const meta = BUCKET_META.find((m) => m.key === b);
    const s = r.serving;
    const offline = b === 'offline';
    const dot = meta ? meta.dot : TEXT.tertiary;
    const pillColor = meta ? meta.color : TEXT.heading;
    const pillBg = meta ? meta.bg : BORDER.secondary;
    const pillText = meta ? meta.label : '在线';

    const body = (
      <div
        key={r.companionId}
        style={{
          background: '#fff',
          border: '1px solid #E8ECF1',
          borderTop: `3px solid ${dot}`,
          borderRadius: 12,
          padding: '10px 12px 11px',
          opacity: offline ? 0.6 : 1,
          boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
        }}
      >
        {/* 头像 + 名字 + 状态 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge dot color={statusDotColor({ status: r.status, isOnline: r.online, lastHeartbeat: r.lastHeartbeat })}>
            <Avatar size={38} src={r.avatar || undefined} style={{ background: BORDER.base, color: '#334155', fontSize: 15 }}>
              {(r.name || '?').slice(0, 1)}
            </Avatar>
          </Badge>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.name || r.username || '未知'}
            </div>
            <div style={{ fontSize: 11, color: r.isBridged ? '#B45309' : TEXT.tertiary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.isBridged ? '🌉 桥接 · ' : ''}{r.studioName || '—'}
            </div>
          </div>
          <span
            style={{
              fontSize: 11, fontWeight: 600, color: pillColor, background: pillBg,
              border: `1px solid ${pillColor}33`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap',
            }}
          >
            {pillText}
          </span>
        </div>

        {/* 打单中：跟谁、打什么、多久 */}
        <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px dashed #E8ECF1', fontSize: 12, color: TEXT.heading, lineHeight: 1.75 }}>
          {s ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  🎮 {s.gameName || '未知游戏'}
                </span>
                <span style={{ fontWeight: 700, color: s.paused ? '#B45309' : '#B91C1C', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {s.paused ? '⏸ ' : ''}
                  {formatDuration(elapsedOf(s))}
                </span>
              </div>
              <div>
                👥 {s.partnerName ? (
                  <>
                    双陪 · 跟 <Text strong>{s.partnerName}</Text>
                  </>
                ) : (
                  s.role === 'CO' ? '双陪' : '单陪'
                )}
              </div>
              <div style={{ color: TEXT.tertiary }}>
                {s.orderCode ? `📄 ${s.orderCode}` : ''}
                {s.customerCode ? `${s.orderCode ? ' · ' : ''}客户 ${s.customerCode}` : ''}
              </div>
              {!r.online ? (
                <div style={{ color: '#B91C1C' }}>⚠ 客户端已掉线（这单还在进行）</div>
              ) : null}
            </>
          ) : (
            <div style={{ color: TEXT.tertiary }}>{offline ? '电脑没在跑客户端' : '没在打单'}</div>
          )}
        </div>

        {/* 业绩 / 工作量：桥接工作室的人、以及陪玩端看别人，都只给订单信息，不给挣了多少 */}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
          {r.earningsHidden ? (
            <span style={{ color: TEXT.tertiary }}>
              今日 {r.todayOrders || 0}单
              {r.todayMinutes ? <span> · 接单 {formatDuration((r.todayMinutes || 0) * 60)}</span> : null}
              <span style={{ marginLeft: 6 }}>🔒 业绩不公开</span>
            </span>
          ) : (
            <span style={{ color: TEXT.secondary }}>
              今日 <Text strong style={{ color: '#0F172A' }}>¥{money(r.todayRevenue)}</Text>
              {r.todayOrders ? <span style={{ color: TEXT.tertiary }}> · {r.todayOrders}单</span> : null}
              {r.todayMinutes ? <span style={{ color: TEXT.tertiary }}> · 接单 {formatDuration((r.todayMinutes || 0) * 60)}</span> : null}
            </span>
          )}
          {!r.earningsHidden && s && s.myAmount != null ? (
            <span style={{ color: TEXT.secondary, whiteSpace: 'nowrap' }}>
              本单 <Text strong style={{ color: '#0F172A' }}>¥{money(s.myAmount)}</Text>
            </span>
          ) : null}
        </div>
      </div>
    );

    if (!offline) return body;
    return (
      <Tooltip
        key={r.companionId}
        title={r.lastHeartbeat ? `最后心跳 ${new Date(r.lastHeartbeat).toLocaleString('zh-CN')}` : '从来没上报过心跳'}
      >
        {body}
      </Tooltip>
    );
  };

  return (
    <>
      <PageHeader
        title="实时看板"
        subtitle={
          isCompanionViewer
            ? '谁在跟谁打什么、打了多久、谁快打完了 —— 想预约搭档就照着这一格去找；🌉 是桥接工作室的人，只显示订单信息（每 15 秒自动刷新）'
            : '一人一格：谁在跟谁打什么、打了多久、今天多少业绩 —— 一眼看全（每 15 秒自动刷新）'
        }
        extra={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {data?.updatedAt ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                更新于 {new Date(data.updatedAt).toLocaleTimeString('zh-CN')}
              </Text>
            ) : null}
            <Button icon={<ReloadOutlined />} onClick={() => void fetchBoard()} loading={loading}>
              刷新
            </Button>
          </div>
        }
      />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {BUCKET_META.map((m) => {
          const active = filter === m.key;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setFilter(active ? 'all' : m.key)}
              title={active ? '再点一下看全部' : `只看${m.label}`}
              style={{
                flex: '1 1 120px', minWidth: 110, textAlign: 'left', cursor: 'pointer',
                padding: '10px 14px', borderRadius: 10, background: m.bg,
                border: active ? `1px solid ${m.color}` : `1px solid ${m.color}22`,
                boxShadow: active ? `0 0 0 2px ${m.color}22` : 'none',
                font: 'inherit',
              }}
            >
              <div style={{ fontSize: 12, color: TEXT.secondary }}>
                {m.label}
                {active ? ' · 只看' : ''}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: m.color, fontVariantNumeric: 'tabular-nums' }}>
                {grouped[m.key].length}
              </div>
            </button>
          );
        })}
      </div>

      {loading && !data ? (
        <Card size="small">
          {/* 「加载中」不能用空态画（空态是「没数据」，不是「还没来」）—— 统一用 Spin */}
          <div style={{ textAlign: 'center', padding: 50 }}><Spin /></div>
        </Card>
      ) : rows.length === 0 ? (
        <Card size="small">
          <EmptyState description="本店还没有陪玩" />
        </Card>
      ) : visibleRows.length === 0 ? (
        <Card size="small">
          <EmptyState description="这一类现在没有人" />
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))' }}>
          {visibleRows.map(tile)}
        </div>
      )}
    </>
  );
};

export default LiveBoardPage;
