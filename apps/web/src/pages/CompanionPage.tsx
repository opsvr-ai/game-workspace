import React, { useEffect, useState, useCallback } from 'react';
import { Typography, Tag, message } from 'antd';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';

const { Text } = Typography;

const CompanionPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [ranking, setRanking] = useState<any[]>([]);

  const fetch = useCallback(async () => {
    try {
      const res = await http.get('/companions/ranking');
      setRanking(res.data.data ?? []);
    } catch { message.error('加载失败'); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { const t = setInterval(fetch, 30000); return () => clearInterval(t); }, [fetch]);

  const maxRev = ranking[0]?.monthlyRevenue || 1;
  const myRank = ranking.findIndex((c: any) => c.user?.username === user?.username) + 1;

  return (
    <div style={{ maxWidth: 900 }}>
      <style>{`
        @keyframes bolt { 0%,100% { opacity:0.3 } 50% { opacity:1 } }
        @keyframes sprint {
          0% { transform: translateX(-100%); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translateX(0); opacity: 1; }
        }
        @keyframes metal-arrow {
          0% { transform: translateX(-20px); opacity: 0.3; filter: brightness(1); }
          50% { transform: translateX(0); opacity: 1; filter: brightness(1.6); }
          100% { transform: translateX(20px); opacity: 0.3; filter: brightness(1); }
        }
        .rank-row { animation: sprint 0.6s ease-out forwards; opacity: 0; }
        .rank-row:nth-child(1) { animation-delay: 0.03s; }
        .rank-row:nth-child(2) { animation-delay: 0.06s; }
        .rank-row:nth-child(3) { animation-delay: 0.09s; }
        .rank-row:nth-child(4) { animation-delay: 0.12s; }
        .rank-row:nth-child(5) { animation-delay: 0.15s; }
        .rank-row:nth-child(6) { animation-delay: 0.18s; }
        .rank-row:nth-child(7) { animation-delay: 0.21s; }
        .rank-row:nth-child(8) { animation-delay: 0.24s; }
        .rank-row:nth-child(9) { animation-delay: 0.27s; }
        .rank-row:nth-child(10) { animation-delay: 0.30s; }
        .rank-row:nth-child(11) { animation-delay: 0.33s; }
        .rank-row:nth-child(12) { animation-delay: 0.36s; }
        .arrow-metal {
          display: inline-block; width: 0; height: 0;
          border-top: 7px solid transparent;
          border-bottom: 7px solid transparent;
          border-left: 14px solid;
          border-left-color: inherit;
          filter: drop-shadow(0 0 3px currentColor);
        }
      `}</style>

      {/* 标题 */}
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <Text style={{
            fontSize: 24, fontWeight: 800, letterSpacing: 1,
            background: 'linear-gradient(90deg, #7B61FF, #00D4FF, #7B61FF)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            backgroundSize: '200% 100%', animation: 'bolt 2s ease-in-out infinite',
          }}>
            ▶ 业绩排行榜
          </Text>
          <br /><Text type="secondary" style={{ fontSize: 12 }}>LIGHTNING LEAGUE · 本月收入冲刺</Text>
        </div>
        <div style={{ display: 'flex', gap: 20, textAlign: 'center' }}>
          <div><div style={{ fontSize: 11, color: '#94A3B8' }}>选手</div><div style={{ fontSize: 20, fontWeight: 700, color: '#7B61FF' }}>{ranking.length}</div></div>
          <div><div style={{ fontSize: 11, color: '#94A3B8' }}>总奖金</div><div style={{ fontSize: 20, fontWeight: 700, color: '#FF4757' }}>¥{ranking.reduce((s: number, c: any) => s + (c.monthlyRevenue || 0), 0).toLocaleString()}</div></div>
          {myRank > 0 && <div><div style={{ fontSize: 11, color: '#94A3B8' }}>我的排名</div><div style={{ fontSize: 20, fontWeight: 700, color: '#00D4FF' }}>#{myRank}</div></div>}
        </div>
      </div>

      {/* 表头 */}
      <div style={{ display: 'flex', alignItems: 'center', background: '#0F172A', borderRadius: 10, padding: '8px 20px', color: '#64748B', fontSize: 11, fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>
        <span style={{ width: 36 }}>RK</span><span style={{ flex: 1 }}>选手</span>
        <span style={{ width: 60, textAlign: 'center' }}>段位</span>
        <span style={{ width: 50, textAlign: 'center' }}>游戏</span>
        <span style={{ flex: 2 }}>冲刺</span>
        <span style={{ width: 110, textAlign: 'right' }}>收入</span>
      </div>

      {/* 排名行 */}
      {ranking.map((c: any, i: number) => {
        const isMe = c.user?.username === user?.username;
        const pct = Math.round((c.monthlyRevenue / maxRev) * 100);
        const rank = i + 1;
        const games = Array.isArray(c.games) ? c.games : [];
        const topGame = games[0];
        const topRank = topGame?.rank || '?';

        return (
          <div key={c.id} className="rank-row" style={{
            display: 'flex', alignItems: 'center',
            background: isMe ? 'linear-gradient(90deg, rgba(0,212,255,0.08), rgba(123,97,255,0.04))' : '#FFF',
            padding: '10px 20px', marginBottom: 2, borderRadius: 8,
            border: isMe ? '1px solid rgba(0,212,255,0.2)' : '1px solid transparent',
            position: 'relative', overflow: 'hidden',
          }}>
            {/* 闪电背景条 */}
            <div style={{
              position: 'absolute', inset: 0, borderRadius: 8,
              background: `linear-gradient(90deg, rgba(192,192,192,0.08) 0%, rgba(212,175,55,0.06) ${pct}%, transparent ${pct}%)`,
              transition: 'all 1.5s ease',
            }} />

            {/* 排名 */}
            <span style={{ width: 36, zIndex: 1, fontWeight: 800, fontSize: 15, color: rank <= 3 ? '#FFD700' : '#94A3B8' }}>
              {rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : rank}
            </span>

            {/* 名字 */}
            <span style={{ flex: 1, zIndex: 1, fontSize: 14, fontWeight: isMe ? 700 : 600, color: isMe ? '#00D4FF' : '#1E293B' }}>
              {c.user?.username || c.id}
              {isMe && <Tag color="cyan" style={{ fontSize: 10, marginLeft: 6 }}>我</Tag>}
            </span>

            {/* 段位 */}
            <span style={{ width: 60, zIndex: 1, textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#7B61FF' }}>{topRank}</span>

            {/* 游戏数 */}
            <span style={{ width: 50, zIndex: 1, textAlign: 'center', fontSize: 12, color: '#64748B' }}>{games.length || '-'}</span>

            {/* 冲刺进度条 */}
            <span style={{ flex: 2, zIndex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
              <span style={{
                flex: 1, height: 6, borderRadius: 3,
                background: '#F1F5F9', overflow: 'hidden', position: 'relative',
              }}>
                <span style={{
                  display: 'block', height: '100%', borderRadius: 3, width: `${pct}%`,
                  background: isMe
                    ? 'linear-gradient(90deg, #00D4FF, #C0C0C0, #7B61FF)'
                    : rank <= 3
                      ? 'linear-gradient(90deg, #FFD700, #FFF8DC, #FFD700)'
                      : 'linear-gradient(90deg, #B8B8B8, #E8E8E8, #A0A0A0)',
                  transition: 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  position: 'relative',
                }}>
                  <span style={{
                    position: 'absolute', right: -12, top: -6,
                    display: 'inline-block',
                    width: 0, height: 0,
                    borderTop: '7px solid transparent',
                    borderBottom: '7px solid transparent',
                    borderLeft: '14px solid currentColor',
                    filter: 'drop-shadow(0 0 4px currentColor)',
                    animation: 'metal-arrow 1.2s ease-in-out infinite',
                    color: isMe ? '#00D4FF' : rank <= 3 ? '#FFD700' : '#C0C0C0',
                  }} />
                </span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: pct > 50 ? '#34C759' : '#94A3B8', minWidth: 36, textAlign: 'right' }}>
                {pct}%
              </span>
            </span>

            {/* 收入 */}
            <span style={{
              width: 110, zIndex: 1, textAlign: 'right', fontSize: 16, fontWeight: 800,
              color: rank === 1 ? '#FFD700' : isMe ? '#00D4FF' : '#FF4757',
            }}>
              ¥{c.monthlyRevenue?.toLocaleString() || '0'}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default CompanionPage;
