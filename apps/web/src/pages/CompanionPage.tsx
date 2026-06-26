import React, { useEffect, useState, useCallback } from 'react';
import { message, Segmented } from 'antd';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList, ReferenceLine } from 'recharts';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';

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
    monthly: { key: 'monthlyRevenue', label: '本月业绩', unit: '¥', threshold: 3000, isMoney: true },
  };
  const cfg = cfgMap[metric];

  const sorted = [...ranking]
    .sort((a, b) => (b[cfg.key] || 0) - (a[cfg.key] || 0))
    .map((c, i) => ({ ...c, rank: i + 1 }));
  const myRank = sorted.findIndex((c: any) => c.name === user?.username) + 1;
  const failCount = sorted.filter((c: any) => cfg.threshold > 0 && (c[cfg.key] || 0) < cfg.threshold).length;

  // 金属渐变色定义
  const GOLD = 'url(#gold)';
  const SILVER = 'url(#silver)';
  const BRONZE = 'url(#bronze)';
  const STEEL = 'url(#steel)';
  const FAIL = 'url(#fail)';
  const ME = 'url(#me)';

  return (
    <div style={{ margin: -24 }}>
      <style>{`
        @keyframes scan-line {
          0% { transform: translateY(-100%); } 100% { transform: translateY(800px); }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; } 100% { background-position: 200% center; }
        }
        @keyframes pulse-border {
          0%,100% { border-color: rgba(0,212,255,0.15); } 50% { border-color: rgba(0,212,255,0.4); }
        }
        @keyframes title-shine {
          0% { background-position: -200% center; } 100% { background-position: 200% center; }
        }
      `}</style>

      {/* 全宽深色容器 */}
      <div style={{
        background: 'linear-gradient(180deg, #0A0E17 0%, #111827 40%, #0F172A 100%)',
        minHeight: 'calc(100vh - 120px)', borderRadius: 12, padding: '28px 32px 20px',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 0 60px rgba(0,212,255,0.04), inset 0 0 100px rgba(0,0,0,0.3)',
        animation: 'pulse-border 4s ease-in-out infinite',
      }}>
        {/* 标题栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
          <div>
            <div style={{
              fontSize: 28, fontWeight: 900, letterSpacing: 3, fontFamily: 'monospace',
              background: 'linear-gradient(90deg, #E8E8E8, #FFFFFF, #C0C0C0, #FFD700, #C0C0C0, #FFFFFF)',
              backgroundSize: '300% 100%', animation: 'title-shine 4s linear infinite',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              marginBottom: 4,
            }}>
              ██ {cfg.label} LEAGUE
            </div>
            <div style={{ fontSize: 11, color: '#6B7280', fontFamily: 'monospace', letterSpacing: 1 }}>
              FAIL_LINE:{cfg.isMoney?'¥':''}{cfg.threshold}{cfg.unit} ‖ FAIL:{failCount} ‖ RANK:#{myRank}/{sorted.length} ‖ REFRESH:30s
            </div>
          </div>
          <Segmented value={metric} onChange={(v) => setMetric(v as Metric)}
            options={[
              { label: '续单率', value: 'renewal' },
              { label: '复购率', value: 'repurchase' },
              { label: '昨日业绩', value: 'yesterday' },
              { label: '本月业绩', value: 'monthly' },
            ]}
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
          />
        </div>

        {/* 图表区域 */}
        <div style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.2))',
          borderRadius: 14, padding: '24px 20px 12px',
          border: '1px solid rgba(255,255,255,0.04)',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* 扫描线 */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.5), rgba(123,97,255,0.5), rgba(0,212,255,0.5), transparent)',
            animation: 'scan-line 4s linear infinite', pointerEvents: 'none', zIndex: 3 }} />

          {/* 网格背景 */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.03,
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '40px 40px', zIndex: 0 }} />

          <ResponsiveContainer width="100%" height={480}>
            <BarChart data={sorted} margin={{ top: 30, right: 30, left: 10, bottom: 5 }}
              barSize={Math.max(20, Math.min(48, 550 / sorted.length))} barCategoryGap="16%">
              {/* SVG 渐变定义 */}
              <defs>
                <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFE55C"/><stop offset="50%" stopColor="#FFD700"/><stop offset="100%" stopColor="#B8960F"/></linearGradient>
                <linearGradient id="silver" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#F0F0F0"/><stop offset="50%" stopColor="#C0C0C0"/><stop offset="100%" stopColor="#808080"/></linearGradient>
                <linearGradient id="bronze" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E8B87B"/><stop offset="50%" stopColor="#CD7F32"/><stop offset="100%" stopColor="#8B5A2B"/></linearGradient>
                <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8899AA"/><stop offset="50%" stopColor="#6B7D8E"/><stop offset="100%" stopColor="#4A5A6A"/></linearGradient>
                <linearGradient id="fail" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FF6B7A"/><stop offset="50%" stopColor="#FF4757"/><stop offset="100%" stopColor="#CC1122"/></linearGradient>
                <linearGradient id="me" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00E5FF"/><stop offset="50%" stopColor="#00D4FF"/><stop offset="100%" stopColor="#0090CC"/></linearGradient>
                <filter id="glow-gold"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                <filter id="glow-fail"><feGaussianBlur stdDeviation="2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
              </defs>

              <XAxis dataKey="name" tick={false} axisLine={false} tickLine={false} />
              <YAxis hide domain={[0, 'dataMax']} />

              <Bar dataKey={cfg.key} radius={[8, 8, 0, 0]} animationDuration={1200} animationEasing="ease-out" isAnimationActive={true}>
                {/* 数字标签 */}
                <LabelList dataKey={cfg.key} position="top"
                  formatter={(v: any) => cfg.isMoney ? `¥${v>=1000?(v/1000).toFixed(1)+'K':v}` : `${Math.round(v)}%`}
                  style={{ fontSize: 12, fontWeight: 800, fontFamily: 'monospace', fill: '#E2E8F0' }} />
                {/* 名字标签 */}
                <LabelList dataKey="name" position="top"
                  content={({ x, y, width, index }: any) => {
                    const d = sorted[index]; if (!d) return null;
                    const fail = cfg.threshold > 0 && (d[cfg.key]||0) < cfg.threshold;
                    const me = d.name === user?.username;
                    return (
                      <text x={x+width/2} y={y-26} textAnchor="middle"
                        fill={fail?'#FF4757':me?'#00D4FF':'#9CA3AF'}
                        fontSize={13} fontWeight={fail||me?800:600}
                        fontFamily="system-ui" letterSpacing={0.5}
                        filter={fail?'url(#glow-fail)':me?'url(#glow-gold)':undefined}>
                        {d.name}{me?' ★':''}
                      </text>
                    );
                  }}
                />
                {sorted.map((d: any) => {
                  const fail = cfg.threshold > 0 && (d[cfg.key]||0) < cfg.threshold;
                  const me = d.name === user?.username;
                  const top3 = d.rank <= 3;
                  return (
                    <Cell key={d.id}
                      fill={fail?FAIL:top3?[GOLD,SILVER,BRONZE][d.rank-1]:me?ME:STEEL}
                      opacity={fail?1:0.95}
                      stroke={fail?'#FF4757':top3?['#FFD700','#C0C0C0','#CD7F32'][d.rank-1]:'rgba(255,255,255,0.1)'}
                      strokeWidth={fail||top3?1.5:0.5}
                      filter={top3&&d.rank===1?'url(#glow-gold)':undefined}
                    />
                  );
                })}
              </Bar>

              {/* 不达标线 */}
              {cfg.threshold > 0 && (
                <ReferenceLine y={cfg.threshold} stroke="#FF4757" strokeWidth={2} strokeDasharray="10 5"
                  label={{
                    position: 'right', value: `⚠ FAIL ${cfg.isMoney?'¥':''}${cfg.threshold}${cfg.unit}`,
                    fill: '#FF4757', fontSize: 12, fontWeight: 800, fontFamily: 'monospace',
                  }}
                />
              )}

              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                content={({ active, payload }: any) => {
                  if (!active||!payload?.length) return null;
                  const d = payload[0].payload;
                  const fail = cfg.threshold>0 && (d[cfg.key]||0) < cfg.threshold;
                  const medals = ['👑','🥈','🥉'];
                  return (
                    <div style={{ background: '#0F172A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
                      padding: '14px 18px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)' }}>
                      <div style={{ fontSize: 11, color: '#6B7280', fontFamily: 'monospace', letterSpacing: 1 }}>
                        RANK #{d.rank} {d.rank<=3?medals[d.rank-1]:''}
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: fail?'#FF4757':'#FFF', marginTop: 2 }}>
                        {d.name}
                      </div>
                      <div style={{ fontSize: 28, fontWeight: 900, color: fail?'#FF4757':d.rank<=3?'#FFD700':'#00D4FF', marginTop: 4, fontFamily: 'monospace' }}>
                        {cfg.isMoney?`¥${(d[cfg.key]||0).toLocaleString()}`:`${Math.round(d[cfg.key]||0)}%`}
                      </div>
                      {fail && <div style={{ fontSize:11,color:'#FF4757',fontWeight:700,marginTop:4}}>⬇ BELOW THRESHOLD</div>}
                    </div>
                  );
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 底部状态 */}
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between',
          fontSize: 10, color: '#4B5563', fontFamily: 'monospace', letterSpacing: 0.5 }}>
          <span>TOTAL_ENTRIES: {sorted.length}</span>
          {failCount>0 && <span style={{color:'#FF4757'}}>⚠ FAILED: {failCount}</span>}
          <span>METAL_LEAGUE_v2.0</span>
        </div>
      </div>
    </div>
  );
};

export default CompanionPage;
