import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Table, Tag, Typography, Button, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { CompanionStatus } from '@chunlv/shared';
import { companionsApi } from '../../api/companions';

const { Text } = Typography;

// 排序优先级：空闲 > 在线 > 忙碌 > 离线
const STATUS_SORT: Record<string, number> = {
  IDLE: 0, ONLINE: 1, BUSY: 2, OFFLINE: 3,
};

const statusConfig: Record<CompanionStatus, { color: string; label: string }> = {
  [CompanionStatus.ONLINE]: { color: 'red', label: '在线' },
  [CompanionStatus.IDLE]: { color: 'green', label: '空闲' },
  [CompanionStatus.BUSY]: { color: 'gold', label: '忙碌' },
  [CompanionStatus.OFFLINE]: { color: 'default', label: '离线' },
};

interface Companion {
  id: string;
  user?: { username: string };
  status: CompanionStatus;
  games?: any[];
  monthlyRevenue?: number;
  pc?: { lastHeartbeat?: string; currentMode?: string };
}

const CompanionsStatusPage: React.FC = () => {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCompanions = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await companionsApi.list();
      setCompanions(data.data ?? []);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || '加载失败');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchCompanions(); }, [fetchCompanions]);

  // 空闲优先排序
  const sorted = useMemo(() =>
    [...companions].sort((a, b) => (STATUS_SORT[a.status] ?? 9) - (STATUS_SORT[b.status] ?? 9)),
    [companions]);

  const columns = [
    {
      title: '陪玩', key: 'name', width: 120,
      render: (_: unknown, r: Companion) => (
        <Space>
          <span className={`status-dot ${r.status === 'IDLE' ? 'online' : r.status === 'BUSY' ? 'busy' : r.status === 'OFFLINE' ? 'offline' : 'online'}`} />
          <Text strong>{r.user?.username ?? r.id}</Text>
        </Space>
      ),
    },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (s: CompanionStatus) => <Tag color={statusConfig[s]?.color}>{statusConfig[s]?.label ?? s}</Tag>,
    },
    {
      title: '游戏 / 段位 / 账号', dataIndex: 'games', key: 'games',
      render: (games: any[] | undefined) => {
        if (!games || games.length === 0) return <Text type="secondary">未设置</Text>;
        const isProfile = typeof games[0] === 'object';
        return (
          <Space size={[4, 4]} wrap>
            {games.map((g: any, i: number) => {
              if (!isProfile) return <Tag key={i}>{g}</Tag>;
              return (
                <Tag key={i} color="blue" style={{ padding: '3px 8px', lineHeight: '20px', fontSize: 12 }}>
                  <strong>{g.game}</strong>
                  <span style={{ opacity: 0.85, marginLeft: 4 }}>{g.rank || '?'}</span>
                  <span style={{ fontSize: 10, marginLeft: 4, color: g.hasAccount ? '#00E676' : '#FF9100', fontWeight: 600 }}>
                    {g.hasAccount ? '有号' : '无号'}
                  </span>
                </Tag>
              );
            })}
          </Space>
        );
      },
    },
    {
      title: '月收入', dataIndex: 'monthlyRevenue', width: 110,
      render: (v: number | undefined) => v != null ? <Text style={{ color: '#00D4FF', fontWeight: 600 }}>¥{v.toFixed(2)}</Text> : '-',
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text strong style={{ fontSize: 16 }}>陪玩状态</Text>
        <Button icon={React.createElement(ReloadOutlined)} onClick={fetchCompanions} loading={loading}>刷新</Button>
      </div>
      {error && <div style={{ color: '#ff4d4f', background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, padding: '8px 12px', marginBottom: 16 }}>{error}</div>}
      <Table columns={columns} dataSource={sorted} rowKey="id" loading={loading}
        locale={{ emptyText: '暂无陪玩数据' }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 位陪玩` }} />
    </div>
  );
};

export default CompanionsStatusPage;
