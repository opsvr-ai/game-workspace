// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Card, Segmented, Tag, Typography, Empty } from 'antd';
import dayjs from 'dayjs';
import { companionsApi } from '../api/companions';
import { useAuthStore } from '../stores/authStore';
import { SEMANTIC, TEXT, BRAND } from '../styles/tokens';

const { Text } = Typography;

const hm = (sec: unknown) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}小时${m}分` : `${m}分钟`;
};
const pct = (v: unknown) => `${Math.round(Number(v) || 0)}%`;
const yuan = (v: unknown) => `¥${(Number(v) || 0).toFixed(1)}`;

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  BUSY: { label: '接单中', color: '#F5222D', bg: SEMANTIC.dangerSoft },
  ENTERTAINMENT: { label: '娱乐中', color: '#FAAD14', bg: SEMANTIC.warningSoft },
  AVAILABLE: { label: '空闲', color: '#52C41A', bg: SEMANTIC.successSoft },
  RESTING: { label: '休息', color: '#FA8C16', bg: SEMANTIC.orangeSoft },
  OFFLINE: { label: '离线', color: TEXT.tertiary, bg: '#f5f5f5' },
};

/**
 * 陪玩自己工作台上的「我的表现」卡：跟管理端「陪玩状态」同一套数据，
 * 让他自己知道今天/近 7 天/近 30 天：几点来、几点走、各状态占多少、业绩、成功失败、补单、KPI。
 */
export default function CompanionSelfStatusCard({ excellence }: { excellence?: any }) {
  const user = useAuthStore((s) => s.user);
  const [days, setDays] = useState(1);
  const [row, setRow] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    companionsApi
      .liveBoard(days)
      .then(({ data }: any) => {
        if (!alive) return;
        const rows = data?.data?.rows || [];
        setRow(rows.find((r: any) => r.companionId === user?.companionId) || null);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [days, user?.companionId]);

  const meta = row ? STATUS_META[row.serving ? 'BUSY' : row.online ? row.status : 'OFFLINE'] || STATUS_META.OFFLINE : STATUS_META.OFFLINE;
  const modes = row?.modeSeconds || {};
  const onlineSec = Number(row?.onlineSec) || 0;
  const periodLabel = days === 1 ? '今日' : `近${days}天`;

  return (
    <Card
      size="small"
      title={`我的${periodLabel}表现`}
      loading={loading}
      style={{ marginBottom: 12 }}
      extra={
        <Segmented
          size="small"
          value={days}
          onChange={(v) => setDays(Number(v) || 1)}
          options={[
            { label: '今天', value: 1 },
            { label: '近 7 天', value: 7 },
            { label: '近 30 天', value: 30 },
          ]}
        />
      }
    >
      {!row ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有今日状态数据" />
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
            <Text strong>{periodLabel} {row.statusLogMissing ? '—' : hm(onlineSec)}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              上班 {row.loginAt ? dayjs(row.loginAt).format('MM-DD HH:mm') : '—'}
              {' · '}
              {row.logoutAt ? `下班 ${dayjs(row.logoutAt).format('MM-DD HH:mm')}` : row.online ? '在线中' : '未在线'}
            </Text>
          </div>
          <div style={{ display: 'flex', gap: 8, margin: '7px 0' }}>
            {[
              ['接单', modes.BUSY || 0, '#F5222D'],
              ['娱乐', modes.ENTERTAINMENT || 0, '#FAAD14'],
              ['空闲', modes.AVAILABLE || 0, '#52C41A'],
              ['休息', modes.RESTING || 0, '#FA8C16'],
            ].map(([label, sec, color]) => {
              const secNum = Number(sec) || 0;
              const ratio = onlineSec > 0 ? Math.min(100, Math.round((secNum / onlineSec) * 100)) : 0;
              return (
                <div key={String(label)} style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: TEXT.secondary }}>{label} {row.statusLogMissing ? '—' : hm(secNum)}</div>
                  <div style={{ height: 4, background: `${color}22`, borderRadius: 2, marginTop: 2 }}>
                    <div style={{ width: `${ratio}%`, height: 4, background: color as string, borderRadius: 2 }} />
                  </div>
                  <div style={{ fontSize: 10, color: TEXT.tertiary }}>{row.statusLogMissing ? '—' : `${ratio}%`}</div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: TEXT.heading, lineHeight: 1.7 }}>
            业绩 <b style={{ color: BRAND.primary }}>{row.earningsHidden ? '—' : yuan(row.todayRevenue)}</b>
            {' · '}接单 <b>{row.todayOrders || 0}</b>
            {' · '}<span style={{ color: SEMANTIC.success }}>成功 {row.successCount || 0}</span>
            {' · '}<span style={{ color: row.failCount ? SEMANTIC.dangerDeep : TEXT.tertiary }}>失败 {row.failCount || 0}</span>
            {' · '}{periodLabel} KPI 成单率 <b>{pct(row.successRate)}</b>
            {row.supplementCount ? <> · <Tag color="orange" style={{ marginInlineEnd: 0 }}>补单 {row.supplementCount}</Tag></> : null}
          </div>
          {row.failureReasons?.length ? (
            <div style={{ fontSize: 11, color: SEMANTIC.dangerDeep, marginTop: 4 }}>
              失败原因：{row.failureReasons.map((x: any) => `${x.reason}×${x.count}`).join('；')}
            </div>
          ) : null}
          {excellence ? (
            <div style={{ fontSize: 11, color: TEXT.tertiary, marginTop: 4 }}>
              30天 KPI：首单 {pct(excellence.newRate)} · 续单 {pct(excellence.renewRate)} · 复购 {pct(excellence.repurchaseRate)}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
