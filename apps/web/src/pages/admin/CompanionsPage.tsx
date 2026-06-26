import React, { useEffect, useState, useCallback } from 'react';
import { Table, Tag, Typography, Button, Space, Spin, Tooltip, Empty } from 'antd';
import { ReloadOutlined, DesktopOutlined } from '@ant-design/icons';
import { CompanionStatus } from '@chunlv/shared';
import { companionsApi } from '../../api/companions';

const { Text } = Typography;

const statusConfig: Record<
  CompanionStatus,
  { color: string; label: string }
> = {
  [CompanionStatus.ONLINE]: { color: 'red', label: '在线' },
  [CompanionStatus.IDLE]: { color: 'green', label: '空闲' },
  [CompanionStatus.BUSY]: { color: 'gold', label: '忙碌' },
  [CompanionStatus.OFFLINE]: { color: 'default', label: '离线' },
};

interface CompanionPC {
  currentMode: string;
  isThrottled: boolean;
  lastHeartbeat: string | null;
}

interface Companion {
  id: string;
  status: CompanionStatus;
  games?: string[];
  monthlyRevenue?: number;
  billingCode?: string;
  revenueShare?: number;
  user?: { username: string };
  pc?: CompanionPC | null;
}

interface TimeLog {
  id: string;
  companionId: string;
  mode: string;
  startedAt: string;
  endedAt?: string | null;
  durationSeconds: number;
}

