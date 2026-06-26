import React, { useEffect, useState, useCallback } from 'react';
import { Typography, Tag, message } from 'antd';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';

const { Text } = Typography;

const CompanionPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [ranking, setRanking] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await http.get('/companions/ranking');
      setRanking(res.data.data ?? []);
    } catch { message.error('加载排行榜失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { const t = setInterval(fetch, 30000); return () => clearInterval(t); }, [fetch]);

  const myRank = ranking.findIndex((c: any) => c.user?.username === user?.username) + 1;
  const maxRev = ranking[0]?.monthlyRevenue || 1;

  return (
    <div style={{ maxWidth: 900 }}>
      {/* 标题栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
        <div>
          <Text strong style={{ fontSize: 20 }}>🏆 业绩排行榜</Text>
          <br /><Text type="secondary" style={{ fontSize: 13 }}>CHUNLV ESPORTS · 本月收入</Text>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#94A3B8' }}>总选手</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#1E293B' }}>{ranking.length}</div>
        </div>
      </div>

      {/* 表头 */}
      <div style={{
        display: 'flex', alignItems: 'center',
        background: '#0F172A', borderRadius: '10px 10px 0 0',
        padding: '10px 20px', color: '#94A3B8', fontSize: 11, fontWeight: 600,
        letterSpacing: 0.5, textTransform: 'uppercase',
      }}>
        <span style={{ width: 40 }}>#</span>
        <span style={{ flex: 1 }}>选手</span>
        <span style={{ width: 80, textAlign: 'center' }}>段位</span>
        <span style={{ width: 100, textAlign: 'center' }}>游戏数</span>
        <span style={{ width: 70, textAlign: 'center' }}>胜率</span>
        <span style={{ width: 120, textAlign: 'right' }}>收入</span>
      </div>

      {/* 数据行 */}
      {ranking.map((c: any, i: number) => {
        const isMe = c.user?.username === user?.username;
        const pct = Math.round((c.monthlyRevenue / maxRev) * 100);
        const rank = i + 1;
        const games = Array.isArray(c.games) ? c.games : [];
        const topRank = c.games?.[0]?.rank || '?';
        const gameCount = games.length;

        return (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center',
            background: isMe ? 'linear-gradient(90deg, rgba(0,212,255,0.06), rgba(0,212,255,0.02), transparent)' :
              i % 2 === 0 ? '#FAFBFC' : '#FFF',
            padding: '14px 20px',
            borderBottom: '1px solid #F1F5F9',
            transition: 'background 0.2s',
            position: 'relative',
          }}>
            {/* 排名 */}
            <span style={{ width: 40, fontWeight: 700, fontSize: 15, color: rank <= 3 ? '#FFD700' : rank <= 5 ? '#7B61FF' : '#94A3B8' }}>
              {rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : rank}
            </span>
            {/* 选手名 */}
            <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                fontWeight: isMe ? 700 : 600, fontSize: 15, color: isMe ? '#00D4FF' : '#1E293B',
              }}>
                {c.user?.username || c.id}
              </span>
              {isMe && <Tag color="cyan" style={{ fontSize: 10, margin: 0 }}>我</Tag>}
              {rank <= 3 && <span style={{ fontSize: 11, color: '#94A3B8' }}>{['MVP','ACE','PRO'][rank-1]}</span>}
            </span>
            {/* 段位 */}
            <span style={{ width: 80, textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#7B61FF' }}>
              {topRank}
            </span>
            {/* 游戏数 */}
            <span style={{ width: 100, textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#475569' }}>
              {gameCount || '-'}
            </span>
            {/* 胜率条 */}
            <span style={{ width: 70, textAlign: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: pct > 50 ? '#34C759' : '#94A3B8' }}>
                {pct}%
              </span>
            </span>
            {/* 收入 */}
            <span style={{ width: 120, textAlign: 'right', fontSize: 16, fontWeight: 800, color: '#FF4757' }}>
              ¥{c.monthlyRevenue?.toLocaleString() || '0'}
            </span>
          </div>
        );
      })}

      {loading && ranking.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#94A3B8', background: '#FFF', borderRadius: '0 0 10px 10px' }}>
          加载中...
        </div>
      )}

      {/* 底部汇总 */}
      <div style={{
        background: '#F8FAFC', borderRadius: '0 0 10px 10px', padding: '10px 20px',
        display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94A3B8',
      }}>
        <span>共 {ranking.length} 名选手</span>
        <span>总奖金 ¥{ranking.reduce((s: number, c: any) => s + (c.monthlyRevenue || 0), 0).toLocaleString()}</span>
        {myRank > 0 && <span>我的排名: <b style={{ color: '#00D4FF' }}>#{myRank}</b></span>}
        <span>每 30s 更新</span>
      </div>
    </div>
  );
};

export default CompanionPage;
