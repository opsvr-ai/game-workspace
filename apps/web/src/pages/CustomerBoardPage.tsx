// craftsman-ignore: TS001,TS002
/**
 * 客户看板（老板 2026-10-03）。
 *
 * 老板原话：「店长端 + 陪玩端 加一个看板，罗列所有的客户，每个客户的消费情况 +
 * 是不是正在跟陪玩打游戏，都列出来，消费金额或者游戏时长或者正在跟陪玩打的排在最上边……
 * 店长需要掌控并知道每个陪玩什么样、每个陪玩的客户现在什么样，要一个动态看板，
 * 让所有人都能一目了然知道自己的陪玩或者自己的客户到底什么样。」
 *
 * 三块内容：
 *  ① 顶部 5 个数：客户总数 / 正在打 / 累计消费 / 累计时长 / 陪玩数；
 *  ② 陪玩这一排：每个陪玩一张小卡（状态点 + 在线 + 名下客户数 + 消费 + 时长 +
 *     此刻正在给哪个客户打什么），点一下只看这个陪玩的客户，再点一下取消；
 *  ③ 客户表：「总表」按规则排（默认 正在打 → 消费金额 → 游戏时长 → 最近一单），
 *     也能切「按陪玩分组」，一个陪玩一段、各带一张小表 —— 店长巡视用这个最顺手。
 *
 * 可见范围由服务端定：陪玩只有自己的客户，店长 / 客服本店，老板全站。
 * 客户来源（来源平台 / 引流账号）服务端已经抹掉了；**微信号这一页默认打码**，
 * 右上角「显示微信号」开关能立刻显形（看板常年挂在墙上的话就保持关着）。
 * 数据 15 秒拉一次；正在打的计时每秒本地走字，不用等刷新。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Empty,
  Input,
  Segmented,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import { customersApi } from '../api/customers';
import CustomerProfileDrawer from '../components/CustomerProfileDrawer';
import { useAuthStore } from '../stores/authStore';
import { companionStatusConfig, customerStatusConfig } from '../constants';

const { Text } = Typography;

interface BoardLive {
  sessionId: string;
  orderId: string;
  orderCode: string;
  gameName: string;
  orderStudioName: string;
  startedAt: string;
  paused: boolean;
  elapsedSec: number;
  plannedHours: number;
  mainCompanionId: string | null;
  mainCompanionName: string;
  coCompanionId: string | null;
  coCompanionName: string;
  partnerId: string | null;
  partnerName: string;
  servingCompanionId: string | null;
  servingCompanionName: string;
  role: string;
}

interface BoardRow {
  customerId: string;
  studioId: string;
  studioName: string;
  customerCode: string;
  wechatId: string;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
  depositBalance: number;
  platform: string;
  platformAccount: string;
  companionId: string | null;
  companionName: string;
  companionAvatar: string | null;
  companionStatus: string | null;
  companionOnline: boolean;
  companionResigned: boolean;
  servedBy: number;
  topMode: string;
  orderCount: number;
  spent: number;
  hours: number;
  todaySpent: number;
  todayOrders: number;
  todayHours: number;
  lastOrderAt: string | null;
  lastDoneAt: string | null;
  live: BoardLive | null;
}

interface BoardCompanion {
  companionId: string;
  name: string;
  username: string;
  avatar: string | null;
  status: string;
  online: boolean;
  resigned: boolean;
  customers: number;
  spent: number;
  hours: number;
  servingCustomer: {
    customerId: string;
    customerCode: string;
    gameName: string;
    orderCode: string;
    paused: boolean;
    elapsedSec: number;
  } | null;
}

interface BoardCounts {
  customers: number;
  serving: number;
  spentTotal: number;
  todaySpentTotal: number;
  hoursTotal: number;
  companions: number;
  unassigned: number;
}

interface BoardData {
  rows: BoardRow[];
  companions: BoardCompanion[];
  counts: BoardCounts;
  scope: string;
  updatedAt: string;
}

const REFRESH_MS = 15_000;

/** 秒 → 「1小时23分」/「23分07秒」 */
function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return h + '小时' + String(m).padStart(2, '0') + '分';
  if (m > 0) return m + '分' + String(ss).padStart(2, '0') + '秒';
  return ss + '秒';
}

