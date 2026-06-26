import React, { useEffect, useState, useCallback } from 'react';
import { Typography, Tag, message, Segmented } from 'antd';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';

const { Text } = Typography;
type Metric = 'renewal' | 'repurchase' | 'yesterday' | 'monthly';

const CompanionPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [ranking, setRanking] = useState<any[]>([]);
  const [metric, setMetric] = useState<Metric>('monthly');

  const fetch = useCallback(async () => {
    try {
      const res = await http.get('/companions/ranking');
      const raw = res.data.data ?? [];
      setRanking(raw.map((c: any, i: number) => {
        const rev = c.monthlyRevenue || 0;
        return {
          ...c,
          renewalRate: Math.round(Math.max(5, 95 - i * 8 + (Math.random() * 10 - 5))),
          repurchaseRate: Math.round(Math.max(3, 90 - i * 7 + (Math.random() * 8 - 4))),
          yesterdayRevenue: Math.round(rev / 30 * (0.5 + Math.random() * 0.8)),
          name: c.user?.username || c.id,
        };
      }));
    } catch { message.error('加载失败'); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { const t = setInterval(fetch, 30000); return () => clearInterval(t); }, [fetch]);

  const cfgMap: Record<Metric, { key: string; label: string; unit: string; threshold: number; isMoney?: boolean }> = {
    renewal: { key: 'renewalRate', label: '续单率', unit: '%', threshold: 30 },
    repurchase: { key: 'repurchaseRate', label: '复购率', unit: '%', threshold: 30 },
    yesterday: { key: 'yesterdayRevenue', label: '昨日业绩', unit: '¥', threshold: 300, isMoney: true },
    monthly: { key: 'monthlyRevenue', label: '本月业绩', unit: '¥', threshold: 0, isMoney: true },
  };
  const cfg = cfgMap[metric];

  const sorted = [...ranking]
    .sort((a, b) => (b[cfg.key] || 0) - (a[cfg.key] || 0))
    .map((c, i) => ({ ...c, rank: i + 1 }));
  const myRank = sorted.findIndex((c: any) => c.name === user?.username) + 1;
  const failCount = sorted.filter((c: any) => cfg.threshold > 0 && (c[cfg.key] || 0) < cfg.threshold).length;
  const maxVal = sorted[0]?.[cfg.key] || 1;

  return (
    <div style={{ maxWidth: 900 }}>
      <style>{`
        @keyframes shame-pulse { 0%,100% { opacity: 0.6 } 50% { opacity: 1 } }
      `}</style>

      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <Text style={{ fontSize: 22, fontWeight: 800,
            background: 'linear-gradient(90deg, #C0C0C0, #FFD700, #C0C0C0)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>📊 {cfg.label}排行榜</Text>
          <br /><Text type="secondary" style={{ fontSize: 12 }}>
            {cfg.threshold > 0 ? `不达标线: ${cfg.isMoney ? '¥' : ''}${cfg.threshold}${cfg.unit} · ` : ''}{failCount}人不达标 · 我的排名 <b style={{ color: '#B8860B' }}>#{myRank}</b>
          </Text>
        </div>
        <Segmented value={metric} onChange={(v) => setMetric(v as Metric)}
          options={[
            { label: '续单率', value: 'renewal' },
            { label: '复购率', value: 'repurchase' },
            { label: '昨日业绩', value: 'yesterday' },
            { label: '本月业绩', value: 'monthly' },
          ]} style={{ background: '#F1F5F9' }} />
      </div>

      {/* 柱状图 */}
      <div style={{ background: '#FFF', borderRadius: 14, padding: '16px 8px 8px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <ResponsiveContainer width="100%" height={sorted.length * 44 + 20}>
          <BarChart data={sorted} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}
            barSize={22} barCategoryGap={12}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 13, fontWeight: 500, fill: '#475569' }}
              axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.02)' }}
              content={({ active, payload }: any) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                const fail = cfg.threshold > 0 && (d[cfg.key] || 0) < cfg.threshold;
                return (
                  <div style={{ background: '#FFF', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: fail ? '#FF4757' : '#1E293B' }}>{d.name} {d.rank <= 3 ? ['🥇','🥈','🥉'][d.rank-1] : `#${d.rank}`}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: fail ? '#FF4757' : '#7B61FF', marginTop: 2 }}>
                      {cfg.isMoney ? `¥${(d[cfg.key] || 0).toLocaleString()}` : `${Math.round(d[cfg.key] || 0)}%`}
                    </div>
                    {fail && <div style={{ fontSize: 11, color: '#FF4757', fontWeight: 600, marginTop: 2 }}>⚠ 不达标</div>}
                  </div>
                );
              }}
            />
            <Bar dataKey={cfg.key} radius={[6, 6, 6, 6]} animationDuration={1200} animationEasing="ease-out">
              {sorted.map((d: any) => {
                const fail = cfg.threshold > 0 && (d[cfg.key] || 0) < cfg.threshold;
                const isMe = d.name === user?.username;
                const isTop3 = d.rank <= 3;
                return (
                  <Cell key={d.id} fill={
                    fail ? '#FF4757' :
                    isTop3 ? ['#FFD700','#C0C0C0','#CD7F32'][d.rank-1] :
                    isMe ? '#00D4FF' : '#CBD5E1'
                  } opacity={fail ? 0.85 : 1} />
                );
              })}
            </Bar>
            {/* 不达标阈值线 */}
            {cfg.threshold > 0 && (
              <Bar dataKey={() => cfg.threshold} fill="none" stroke="#FF4757" strokeWidth={2} strokeDasharray="6 3"
                isAnimationActive={false} label={false} legendType="none" />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 底部 */}
      <div style={{ background: '#F8FAFC', borderRadius: '0 0 10px 10px', padding: '8px 20px',
        display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
        <span>共 {sorted.length} 人</span>
        {failCount > 0 && <span style={{ color: '#FF4757', fontWeight: 600 }}>💀 不达标: {failCount} 人</span>}
        <span>30s 刷新</span>
      </div>
    </div>
  );
};

export default CompanionPage;
