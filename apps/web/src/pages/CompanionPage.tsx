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
  const [now, setNow] = useState(new Date());

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

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
  const sorted = [...ranking].sort((a, b) => (b[cfg.key] || 0) - (a[cfg.key] || 0)).map((c, i) => ({ ...c, rank: i + 1 }));
  const myRank = sorted.findIndex((c: any) => c.name === user?.username) + 1;
  const failCount = sorted.filter((c: any) => cfg.threshold > 0 && (c[cfg.key] || 0) < cfg.threshold).length;

  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  return (
    <div style={{ margin: -24 }}>
      <style>{`
        @keyframes scan-fast { 0% { transform: translateY(-100%); } 100% { transform: translateY(1200px); } }
        @keyframes scan-slow { 0% { transform: translateY(-100%); } 100% { transform: translateY(1200px); } }
        @keyframes particle-drift { 0% { transform: translate(0,0) rotate(0deg); opacity:0; }
          10% { opacity:0.6; } 90% { opacity:0.3; } 100% { transform: translate(60px,-200px) rotate(180deg); opacity:0; } }
        @keyframes pulse-radar { 0%,100% { transform: scale(1); opacity:0.6; } 50% { transform: scale(1.05); opacity:1; } }
        @keyframes title-glitch { 0%,100% { text-shadow: 2px 0 #00D4FF, -2px 0 #7B61FF; }
          25% { text-shadow: -2px 0 #00D4FF, 2px 0 #7B61FF; } 50% { text-shadow: 2px -2px #00D4FF, -2px 2px #7B61FF; } }
        @keyframes camo-shift { 0% { background-position: 0% 0%; } 100% { background-position: 100% 100%; } }
      `}</style>

      <div style={{
        background: 'linear-gradient(180deg, #0A0F0A 0%, #0D1410 30%, #0B100C 60%, #080C08 100%)',
        minHeight: 'calc(100vh - 120px)', borderRadius: 16, padding: '32px 36px 24px',
        border: '1px solid rgba(0,255,136,0.08)',
        boxShadow: '0 0 80px rgba(0,255,136,0.03), inset 0 0 120px rgba(0,0,0,0.4)',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* 三角洲动态背景 */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
          {/* 扫描线 */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1,
            background: 'linear-gradient(90deg, transparent, rgba(0,255,136,0.6), rgba(0,255,136,0.3), transparent)',
            animation: 'scan-fast 2s linear infinite' }} />
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: 'linear-gradient(90deg, transparent, rgba(0,255,136,0.2), transparent)',
            animation: 'scan-slow 5s linear infinite', animationDelay: '1s' }} />
          {/* 雷达脉冲 */}
          <div style={{ position: 'absolute', top: 40, right: 40, width: 100, height: 100, borderRadius: '50%',
            border: '1px solid rgba(0,255,136,0.15)', animation: 'pulse-radar 3s ease-in-out infinite' }} />
          <div style={{ position: 'absolute', top: 55, right: 55, width: 70, height: 70, borderRadius: '50%',
            border: '1px solid rgba(0,255,136,0.08)', animation: 'pulse-radar 3s ease-in-out infinite', animationDelay: '0.5s' }} />
          {/* 战术网格 */}
          <div style={{ position: 'absolute', inset: 0, opacity: 0.04,
            backgroundImage: `
              linear-gradient(rgba(0,255,136,0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,255,136,0.3) 1px, transparent 1px)`,
            backgroundSize: '60px 60px' }} />
          {/* 漂浮粒子 */}
          {[...Array(8)].map((_, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${10+i*10}%`, top: `${20+i*8}%`,
              width: 3, height: 3, borderRadius: '50%', background: 'rgba(0,255,136,0.4)',
              animation: `particle-drift ${4+i*0.5}s linear infinite`, animationDelay: `${i*0.7}s`,
            }} />
          ))}
          {/* 迷彩纹理 */}
          <div style={{ position: 'absolute', inset: 0, opacity: 0.015,
            background: 'url("data:image/svg+xml,%3Csvg width=\'200\' height=\'200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 0h50v50H0zM100 50h50v50h-50zM50 100h50v50H50zM150 150h50v50h-50z\' fill=\'%2300ff88\'/%3E%3C/svg%3E")',
            backgroundSize: '200px', animation: 'camo-shift 20s linear infinite' }} />
        </div>

        {/* 内容 */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* 居中标题 */}
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: '#00FF88', fontFamily: 'monospace', letterSpacing: 6, marginBottom: 8, opacity: 0.7 }}>
              ◆ TACTICAL COMMAND CENTER ◆
            </div>
            {/* 主标题 - 流动金属光泽 */}
            <style>{`
              @keyframes lightning-bolt {
                0%   { background-position: 0% 50%, 200% 50%; filter: drop-shadow(0 1px 2px rgba(255,255,255,0.9)) drop-shadow(0 0 20px rgba(180,200,220,0.3)); }
                8%   { background-position: 0% 50%, -100% 50%; filter: drop-shadow(0 4px 8px rgba(255,255,255,1)) drop-shadow(0 0 80px rgba(255,255,255,0.9)); }
                9%   { background-position: 0% 50%, 200% 50%; }
                33%  { background-position: 0% 50%, 200% 50%; }
                42%  { background-position: 0% 50%, -100% 50%; filter: drop-shadow(0 4px 8px rgba(255,255,255,1)) drop-shadow(0 0 80px rgba(255,255,255,0.9)); }
                43%  { background-position: 0% 50%, 200% 50%; }
                66%  { background-position: 0% 50%, 200% 50%; }
                75%  { background-position: 0% 50%, -100% 50%; filter: drop-shadow(0 4px 8px rgba(255,255,255,1)) drop-shadow(0 0 80px rgba(255,255,255,0.9)); }
                76%  { background-position: 0% 50%, 200% 50%; }
                100% { background-position: 0% 50%, 200% 50%; }
              }
            `}</style>
            <div style={{
              fontSize: 68, fontWeight: 900, letterSpacing: 14, fontFamily: "system-ui, 'PingFang SC', sans-serif",
              fontStyle: 'italic',
              background: `
                linear-gradient(180deg, #FFFFFF 0%, #E8ECF0 12%, #C8D0D8 25%, #A0B0C0 35%, #C8D0D8 50%, #B0BCC8 60%, #C8D0D8 75%, #A0B0C0 85%, #E8ECF0 95%, #FFFFFF 100%),
                linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 30%, rgba(255,255,255,0.7) 45%, rgba(255,255,255,0.9) 50%, rgba(255,255,255,0.7) 55%, rgba(255,255,255,0.15) 70%, transparent 100%)
              `,
              backgroundSize: '100% 100%, 200% 100%',
              backgroundPosition: '0% 50%, 200% 50%',
              WebkitBackgroundClip: 'text, text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              animation: 'lightning-bolt 4s ease-in-out infinite',
              lineHeight: 1.1,
              marginBottom: 6,
              display: 'inline-block',
              transform: 'skewX(-4deg)',
            }}>
              蠢驴电竞
            </div>
            {/* 副标题 */}
            <div style={{
              fontSize: 16, fontWeight: 700, letterSpacing: 10, fontFamily: "monospace",
              background: 'linear-gradient(90deg, #C8D0D8 0%, #FFFFFF 30%, #FFD700 60%, #FFFFFF 100%)',
              backgroundSize: '200% 100%',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              marginBottom: 2,
            }}>
              {cfg.label} · RANKING
            </div>
            <div style={{ fontSize: 11, color: '#4A6B5A', fontFamily: 'monospace', letterSpacing: 3, marginTop: 4 }}>
              CHUNLV ESPORTS · DELTA FORCE · {dateStr}
            </div>
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', gap: 24, fontSize: 11, color: '#5A7B6A', fontFamily: 'monospace' }}>
              <span>FAIL_LINE: {cfg.isMoney?'¥':''}{cfg.threshold}{cfg.unit}</span>
              <span style={{ color: '#FF4757' }}>⚠ FAIL: {failCount}</span>
              <span style={{ color: '#00FF88' }}>RANK: #{myRank}/{sorted.length}</span>
              <span>REFRESH: 30s</span>
            </div>
          </div>

          {/* 指标切换 */}
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <Segmented value={metric} onChange={(v) => setMetric(v as Metric)}
              options={[
                { label: '续单率', value: 'renewal' },
                { label: '复购率', value: 'repurchase' },
                { label: '昨日业绩', value: 'yesterday' },
                { label: '本月业绩', value: 'monthly' },
              ]}
              style={{ background: 'rgba(0,255,136,0.04)', border: '1px solid rgba(0,255,136,0.08)' }}
            />
          </div>

          {/* 图表 */}
          <div style={{
            background: 'linear-gradient(180deg, rgba(0,20,10,0.6), rgba(0,10,5,0.8))',
            borderRadius: 14, padding: '28px 24px 14px',
            border: '1px solid rgba(0,255,136,0.06)',
            position: 'relative', overflow: 'hidden',
            boxShadow: 'inset 0 0 60px rgba(0,0,0,0.3)',
          }}>
            <ResponsiveContainer width="100%" height={440}>
              <BarChart data={sorted} margin={{ top: 30, right: 30, left: 10, bottom: 5 }}
                barSize={Math.max(20, Math.min(48, 550 / sorted.length))} barCategoryGap="16%">
                <defs>
                  <linearGradient id="dfgold" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00FF88"/><stop offset="50%" stopColor="#00B864"/><stop offset="100%" stopColor="#005A2B"/></linearGradient>
                  <linearGradient id="dfsilver" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#B8E8C8"/><stop offset="50%" stopColor="#80C890"/><stop offset="100%" stopColor="#4A7A5A"/></linearGradient>
                  <linearGradient id="dfbronze" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#D4A860"/><stop offset="50%" stopColor="#B88630"/><stop offset="100%" stopColor="#7A5020"/></linearGradient>
                  <linearGradient id="dfsteel" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6A8A7A"/><stop offset="50%" stopColor="#4A6A5A"/><stop offset="100%" stopColor="#2A4A3A"/></linearGradient>
                  <linearGradient id="dffail" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FF6B6B"/><stop offset="50%" stopColor="#FF3838"/><stop offset="100%" stopColor="#CC0000"/></linearGradient>
                  <linearGradient id="dfme" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00FF88"/><stop offset="50%" stopColor="#00D4FF"/><stop offset="100%" stopColor="#7B61FF"/></linearGradient>
                  <filter id="dfglow"><feGaussianBlur stdDeviation="3"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                  <filter id="dffailglow"><feGaussianBlur stdDeviation="2"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                </defs>
                <XAxis dataKey="name" tick={false} axisLine={false} tickLine={false} />
                <YAxis hide domain={[0, 'dataMax']} />
                <Bar dataKey={cfg.key} radius={[8,8,0,0]} animationDuration={1200} animationEasing="ease-out">
                  <LabelList dataKey={cfg.key} position="top"
                    formatter={(v: any) => cfg.isMoney ? `¥${v>=1000?(v/1000).toFixed(1)+'K':v}` : `${Math.round(v)}%`}
                    style={{ fontSize: 12, fontWeight: 800, fontFamily: 'monospace', fill: '#A0D8B0' }} />
                  <LabelList dataKey="name" position="top"
                    content={({ x, y, width, index }: any) => {
                      const d = sorted[index]; if (!d) return null;
                      const fail = cfg.threshold>0 && (d[cfg.key]||0) < cfg.threshold;
                      const me = d.name === user?.username;
                      return (
                        <text x={x+width/2} y={y-26} textAnchor="middle"
                          fill={fail?'#FF4757':me?'#00FF88':'#80B090'}
                          fontSize={13} fontWeight={fail||me?800:600} fontFamily="system-ui">
                          {d.name}{me?' ★':''}
                        </text>
                      );
                    }}
                  />
                  {sorted.map((d: any) => {
                    const fail = cfg.threshold>0 && (d[cfg.key]||0) < cfg.threshold;
                    const me = d.name === user?.username;
                    const t3 = d.rank <= 3;
                    return (
                      <Cell key={d.id}
                        fill={fail?'url(#dffail)':t3?['url(#dfgold)','url(#dfsilver)','url(#dfbronze)'][d.rank-1]:me?'url(#dfme)':'url(#dfsteel)'}
                        stroke={fail?'#FF4757':t3?['#00FF88','#B8E8C8','#D4A860'][d.rank-1]:'rgba(0,255,136,0.1)'}
                        strokeWidth={fail||t3?1.5:0.5}
                        filter={t3&&d.rank===1?'url(#dfglow)':fail?'url(#dffailglow)':undefined}
                      />
                    );
                  })}
                </Bar>
                {cfg.threshold > 0 && (
                  <ReferenceLine y={cfg.threshold} stroke="#FF4757" strokeWidth={2} strokeDasharray="8 4"
                    label={{ position:'right', value:`⚠ FAIL ${cfg.isMoney?'¥':''}${cfg.threshold}${cfg.unit}`,
                      fill:'#FF4757', fontSize:12, fontWeight:800, fontFamily:'monospace' }} />
                )}
                <Tooltip cursor={{ fill:'rgba(0,255,136,0.03)' }}
                  content={({ active, payload }: any) => {
                    if (!active||!payload?.length) return null;
                    const d = payload[0].payload;
                    const fail = cfg.threshold>0 && (d[cfg.key]||0) < cfg.threshold;
                    return (
                      <div style={{ background:'#0A0F0A', border:'1px solid rgba(0,255,136,0.2)', borderRadius:12,
                        padding:'14px 18px', boxShadow:'0 8px 32px rgba(0,0,0,0.6)' }}>
                        <div style={{ fontSize:11, color:'#6A8A7A', fontFamily:'monospace' }}>RANK #{d.rank}</div>
                        <div style={{ fontSize:15, fontWeight:800, color:fail?'#FF4757':'#00FF88', marginTop:2 }}>{d.name}</div>
                        <div style={{ fontSize:28, fontWeight:900, color:fail?'#FF4757':'#00FF88', marginTop:4, fontFamily:'monospace' }}>
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

          {/* 底部 */}
          <div style={{ marginTop: 10, textAlign: 'center', fontSize: 10, color: '#3A5A4A', fontFamily: 'monospace', letterSpacing: 1 }}>
            DELTA_FORCE_LEAGUE_v3.0 ‖ {dateStr} ‖ TOTAL:{sorted.length} ‖ FAILED:{failCount}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanionPage;
