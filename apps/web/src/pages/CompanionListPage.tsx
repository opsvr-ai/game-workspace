import React, { useEffect, useState, useCallback } from 'react';
import { Table, Tag, Typography, Button, Space, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import http from '../api/client';
import { companionStatusConfig } from '../constants';

const { Text } = Typography;

const CompanionListPage: React.FC = () => {
  const [companions, setCompanions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await http.get('/companions');
      setCompanions(data.data ?? []);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { const t = setInterval(fetch, 60000); return () => clearInterval(t); }, [fetch]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Text strong style={{ fontSize: 16 }}>陪玩管理</Text>
          <br /><Text type="secondary" style={{ fontSize: 12 }}>共 {companions.length} 位陪玩 · 60s 刷新</Text>
        </div>
        <Button icon={React.createElement(ReloadOutlined)} onClick={fetch} loading={loading}>刷新</Button>
      </div>
      <Table size="small" dataSource={companions} rowKey="id" loading={loading}
        columns={[
          {
            title: '陪玩', key: 'name', width: 130,
            render: (_: any, r: any) => (
              <Space>
                <span style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
                  background: r.status === 'BUSY' ? '#FF4757' : r.status === 'AVAILABLE' ? '#00E676' :
                    r.status === 'WAITING' ? '#06B6D4' : r.status === 'ENTERTAINMENT' ? '#FFD600' : r.status === 'RESTING' ? '#FF9500' : '#94A3B8',
                  boxShadow: r.status !== 'OFFLINE' && r.status !== 'RESTING' ? `0 0 6px ${r.status === 'BUSY' ? '#FF4757' : r.status === 'AVAILABLE' ? '#00E676' : r.status === 'WAITING' ? '#06B6D4' : '#FFD600'}` : 'none',
                }} />
                <Text strong>{r.user?.username || r.id}</Text>
                {r.realName && <Text type="secondary" style={{ fontSize: 11 }}>{r.realName}</Text>}
              </Space>
            ),
          },
          { title: '状态', dataIndex: 'status', width: 80,
            render: (s: string) => <Tag color={companionStatusConfig[s]?.color}>{companionStatusConfig[s]?.label || s}</Tag> },
          { title: '游戏', dataIndex: 'games', width: 260,
            render: (games: any[]) => {
              if (!games?.length) return <Text type="secondary">未设置</Text>;
              const isObj = typeof games[0] === 'object';
              return (
                <Space size={[4,4]} wrap>
                  {games.map((g: any, i: number) => (
                    <Tag key={i} style={{ fontSize: 11, padding: '1px 6px' }}>
                      {isObj ? <>{g.game} <span style={{ color: '#7B61FF' }}>{g.rank||'?'}</span> <span style={{ color: g.hasAccount ? '#34C759' : '#94A3B8', fontSize: 10 }}>{g.hasAccount?'有号':'无号'}</span></> : g}
                    </Tag>
                  ))}
                </Space>
              );
            },
          },
          { title: '月收入', dataIndex: 'monthlyRevenue', width: 110,
            render: (v: number) => <span style={{ color: '#FF4757', fontWeight: 600 }}>¥{v?.toFixed(2) || '0.00'}</span> },
          { title: '手机', dataIndex: 'phone', width: 120, render: (v: string) => v || '-' },
          { title: 'PC状态', key: 'pc', width: 100,
            render: (_: any, r: any) => {
              const online = r.pc?.lastHeartbeat && (Date.now() - new Date(r.pc.lastHeartbeat).getTime() < 120000);
              return online ? <Tag color="green">在线</Tag> : <Tag color="default">离线</Tag>;
            },
          },
        ]}
        pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 位` }}
      />
    </div>
  );
};

export default CompanionListPage;
