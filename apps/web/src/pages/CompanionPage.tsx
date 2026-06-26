import React, { useEffect, useState, useCallback } from 'react';
import { Typography, Row, Col, Tag, message } from 'antd';
import { FireOutlined, CrownOutlined } from '@ant-design/icons';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';

const { Text } = Typography;
const IconFire = React.createElement(FireOutlined);
const IconCrown = React.createElement(CrownOutlined);

// 排名徽章颜色
const MEDAL_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];

const CompanionPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [ranking, setRanking] = useState<any[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const [rankRes, compRes] = await Promise.all([
        http.get('/companions/ranking'),
        user?.companionId ? http.get(`/companions/${user.companionId}`) : Promise.resolve(null),
      ]);
      const list = rankRes.data.data ?? [];
      setRanking(list);
      const idx = list.findIndex((c: any) => c.user?.username === user?.username);
      setMyRank(idx >= 0 ? idx + 1 : null);
    } catch { message.error('加载排行榜失败'); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { const t = setInterval(fetch, 30000); return () => clearInterval(t); }, [fetch]);

  const top3 = ranking.slice(0, 3);
  const rest = ranking.slice(3);
  const maxRevenue = ranking[0]?.monthlyRevenue || 1;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24, textAlign: 'center' }}>
        <Text style={{ fontSize: 26, fontWeight: 800, letterSpacing: 1,
          background: 'linear-gradient(135deg, #FFD700, #FF6B35, #FFD700)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          🏆 业绩排行榜
        </Text>
        <div style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>本月收入排行 · 实时刷新</Text>
          {myRank && <Tag color="gold" style={{ marginLeft: 8, fontWeight: 600 }}>我的排名: #{myRank}</Tag>}
        </div>
      </div>

      {/* 前三名领奖台 */}
      <Row gutter={16} style={{ marginBottom: 28 }}>
        {top3.length >= 2 && (
          <Col span={8} style={{ textAlign: 'center', paddingTop: 40 }}>
            <PodiumCard rank={2} data={top3[1]} maxRevenue={maxRevenue} />
          </Col>
        )}
        {top3.length >= 1 && (
          <Col span={8} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, animation: 'pulse-glow 2s infinite', marginBottom: 4 }}>👑</div>
            <PodiumCard rank={1} data={top3[0]} maxRevenue={maxRevenue} />
          </Col>
        )}
        {top3.length >= 3 && (
          <Col span={8} style={{ textAlign: 'center', paddingTop: 60 }}>
            <PodiumCard rank={3} data={top3[2]} maxRevenue={maxRevenue} />
          </Col>
        )}
      </Row>

      {/* 其余排名 */}
      {rest.length > 0 && (
        <div style={{ background: '#FFF', borderRadius: 16, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          {rest.map((c: any, i: number) => {
            const rank = i + 4;
            const isMe = c.user?.username === user?.username;
            const pct = Math.round((c.monthlyRevenue / maxRevenue) * 100);
            return (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '10px 12px',
                background: isMe ? 'linear-gradient(90deg, rgba(0,212,255,0.08), transparent)' : 'transparent',
                borderRadius: 10, marginBottom: 4, transition: 'all 0.2s',
              }}>
                <span style={{ width: 32, textAlign: 'center', fontSize: 14, fontWeight: 700, color: rank <= 5 ? '#7B61FF' : '#94A3B8' }}>
                  #{rank}
                </span>
                <span style={{ flex: 1, fontSize: 14, fontWeight: isMe ? 700 : 500, color: isMe ? '#00D4FF' : '#1E293B' }}>
                  {c.user?.username || c.id} {isMe && <Tag color="cyan" style={{ fontSize: 10, marginLeft: 4 }}>我</Tag>}
                </span>
                <div style={{ flex: 2, background: '#F1F5F9', borderRadius: 6, height: 8, overflow: 'hidden', maxWidth: 200 }}>
                  <div style={{ width: `${pct}%`, height: '100%', borderRadius: 6,
                    background: isMe ? 'linear-gradient(90deg, #00D4FF, #7B61FF)' : '#CBD5E1',
                    transition: 'width 0.8s ease' }} />
                </div>
                <span style={{ width: 100, textAlign: 'right', fontSize: 15, fontWeight: 700, color: '#FF4757' }}>
                  ¥{c.monthlyRevenue?.toFixed(2) || '0.00'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {loading && ranking.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#94A3B8' }}>加载中...</div>
      )}
    </div>
  );
};

// 领奖台卡片
const PodiumCard: React.FC<{ rank: number; data: any; maxRevenue: number }> = ({ rank, data, maxRevenue }) => {
  const pct = Math.round((data?.monthlyRevenue / maxRevenue) * 100);
  return (
    <div style={{
      background: rank === 1 ? 'linear-gradient(180deg, #FFF9E6, #FFFDF5)' : '#FFF',
      borderRadius: 16, padding: '20px 16px 16px',
      border: rank === 1 ? '2px solid #FFD700' : '1px solid #E2E8F0',
      boxShadow: rank === 1 ? '0 4px 24px rgba(255,215,0,0.3)' : '0 1px 3px rgba(0,0,0,0.04)',
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)',
        width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: MEDAL_COLORS[rank - 1], color: '#FFF', fontSize: 18, fontWeight: 800,
        boxShadow: `0 2px 12px ${MEDAL_COLORS[rank - 1]}80`,
      }}>
        {rank === 1 ? IconCrown : rank === 2 ? IconFire : rank}
      </div>
      <div style={{ marginTop: 10, fontSize: 16, fontWeight: 700, color: '#1E293B', marginBottom: 2 }}>
        {data?.user?.username || data?.id}
      </div>
      <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 10 }}>
        {rank === 1 ? '👑 冠军' : rank === 2 ? '🥈 亚军' : '🥉 季军'}
      </div>
      <div style={{ background: '#F1F5F9', borderRadius: 8, height: 10, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ width: `${Math.max(pct, 10)}%`, height: '100%', borderRadius: 8,
          background: rank === 1 ? 'linear-gradient(90deg, #FFD700, #FFA500)' :
                     rank === 2 ? 'linear-gradient(90deg, #C0C0C0, #9E9E9E)' :
                                 'linear-gradient(90deg, #CD7F32, #A0522D)',
          transition: 'width 1s ease' }} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#FF4757' }}>
        ¥{data?.monthlyRevenue?.toFixed(2) || '0.00'}
      </div>
      <div style={{ fontSize: 11, color: '#94A3B8' }}>本月收入</div>
    </div>
  );
};

export default CompanionPage;