const modeLabels: Record<string, string> = {
  ENTERTAINMENT: '娱乐模式',
  WORK: '工作模式',
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}时${rm}分` : `${h}小时`;
}

function formatHeartbeat(heartbeat: string | null | undefined): {
  online: boolean;
  text: string;
} {
  if (!heartbeat) return { online: false, text: '离线' };
  const dt = new Date(heartbeat);
  const now = Date.now();
  const diff = now - dt.getTime();
  const online = diff < 120_000; // 2 minute threshold
  const timeStr = dt.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return {
    online,
    text: online ? `在线 · ${timeStr}` : `离线 · ${timeStr}`,
  };
}

const CompanionsPage: React.FC = () => {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Expanded row time logs cache
  const [timeLogsCache, setTimeLogsCache] = useState<
    Record<string, { loading: boolean; logs: TimeLog[]; error?: string }>
  >({});

  const fetchCompanions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await companionsApi.list();
      setCompanions(data.data ?? []);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        '加载陪玩列表失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompanions();
  }, [fetchCompanions]);

  const loadTimeLogs = useCallback(async (companionId: string) => {
    let shouldFetch = false;

    // Use functional setState to check cache atomically — no stale closure on timeLogsCache
    setTimeLogsCache((prev) => {
      const cached = prev[companionId];
      if (cached?.logs && !cached.error) {
        return prev; // Already have data, skip
      }
      if (cached?.loading) {
        return prev; // Already in-flight, skip
      }
      shouldFetch = true;
      return {
        ...prev,
        [companionId]: { loading: true, logs: [], error: undefined },
      };
    });

    if (!shouldFetch) return;

    try {
      const { data } = await companionsApi.getById(companionId);
      const detail = data.data as any;
      const logs: TimeLog[] = detail?.timeLogs ?? [];
      setTimeLogsCache((prev) => ({
        ...prev,
        [companionId]: { loading: false, logs },
      }));
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || '加载时间日志失败';
      setTimeLogsCache((prev) => ({
        ...prev,
        [companionId]: { loading: false, logs: [], error: msg },
      }));
    }
  }, []);

  const columns = [
    {
      title: '陪玩姓名',
      dataIndex: ['user', 'username'],
      key: 'username',
      width: 130,
      render: (name: string | undefined) =>
        name ?? <Text type="secondary">-</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: CompanionStatus) => {
        const cfg = statusConfig[status];
        return <Tag color={cfg?.color}>{cfg?.label ?? status}</Tag>;
      },
    },
    {
      title: '游戏',
      dataIndex: 'games',
      key: 'games',
      render: (games: any[] | undefined) => {
        if (!games || games.length === 0) return <Text type="secondary">-</Text>;
        const isProfile = typeof games[0] === 'object';
        return (
          <Space size={[4, 4]} wrap>
            {games.map((g: any, i: number) => {
              if (!isProfile) return <Tag key={i}>{g}</Tag>;
              return (
                <Tag key={i} style={{ padding: '2px 8px', lineHeight: '20px' }}>
                  {g.game}
                  <span style={{ color: '#7B61FF', fontWeight: 600, marginLeft: 4 }}>
                    {g.rank || '?'}
                  </span>
                  <span style={{ fontSize: 10, marginLeft: 2, color: g.hasAccount ? '#00E676' : '#94A3B8' }}>
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
      title: '本月收入',
      dataIndex: 'monthlyRevenue',
      key: 'monthlyRevenue',
      width: 130,
      render: (val: number | undefined) =>
        val != null ? `¥${val.toFixed(2)}` : '-',
    },
    {
      title: 'PC 状态',
      key: 'pcStatus',
      width: 200,
      render: (_: unknown, record: Companion) => {
        const hb = formatHeartbeat(record.pc?.lastHeartbeat);
        return (
          <Space size={4}>
            <Tag color={hb.online ? 'green' : 'default'}>
              {React.createElement(DesktopOutlined)}
              {' '}{hb.online ? '在线' : '离线'}
            </Tag>
            {record.pc?.lastHeartbeat && (
              <Tooltip title={`心跳: ${new Date(record.pc.lastHeartbeat).toLocaleString('zh-CN')}`}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {new Date(record.pc.lastHeartbeat).toLocaleString('zh-CN', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  // Inner component with useEffect to avoid side effects during render
  const ExpandableRow: React.FC<{ record: Companion }> = ({ record }) => {
    const cache = timeLogsCache[record.id];

    useEffect(() => {
      loadTimeLogs(record.id);
    }, [record.id, loadTimeLogs]);

    if (!cache) {
      return (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Spin tip="加载中..." />
        </div>
      );
    }

    if (cache.loading) {
      return (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Spin tip="加载中..." />
        </div>
      );
    }

    if (cache.error) {
      return (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Text type="danger">{cache.error}</Text>
        </div>
      );
    }

    if (!cache.logs || cache.logs.length === 0) {
      return (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Empty description="暂无时间日志" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      );
    }

    return (
      <div style={{ padding: '8px 24px 16px' }}>
        <Text strong style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>
          最近时间日志
        </Text>
        {cache.logs.map((log) => (
          <div
            key={log.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '6px 0',
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            <Space size="middle">
              <Tag color="blue">{modeLabels[log.mode] ?? log.mode}</Tag>
              <Text style={{ fontSize: 13 }}>
                {new Date(log.startedAt).toLocaleString('zh-CN')}
                {log.endedAt
                  ? ` — ${new Date(log.endedAt).toLocaleString('zh-CN')}`
                  : ' — 进行中'}
              </Text>
            </Space>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {formatDuration(log.durationSeconds)}
            </Text>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Text strong style={{ fontSize: 16 }}>
          陪玩管理
        </Text>
        <Space>
          <Button
            icon={React.createElement(ReloadOutlined)}
            onClick={() => {
              setTimeLogsCache({});
              fetchCompanions();
            }}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>

      {error && (
        <div
          style={{
            color: '#ff4d4f',
            background: '#fff2f0',
            border: '1px solid #ffccc7',
            borderRadius: 6,
            padding: '8px 12px',
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <Table
        columns={columns}
        dataSource={companions}
        rowKey="id"
        loading={loading}
        locale={{ emptyText: '暂无陪玩数据' }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 位陪玩`,
        }}
        expandable={{
          expandedRowRender: (record) => <ExpandableRow record={record} />,
          rowExpandable: () => true,
        }}
      />
    </div>
  );
};

export default CompanionsPage;
