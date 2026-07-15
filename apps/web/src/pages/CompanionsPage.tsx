import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Table,
  Tag,
  Typography,
  Button,
  Space,
  message,
  Popconfirm,
  Spin,
  Empty,
  Tooltip,
} from 'antd';
import {
  ReloadOutlined,
  DesktopOutlined,
} from '@ant-design/icons';
import { CompanionStatus } from '@chunlv/shared';
import { companionsApi } from '../api/companions';
import { useAuthStore } from '../stores/authStore';
import {
  companionStatusConfig,
  STATUS_SORT,
  modeLabels,
  HEARTBEAT_THRESHOLD,
} from '../constants';

const { Text } = Typography;

interface CompanionPC {
  currentMode: string;
  isThrottled: boolean;
  lastHeartbeat: string | null;
}

interface Companion {
  id: string;
  status: CompanionStatus;
  games?: any[];
  monthlyRevenue?: number;
  billingCode?: string;
  revenueShare?: number;
  phone?: string;
  realName?: string;
  user?: { username: string; avatar?: string };
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
  const online = diff < HEARTBEAT_THRESHOLD;
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
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const isAdmin = role === 'ADMIN' || role === 'OWNER';

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

  // 60s auto-refresh
  useEffect(() => {
    const t = setInterval(fetchCompanions, 60000);
    return () => clearInterval(t);
  }, [fetchCompanions]);

  const sorted = useMemo(
    () =>
      [...companions].sort(
        (a, b) =>
          (STATUS_SORT[a.status] ?? 9) - (STATUS_SORT[b.status] ?? 9),
      ),
    [companions],
  );

  const loadTimeLogs = useCallback(async (companionId: string) => {
    let shouldFetch = false;

    setTimeLogsCache((prev) => {
      const cached = prev[companionId];
      if (cached?.logs && !cached.error) {
        return prev;
      }
      if (cached?.loading) {
        return prev;
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

  const handleResign = async (id: string) => {
    try {
      await companionsApi.resign(id);
      message.success('陪玩已离职，工位和微信已释放');
      fetchCompanions();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '操作失败';
      message.error(msg);
    }
  };

  const columns = useMemo(() => {
    const cols: any[] = [
      {
        title: '陪玩姓名',
        key: 'name',
        width: 150,
        render: (_: unknown, r: Companion) => {
          const username = r.user?.username || r.id;
          const avatarUrl = r.user?.avatar
            ? `/uploads/avatars/${r.user.avatar}`
            : null;
          return (
            <Space size={8}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: avatarUrl
                    ? `url(${avatarUrl}) center/cover`
                    : '#1677ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {!avatarUrl && (
                  <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>
                    {(username || '?')[0].toUpperCase()}
                  </span>
                )}
              </div>
              <div>
                <Text strong>{username}</Text>
                {r.realName && (
                  <>
                    <br />
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {r.realName}
                    </Text>
                  </>
                )}
              </div>
            </Space>
          );
        },
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 90,
        render: (status: CompanionStatus) => {
          const cfg = companionStatusConfig[status];
          return <Tag color={cfg?.color}>{cfg?.label ?? status}</Tag>;
        },
      },
      {
        title: '游戏',
        dataIndex: 'games',
        key: 'games',
        width: 260,
        render: (games: any[] | undefined) => {
          if (!games || games.length === 0)
            return <Text type="secondary">-</Text>;
          const isProfile = typeof games[0] === 'object';
          return (
            <Space size={[4, 4]} wrap>
              {games.map((g: any, i: number) => {
                if (!isProfile) return <Tag key={i}>{g}</Tag>;
                return (
                  <Tag
                    key={i}
                    style={{ padding: '2px 8px', lineHeight: '20px' }}
                  >
                    {g.game}
                    <span
                      style={{
                        color: '#7B61FF',
                        fontWeight: 600,
                        marginLeft: 4,
                      }}
                    >
                      {g.rank || '?'}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        marginLeft: 2,
                        color: g.hasAccount ? '#34C759' : '#94A3B8',
                      }}
                    >
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
        title: '今日抢单', key: 'todayOrders', width: 80,
        render: (_: unknown, r: any) => <Text strong style={{fontSize:13}}>{r.todayOrderCount ?? '-'}</Text>,
      },
      {
        title: '月收入',
        dataIndex: 'monthlyRevenue',
        key: 'monthlyRevenue',
        width: 110,
        render: (val: number | undefined) => (
          <span style={{ color: '#FF4757', fontWeight: 600 }}>
            ¥{val?.toFixed(2) || '0.00'}
          </span>
        ),
      },
      {
        title: '手机',
        dataIndex: 'phone',
        key: 'phone',
        width: 120,
        render: (v: string | undefined) => v || '-',
      },
      {
        title: 'PC状态',
        key: 'pcStatus',
        width: 200,
        render: (_: unknown, record: Companion) => {
          const hb = formatHeartbeat(record.pc?.lastHeartbeat);
            const isAbnormal = !hb.online && record.status !== 'OFFLINE' && record.pc?.lastHeartbeat !== null;
          return (
            <Space size={4}>
              <Tag color={isAbnormal ? 'red' : (hb.online ? 'green' : 'default')}>
                {React.createElement(DesktopOutlined)}{' '}
                {isAbnormal ? '异常离线' : (hb.online ? '在线' : '离线')}
              </Tag>
              {record.pc?.lastHeartbeat && (
                <Tooltip
                  title={`心跳: ${new Date(record.pc.lastHeartbeat).toLocaleString('zh-CN')}`}
                >
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

    // Admin/Owner only: resign action column
    if (isAdmin) {
      cols.push({
        title: '操作',
        key: 'actions',
        width: 120,
        render: (_: unknown, record: Companion) => (
          <Popconfirm
            title="确认离职处理？"
            description="离职后陪玩状态将设为离线，余额、押金等将清零"
            onConfirm={() => handleResign(record.id)}
            okText="确认"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="link" danger size="small">
              离职处理
            </Button>
          </Popconfirm>
        ),
      });
    }

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Inner component for expandable time log rows
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
          <Empty
            description="暂无时间日志"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </div>
      );
    }

    return (
      <div style={{ padding: '8px 24px 16px' }}>
        <Text
          strong
          style={{ fontSize: 13, marginBottom: 8, display: 'block' }}
        >
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
              <Tag color="blue">
                {modeLabels[log.mode] ?? log.mode}
              </Tag>
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
          marginBottom: 12,
        }}
      >
        <div>
          <Text strong style={{ fontSize: 16 }}>
            {isAdmin ? '员工管理' : role === 'CS' ? '陪玩管理' : '陪玩状态'}
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            共 {companions.length} 位陪玩 · 60s 刷新
          </Text>
        </div>
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
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <Table
        columns={columns}
        dataSource={sorted}
        rowKey="id"
        loading={loading}
        size="small"
        locale={{ emptyText: '暂无陪玩数据' }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 位陪玩`,
        }}
        expandable={{
          expandedRowRender: (record) => (
            <ExpandableRow record={record} />
          ),
          rowExpandable: () => true,
        }}
      />
    </div>
  );
};

export default CompanionsPage;