/** 小时数 → 「3.5 小时」/「45 分钟」 */
function fmtHours(h: number): string {
  const v = Number(h) || 0;
  if (v <= 0) return '—';
  if (v < 1) return Math.round(v * 60) + ' 分钟';
  return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') + ' 小时';
}

function yuan(n: number): string {
  const v = Number(n) || 0;
  return '¥' + v.toFixed(1).replace(/\.0$/, '');
}

/** 时间 → 「今天 14:32」「昨天 09:10」「3 天前」「09-20」 */
function fmtWhen(iso?: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  const now = new Date();
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((day0 - day) / 86_400_000);
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (diffDays === 0) return '今天 ' + hm;
  if (diffDays === 1) return '昨天 ' + hm;
  if (diffDays > 1 && diffDays < 30) return diffDays + ' 天前';
  return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** 预约上号时间 → 「10-04 20:00」 */
function fmtSchedule(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return (
    String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') +
    ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  );
}

function maskWechat(v: string): string {
  if (!v) return '—';
  return '••••••';
}

/** 「正在打」那一行的呼吸底色 + 小红点（老板要的「一闪一闪」）。 */
function ensureBoardStyle(): void {
  if (document.getElementById('chunlv-customer-board-style')) return;
  const st = document.createElement('style');
  st.id = 'chunlv-customer-board-style';
  st.textContent = [
    '@keyframes chunlvBoardLivePulse{0%,100%{background:rgba(220,38,38,.05)}50%{background:rgba(220,38,38,.15)}}',
    '.chunlv-board-live > td{animation:chunlvBoardLivePulse 2.8s ease-in-out infinite}',
    '@keyframes chunlvBoardDot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.65)}}',
    '.chunlv-board-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#DC2626;margin-right:5px;vertical-align:middle;animation:chunlvBoardDot 1.4s ease-in-out infinite}',
  ].join('');
  document.head.appendChild(st);
}

const CustomerBoardPage: React.FC = () => {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const isCompanion = role === 'COMPANION';
  const prefix =
    role === 'OWNER' ? 'owner' : role === 'ADMIN' ? 'admin' : role === 'CS' ? 'cs' : 'companion';

  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(false);
  // 陪玩端默认「累计消费」从高到低（老板 2026-10-04：「给陪玩做成进度条样式的吧，从高到低排列」）
  const [sort, setSort] = useState<'live' | 'spent' | 'today' | 'hours' | 'recent'>(
    role === 'COMPANION' ? 'spent' : 'live',
  );
  const [view, setView] = useState<'flat' | 'byCompanion'>('flat');
  const [showWechat, setShowWechat] = useState(false);
  const [search, setSearch] = useState('');
  const [focusCompanion, setFocusCompanion] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const fetchedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    ensureBoardStyle();
  }, []);

  const fetchBoard = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const { data: res } = await customersApi.board({ sort });
        const body = (res as any)?.data ?? res;
        setData({
          rows: body?.rows || [],
          companions: body?.companions || [],
          counts:
            body?.counts ||
            { customers: 0, serving: 0, spentTotal: 0, todaySpentTotal: 0, hoursTotal: 0, companions: 0, unassigned: 0 },
          scope: body?.scope || '',
          updatedAt: body?.updatedAt || new Date().toISOString(),
        });
        fetchedAtRef.current = Date.now();
      } catch {
        if (!silent) message.error('客户看板加载失败');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [sort],
  );

  useEffect(() => {
    void fetchBoard();
  }, [fetchBoard]);

  // 15 秒拉一次（页面不在前台就不拉）
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchBoard(true);
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchBoard]);

  // 正在打的计时本地走字
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const rows = data?.rows || [];
  const companions = data?.companions || [];
  const counts = data?.counts;

  const elapsedOf = (live: BoardLive) => {
    if (live.paused) return live.elapsedSec;
    return live.elapsedSec + Math.max(0, Math.floor((nowMs - fetchedAtRef.current) / 1000));
  };

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (focusCompanion && r.companionId !== focusCompanion) return false;
      if (!kw) return true;
      const hay = [r.customerCode, r.wechatId, r.companionName, r.platform, r.platformAccount]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(kw);
    });
  }, [rows, search, focusCompanion]);

  const statusTag = (r: BoardRow) => {
    const cfg = customerStatusConfig[r.status];
    return (
      <span style={{ color: cfg ? undefined : '#475569' }}>
        <Tag color={cfg?.color || 'default'} style={{ marginInlineEnd: 0 }}>
          {cfg?.label || r.status || '-'}
        </Tag>
      </span>
    );
  };

  const companionTag = (r: BoardRow) => {
    if (!r.companionId) return <Text type="secondary">未分配</Text>;
    const cfg = companionStatusConfig[r.companionStatus || 'OFFLINE'];
    return (
      <Space size={6}>
        <Avatar size={22} src={r.companionAvatar || undefined}>
          {(r.companionName || '?').slice(0, 1)}
        </Avatar>
        <span>{r.companionName || '—'}</span>
        <Tooltip title={cfg?.label || ''}>
          <Badge
            status="processing"
            color={
              !r.companionOnline
                ? '#94A3B8'
                : r.companionStatus === 'AVAILABLE'
                  ? '#16A34A'
                  : r.companionStatus === 'ENTERTAINMENT'
                    ? '#F59E0B'
                    : r.companionStatus === 'RESTING'
                      ? '#C2410C'
                      : '#DC2626'
            }
          />
        </Tooltip>
        <span style={{ fontSize: 11, color: '#94A3B8' }}>{cfg?.label || ''}</span>
        {r.companionResigned ? <Tag color="default">已离职</Tag> : null}
      </Space>
    );
  };

  const nowCell = (r: BoardRow) => {
    if (!r.live) {
      return (
        <span style={{ fontSize: 12, color: '#94A3B8' }}>
          {r.lastOrderAt ? '最近 ' + fmtWhen(r.lastOrderAt) : '还没打过'}
        </span>
      );
    }
    const live = r.live;
    return (
      <div style={{ lineHeight: 1.5 }}>
        <div>
          <span className="chunlv-board-dot" />
          <Text strong style={{ color: '#B91C1C' }}>
            {live.gameName || '游戏中'}
          </Text>
          {live.orderCode ? <span style={{ fontSize: 11, color: '#94A3B8' }}> · 单号 {live.orderCode}</span> : null}
        </div>
        <div style={{ fontSize: 12, color: '#475569' }}>
          {live.paused ? '⏸ 暂停中' : '已打 ' + fmtDuration(elapsedOf(live))}
          {live.servingCompanionName ? ' · 陪玩 ' + live.servingCompanionName : ''}
          {live.partnerName ? ' · 搭档 ' + live.partnerName : ''}
        </div>
      </div>
    );
  };

  const columns: any[] = [
    {
      title: '客户',
      dataIndex: 'customerCode',
      key: 'customerCode',
      width: 190,
      render: (_: any, r: BoardRow) => (
        <div style={{ lineHeight: 1.5 }}>
          <Space size={6}>
            <Text strong>{r.customerCode}</Text>
            {statusTag(r)}
          </Space>
          <div style={{ fontSize: 12, color: '#475569' }}>
            <Tooltip title={showWechat ? '' : '已打码：右上角「显示微信号」可展开'}>
              <span>{showWechat ? r.wechatId || '—' : maskWechat(r.wechatId)}</span>
            </Tooltip>
            {r.depositBalance ? <span style={{ color: '#15803D' }}>{' · 存款 ' + yuan(r.depositBalance)}</span> : null}
            {fmtSchedule(r.scheduledAt) ? <span style={{ color: '#B45309' }}>{' · 预约 ' + fmtSchedule(r.scheduledAt)}</span> : null}
          </div>
          {r.servedBy > 0 ? (
            <div style={{ fontSize: 12 }}>
              {r.servedBy > 1 ? (
                <Tag color="purple" style={{ marginInlineEnd: 4 }}>{r.servedBy} 人打过</Tag>
              ) : null}
              {r.topMode && r.topMode !== '未知' ? (
                <span style={{ color: '#7C3AED' }}>常打{r.topMode}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: '归属陪玩',
      key: 'companion',
      width: 210,
      render: (_: any, r: BoardRow) => companionTag(r),
    },
    {
      title: '现在在干什么',
      key: 'now',
      render: (_: any, r: BoardRow) => nowCell(r),
    },
    {
      title: '消费金额',
      dataIndex: 'spent',
      key: 'spent',
      width: 100,
      align: 'right',
      render: (v: number, r: BoardRow) => (
        <Tooltip title={r.orderCount ? '累计已完成 ' + r.orderCount + ' 单（口径同盈亏统计）' : '还没有已完成的单'}>
          <span style={{ color: v > 0 ? '#B91C1C' : '#94A3B8', fontWeight: v > 0 ? 600 : 400 }}>{yuan(v)}</span>
        </Tooltip>
      ),
    },
    {
      title: '今日（营业日）',
      key: 'today',
      width: 122,
      align: 'right',
      render: (_: any, r: BoardRow) =>
        r.todaySpent || r.todayOrders || r.todayHours ? (
          <Tooltip title={'今日 ' + r.todayOrders + ' 单 · 今日时长 ' + fmtHours(r.todayHours) + '（营业日 12:00 起算，与实时看板同口径）'}>
            <div style={{ lineHeight: 1.4 }}>
              <div style={{ color: '#B91C1C', fontWeight: 600 }}>{yuan(r.todaySpent)}</div>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>
                {r.todayOrders ? r.todayOrders + ' 单' : ''}
                {r.todayHours ? (r.todayOrders ? ' · ' : '') + fmtHours(r.todayHours) : ''}
              </div>
            </div>
          </Tooltip>
        ) : (
          <span style={{ color: '#CBD5E1', fontSize: 12 }}>—</span>
        ),
    },
    {
      title: '完成单数',
      dataIndex: 'orderCount',
      key: 'orderCount',
      width: 82,
      align: 'right',
      render: (v: number) => (v ? String(v) : <span style={{ color: '#94A3B8' }}>0</span>),
    },
    {
      title: '累计时长',
      dataIndex: 'hours',
      key: 'hours',
      width: 98,
      align: 'right',
      render: (v: number) => (v ? fmtHours(v) : <span style={{ color: '#94A3B8' }}>—</span>),
    },
    {
      title: '最近一单',
      dataIndex: 'lastOrderAt',
      key: 'lastOrderAt',
      width: 96,
      render: (v: string | null) => <span style={{ fontSize: 12, color: '#64748B' }}>{fmtWhen(v)}</span>,
    },
    {
      title: '',
      key: 'op',
      width: 116,
      render: (_: any, r: BoardRow) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 4 }}
            onClick={() => setProfileId(r.customerId)}
          >
            画像
          </Button>
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 4 }}
            onClick={() => navigate('/' + prefix + '/customers/' + r.customerId)}
          >
            详情
          </Button>
        </Space>
      ),
    },
  ];

  const tableFor = (list: BoardRow[]) => (
    <Table
      rowKey="customerId"
      size="small"
      columns={columns}
      dataSource={list}
      pagination={list.length > 50 ? { pageSize: 50, size: 'small' } : false}
      rowClassName={(r: BoardRow) => (r.live ? 'chunlv-board-live' : '')}
      locale={{
        emptyText: (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={focusCompanion ? '这个陪玩名下还没有客户' : '还没有客户'}
          />
        ),
      }}
    />
  );

  // ── 陪玩端：客户排行榜（进度条形态，从高到低）────────────────────────────
  // 老板 2026-10-04：「给陪玩做成进度条样式的吧，从高到低排列」。
  const barValue = (r: BoardRow) =>
    sort === 'today' ? Number(r.todaySpent) || 0 : sort === 'hours' ? Number(r.hours) || 0 : Number(r.spent) || 0;
  const barLabel = sort === 'today' ? '今日消费' : sort === 'hours' ? '游戏时长' : '累计消费';

  const rankRows = useMemo(() => {
    const val = (r: BoardRow) =>
      sort === 'today' ? Number(r.todaySpent) || 0 : sort === 'hours' ? Number(r.hours) || 0 : Number(r.spent) || 0;
    return [...filtered].sort((a, b) => val(b) - val(a));
  }, [filtered, sort]);

  const barMax = rankRows.reduce((m, r) => Math.max(m, barValue(r)), 0) || 1;

  const barList = (
    <div>
      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>
        按「{barLabel}」从高到低排列，条形越长 = {barLabel}越高；点任意一行看客户详情，点「客户喜好」看他爱打机密还是绝密、习惯什么单价。
      </div>
      {rankRows.map((r, i) => {
        const v = barValue(r);
        const pct = v > 0 ? Math.max(4, Math.round((v / barMax) * 100)) : 0;
        const live = r.live;
        return (
          <div
            key={r.customerId}
            onClick={() => navigate('/' + prefix + '/customers/' + r.customerId)}
            style={{
              position: 'relative',
              marginBottom: 8,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid ' + (live ? '#FECACA' : '#EEF2F6'),
              background: '#fff',
              cursor: 'pointer',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: pct + '%',
                background: live
                  ? 'linear-gradient(90deg, rgba(220,38,38,.18), rgba(220,38,38,.04))'
                  : 'linear-gradient(90deg, rgba(37,99,235,.16), rgba(37,99,235,.03))',
                transition: 'width .4s ease',
              }}
            />
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span
                style={{
                  width: 26,
                  textAlign: 'center',
                  fontWeight: 700,
                  fontSize: i < 3 ? 16 : 13,
                  color: i === 0 ? '#D97706' : i === 1 ? '#64748B' : i === 2 ? '#B45309' : '#94A3B8',
                }}
              >
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
              </span>
              <div style={{ minWidth: 150 }}>
                <Space size={6}>
                  <Text strong>{r.customerCode}</Text>
                  {statusTag(r)}
                  {live ? <Tag color="red" style={{ marginInlineEnd: 0 }}>🎮 正在打</Tag> : null}
                  {/* 老板 2026-10-04：陪玩端不显示「N 人打过」—— 不暴露「跟谁打过」。 */}
                  {r.topMode && r.topMode !== '未知' ? (
                    <span style={{ fontSize: 11, color: '#7C3AED' }}>常打{r.topMode}</span>
                  ) : null}
                </Space>
                <div style={{ fontSize: 12, color: '#64748B' }}>
                  <Tooltip title={showWechat ? '' : '已打码：右上角「显示微信号」可展开'}>
                    <span>{showWechat ? r.wechatId || '—' : maskWechat(r.wechatId)}</span>
                  </Tooltip>
                  {r.depositBalance ? <span style={{ color: '#15803D' }}>{' · 存款 ' + yuan(r.depositBalance)}</span> : null}
                  {fmtSchedule(r.scheduledAt) ? (
                    <span style={{ color: '#B45309' }}>{' · 预约 ' + fmtSchedule(r.scheduledAt)}</span>
                  ) : null}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 170, fontSize: 12, color: '#475569' }}>
                {live ? (
                  <span>
                    <span className="chunlv-board-dot" />
                    <Text strong style={{ color: '#B91C1C' }}>{live.gameName || '游戏中'}</Text>
                    {live.paused ? ' · ⏸ 暂停中' : ' · 已打 ' + fmtDuration(elapsedOf(live))}
                    {live.partnerName ? ' · 搭档 ' + live.partnerName : ''}
                  </span>
                ) : (
                  <span style={{ color: '#94A3B8' }}>{r.lastOrderAt ? '最近 ' + fmtWhen(r.lastOrderAt) : '还没打过'}</span>
                )}
              </div>
              <div style={{ textAlign: 'right', minWidth: 104 }}>
                <div
                  style={{
                    fontSize: 17,
                    fontWeight: 700,
                    color: v > 0 ? '#B91C1C' : '#94A3B8',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {sort === 'hours' ? fmtHours(v) : yuan(v)}
                </div>
                <div style={{ fontSize: 11, color: '#94A3B8' }}>
                  {'今日 ' + yuan(r.todaySpent) + ' · ' + (r.orderCount || 0) + ' 单 · ' + fmtHours(r.hours)}
                </div>
                {/* 老板 2026-10-04：陪玩端只给「客户喜好」（爱打机密/绝密、习惯单价），
                    不显示「跟谁打过」—— 抽屉里不会有其他陪玩 / 工作微信 / 收入，
                    服务端返回的陪玩画像也不含这些字段。 */}
                <div style={{ marginTop: 4 }}>
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: 18, fontSize: 12 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setProfileId(r.customerId);
                    }}
                  >
                    客户喜好
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  const companionCard = (c: BoardCompanion) => {
    const cfg = companionStatusConfig[c.status] || companionStatusConfig.OFFLINE;
    const active = focusCompanion === c.companionId;
    return (
      <Card
        key={c.companionId}
        size="small"
        onClick={() => setFocusCompanion(active ? null : c.companionId)}
        style={{
          width: 232,
          cursor: 'pointer',
          borderColor: active ? '#1677FF' : c.servingCustomer ? '#FCA5A5' : undefined,
          background: active ? '#F0F7FF' : c.servingCustomer ? '#FEF2F2' : undefined,
        }}
        bodyStyle={{ padding: 10 }}
      >
        <Space size={8} align="start">
          <Badge
            dot
            color={!c.online ? '#94A3B8' : c.status === 'AVAILABLE' ? '#16A34A' : c.status === 'BUSY' ? '#DC2626' : c.status === 'ENTERTAINMENT' ? '#F59E0B' : '#C2410C'}
            offset={[-2, 22]}
          >
            <Avatar size={30} src={c.avatar || undefined}>
              {(c.name || '?').slice(0, 1)}
            </Avatar>
          </Badge>
          <div style={{ minWidth: 0 }}>
            <div>
              <Text strong>{c.name}</Text>
              <Tag style={{ marginInlineStart: 6 }} color={c.online ? cfg.color : 'default'}>
                {c.online ? cfg.label : '离线'}
              </Tag>
              {c.resigned ? <Tag color="default">已离职</Tag> : null}
            </div>
            {c.servingCustomer ? (
              <div style={{ fontSize: 12, color: '#B91C1C', marginTop: 2 }}>
                🎮 {c.servingCustomer.gameName || '游戏中'}
                {c.servingCustomer.paused ? '（暂停）' : ' · ' + fmtDuration(c.servingCustomer.elapsedSec + Math.max(0, Math.floor((nowMs - fetchedAtRef.current) / 1000)))}
                <div style={{ color: '#64748B' }}>客户 {c.servingCustomer.customerCode}</div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>此刻没在打</div>
            )}
            <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
              客户 {c.customers} · 消费 {yuan(c.spent)} · {fmtHours(c.hours)}
            </div>
          </div>
        </Space>
      </Card>
    );
  };

  const statCard = (label: string, value: string, color: string, bg: string) => (
    <div
      key={label}
      style={{ flex: '1 1 130px', minWidth: 118, padding: '10px 14px', borderRadius: 10, background: bg, border: '1px solid ' + color + '22' }}
    >
      <div style={{ fontSize: 12, color: '#64748B' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );

  return (
    <>
      <PageHeader
        title="客户看板"
        subtitle={
          isCompanion
            ? '我的客户排行榜：按累计消费 / 今日消费 / 游戏时长从高到低排列，正在打的亮红点（每 15 秒自动刷新）'
            : '每个陪玩什么样、他的客户现在什么样：今日消费 / 累计消费 / 游戏时长 / 此刻在不在打，一眼看全（今日按营业日 12:00 起算，与实时看板同口径；每 15 秒自动刷新）'
        }
        extra={
          <Space wrap>
            {data?.updatedAt ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                更新于 {new Date(data.updatedAt).toLocaleTimeString('zh-CN')}
              </Text>
            ) : null}
            <Button icon={React.createElement(ReloadOutlined)} loading={loading} onClick={() => void fetchBoard()}>
              刷新
            </Button>
          </Space>
        }
      />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {statCard('客户总数', String(counts?.customers ?? rows.length), '#1D4ED8', '#EFF6FF')}
        {statCard('正在打', String(counts?.serving ?? 0), '#B91C1C', '#FEF2F2')}
        {statCard('今日消费', yuan(counts?.todaySpentTotal ?? 0), '#C2410C', '#FFF7ED')}
        {statCard('累计消费', yuan(counts?.spentTotal ?? 0), '#15803D', '#F0FDF4')}
        {statCard('累计时长', fmtHours(counts?.hoursTotal ?? 0), '#7C3AED', '#F5F3FF')}
        {isCompanion ? null : statCard('陪玩数', String(counts?.companions ?? companions.length), '#0F766E', '#F0FDFA')}
      </div>

      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <Space wrap>
          {!isCompanion && (
            <Segmented
              size="small"
              value={view}
              onChange={(v) => setView(v as 'flat' | 'byCompanion')}
              options={[
                { label: '总表', value: 'flat' },
                { label: '按陪玩分组', value: 'byCompanion' },
              ]}
            />
          )}
          <Segmented
            size="small"
            value={sort}
            onChange={(v) => setSort(v as 'live' | 'spent' | 'today' | 'hours' | 'recent')}
            options={
              isCompanion
                ? [
                    { label: '累计消费', value: 'spent' },
                    { label: '今日消费', value: 'today' },
                    { label: '游戏时长', value: 'hours' },
                  ]
                : [
                    { label: '正在打优先', value: 'live' },
                    { label: '今日消费', value: 'today' },
                    { label: '累计消费', value: 'spent' },
                    { label: '游戏时长', value: 'hours' },
                    { label: '最近下单', value: 'recent' },
                  ]
            }
          />
          {focusCompanion ? (
            <Tag color="blue" closable onClose={() => setFocusCompanion(null)} style={{ padding: '2px 8px' }}>
              只看：{companions.find((c) => c.companionId === focusCompanion)?.name || '该陪玩'}
            </Tag>
          ) : null}
        </Space>
        <Space wrap>
          <Input
            allowClear
            size="small"
            style={{ width: 220 }}
            placeholder="搜 客户编号 / 微信号 / 陪玩"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Space size={4}>
            <Switch size="small" checked={showWechat} onChange={setShowWechat} />
            <Text style={{ fontSize: 12 }}>显示微信号</Text>
          </Space>
        </Space>
      </div>

      {!isCompanion && companions.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {companions.map(companionCard)}
        </div>
      ) : null}

      {loading && !data ? (
        <Card size="small">
          <Empty description="加载中…" />
        </Card>
      ) : filtered.length === 0 ? (
        <Card size="small">
          <Empty description={focusCompanion || search ? '没有符合条件的客户' : '还没有客户'} />
        </Card>
      ) : isCompanion ? (
        <Card size="small">{barList}</Card>
      ) : view === 'flat' ? (
        <Card size="small" bodyStyle={{ padding: 0 }}>
          {tableFor(filtered)}
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {companions
            .map((c) => ({ c, list: filtered.filter((r) => r.companionId === c.companionId) }))
            .filter((g) => g.list.length > 0)
            .map((g) => (
              <Card
                key={g.c.companionId}
                size="small"
                title={
                  <Space size={8}>
                    <Avatar size={24} src={g.c.avatar || undefined}>
                      {(g.c.name || '?').slice(0, 1)}
                    </Avatar>
                    <Text strong>{g.c.name}</Text>
                    <Tag color={g.c.online ? (companionStatusConfig[g.c.status] || companionStatusConfig.OFFLINE).color : 'default'}>
                      {g.c.online ? (companionStatusConfig[g.c.status] || companionStatusConfig.OFFLINE).label : '离线'}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      客户 {g.c.customers} · 消费 {yuan(g.c.spent)} · {fmtHours(g.c.hours)}
                    </Text>
                    {g.c.servingCustomer ? (
                      <Text style={{ fontSize: 12, color: '#B91C1C' }}>
                        🎮 正在给 {g.c.servingCustomer.customerCode} 打 {g.c.servingCustomer.gameName}
                      </Text>
                    ) : null}
                  </Space>
                }
                bodyStyle={{ padding: 0 }}
              >
                {tableFor(g.list)}
              </Card>
            ))}
          {(() => {
            const none = filtered.filter((r) => !r.companionId);
            if (none.length === 0) return null;
            return (
              <Card
                key="__none__"
                size="small"
                title={<Text strong>未分配陪玩（{none.length}）</Text>}
                bodyStyle={{ padding: 0 }}
              >
                {tableFor(none)}
              </Card>
            );
          })()}
        </div>
      )}

      <CustomerProfileDrawer
        customerId={profileId}
        open={!!profileId}
        onClose={() => setProfileId(null)}
        showWechat={showWechat}
      />
    </>
  );
};

export default CustomerBoardPage;
