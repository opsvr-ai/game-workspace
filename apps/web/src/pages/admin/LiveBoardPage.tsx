// craftsman-ignore: TS001,TS002
/**
 * 实时看板（老板 2026-10-03）。
 *
 * 原话：「再给管理端生成一个看板：谁跟谁在接单中、谁谁娱乐中、谁谁空闲中，
 * 也显示正在打什么游戏、打了多久等等，让管理端派单的时候也方便，一目了然，不用挨个问。」
 *
 * 一眼要看到的东西：
 *  - 顶部 5 个数：接单中 / 娱乐中 / 空闲 / 休息 / 离线；
 *  - 接单中的人两人一组显示（主陪 + 搭档），写明在打什么游戏、客户编号、已经打了多久；
 *  - 其余按「娱乐中 / 空闲 / 休息」分块，最后一块是离线的人（只是标记，不算在用电脑）。
 *
 * 数据每 15 秒拉一次；时长每秒本地走字，不用等下一次刷新。
 * 只有客户**编号**，没有客户微信 —— 看板是给派单用的。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Badge, Button, Card, Empty, Space, Tag, Tooltip, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageHeader from '../../components/PageHeader';
import { companionsApi } from '../../api/companions';
import { statusDotColor } from '../../constants/companions';

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
  serving: ServingInfo | null;
}

interface BoardData {
  rows: BoardRow[];
  updatedAt: string;
  counts?: { serving: number; entertainment: number; available: number; resting: number; offline: number };
}

const REFRESH_MS = 15_000;

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

const STAT_META: Array<{ key: keyof NonNullable<BoardData['counts']>; label: string; color: string; bg: string }> = [
  { key: 'serving', label: '接单中', color: '#B91C1C', bg: '#FEF2F2' },
  { key: 'entertainment', label: '娱乐中', color: '#B45309', bg: '#FFFBEB' },
  { key: 'available', label: '空闲', color: '#15803D', bg: '#F0FDF4' },
  { key: 'resting', label: '休息', color: '#C2410C', bg: '#FFF7ED' },
  { key: 'offline', label: '离线', color: '#64748B', bg: '#F8FAFC' },
];

const LiveBoardPage: React.FC = () => {
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
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
  const counts = data?.counts;

  const groups = useMemo(() => {
    const online = rows.filter((r) => r.online);
    return {
      serving: online.filter((r) => r.serving),
      entertainment: online.filter((r) => !r.serving && r.status === 'ENTERTAINMENT'),
      available: online.filter((r) => !r.serving && r.status === 'AVAILABLE'),
      resting: online.filter((r) => !r.serving && r.status === 'RESTING'),
      other: online.filter((r) => !r.serving && !['ENTERTAINMENT', 'AVAILABLE', 'RESTING'].includes(r.status)),
      offline: rows.filter((r) => !r.online),
    };
  }, [rows]);

  const elapsedOf = (s: ServingInfo) => {
    if (s.paused) return s.elapsedSec;
    return s.elapsedSec + (nowMs - fetchedAtRef.current) / 1000;
  };

  const personTag = (r: BoardRow) => (
    <Space size={6}>
      <Badge dot color={statusDotColor({ status: r.status, isOnline: r.online, lastHeartbeat: r.lastHeartbeat })}>
        <Avatar size={28} src={r.avatar || undefined} style={{ background: '#E2E8F0', color: '#334155', fontSize: 12 }}>
          {(r.name || '?').slice(0, 1)}
        </Avatar>
      </Badge>
      <span style={{ fontWeight: 600 }}>{r.name || r.username || '未知'}</span>
    </Space>
  );

  const servingCard = (r: BoardRow) => {
    const s = r.serving!;
    return (
      <Card
        key={r.companionId}
        size="small"
        style={{ borderLeft: s.paused ? '4px solid #F59E0B' : '4px solid #EF4444', background: '#fff' }}
        styles={{ body: { padding: '10px 12px' } }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 220 }}>
            <Space size={8} wrap>
              {personTag(r)}
              <Tag color={s.role === 'MAIN' ? 'red' : 'blue'} style={{ marginInlineEnd: 0 }}>
                {s.role === 'MAIN' ? '主陪' : '搭档'}
              </Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                🎮 {s.gameName || '未知游戏'} · {s.duration || 1}h
              </Text>
            </Space>
            <div style={{ marginTop: 6, fontSize: 12, color: '#475569' }}>
              搭档：{s.partnerName ? <Text strong>{s.partnerName}</Text> : '—'}
              {s.orderCode ? ` · 单号 ${s.orderCode}` : ''}
              {s.customerCode ? ` · 客户 ${s.customerCode}` : ''}
              {s.orderStudioName ? ` · 发布：${s.orderStudioName}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right', minWidth: 120 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: s.paused ? '#B45309' : '#B91C1C', fontVariantNumeric: 'tabular-nums' }}>
              {formatDuration(elapsedOf(s))}
            </div>
            <div style={{ fontSize: 12, color: '#64748B' }}>
              {s.paused ? '⏸ 暂停中（不计时长）' : '计时中'}
              {s.myAmount != null ? ` · 我的 ¥${Number(s.myAmount).toFixed(1)}` : ''}
            </div>
          </div>
        </div>
      </Card>
    );
  };

  const chip = (r: BoardRow, extra?: React.ReactNode) => (
    <Tag
      key={r.companionId}
      style={{ padding: '4px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, marginInlineEnd: 8 }}
    >
      {personTag(r)}
      {r.studioName ? <span style={{ color: '#94A3B8', fontSize: 11 }}>{r.studioName}</span> : null}
      {extra}
    </Tag>
  );

  const section = (title: string, color: string, body: React.ReactNode, count: number) =>
    count > 0 ? (
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 8 }}>
          {title} <span style={{ color: '#94A3B8', fontWeight: 400 }}>{count}</span>
        </div>
        {body}
      </div>
    ) : null;

  return (
    <>
      <PageHeader
        title="实时看板"
        subtitle="谁跟谁在接单中、谁娱乐中、谁空闲中 —— 在打什么游戏、打了多久，一眼看全（每 15 秒自动刷新）"
        extra={
          <Space>
            {data?.updatedAt ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                更新于 {new Date(data.updatedAt).toLocaleTimeString('zh-CN')}
              </Text>
            ) : null}
            <Button icon={React.createElement(ReloadOutlined)} onClick={() => void fetchBoard()} loading={loading}>
              刷新
            </Button>
          </Space>
        }
      />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {STAT_META.map((m) => (
          <div
            key={m.key}
            style={{
              flex: '1 1 120px',
              minWidth: 110,
              padding: '10px 14px',
              borderRadius: 10,
              background: m.bg,
              border: `1px solid ${m.color}22`,
            }}
          >
            <div style={{ fontSize: 12, color: '#64748B' }}>{m.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: m.color, fontVariantNumeric: 'tabular-nums' }}>
              {counts ? counts[m.key] : groups[m.key === 'serving' ? 'serving' : m.key].length}
            </div>
          </div>
        ))}
      </div>

      {loading && !data ? (
        <Card size="small">
          <Empty description="加载中…" />
        </Card>
      ) : rows.length === 0 ? (
        <Card size="small">
          <Empty description="本店还没有陪玩" />
        </Card>
      ) : (
        <>
          {section('🔴 接单中（含搭档配对）', '#B91C1C', (
            <div style={{ display: 'grid', gap: 8 }}>{groups.serving.map(servingCard)}</div>
          ), groups.serving.length)}

          {section('🟡 娱乐中', '#B45309', (
            <div>{groups.entertainment.map((r) => chip(r))}</div>
          ), groups.entertainment.length)}

          {section('🟢 空闲（可以派单）', '#15803D', (
            <div>{groups.available.map((r) => chip(r))}</div>
          ), groups.available.length)}

          {section('🟠 休息', '#C2410C', (
            <div>{groups.resting.map((r) => chip(r))}</div>
          ), groups.resting.length)}

          {section('⚪ 其他在线', '#475569', (
            <div>{groups.other.map((r) => chip(r))}</div>
          ), groups.other.length)}

          {section('⚫ 离线（电脑没在跑客户端）', '#64748B', (
            <div style={{ opacity: 0.75 }}>
              {groups.offline.map((r) => (
                <Tooltip key={r.companionId} title={r.lastHeartbeat ? `最后心跳 ${new Date(r.lastHeartbeat).toLocaleString('zh-CN')}` : '从来没上报过心跳'}>
                  {chip(r, <Tag color="default" style={{ marginInlineStart: 4 }}>离线</Tag>)}
                </Tooltip>
              ))}
            </div>
          ), groups.offline.length)}
        </>
      )}
    </>
  );
};

export default LiveBoardPage;
