// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { extractErrorMessage } from '../utils/error-handler';
import { Table, Tag, Typography, Button, Space, message, Popconfirm, Spin, Tooltip, Card, Input, Select } from 'antd';
import { ReloadOutlined, DesktopOutlined, SearchOutlined } from '@ant-design/icons';
import { CompanionStatus } from '@chunlv/shared';
import { companionsApi } from '../api/companions';
import { useAuthStore } from '../stores/authStore';
import { companionStatusConfig, STATUS_SORT, modeLabels, HEARTBEAT_THRESHOLD } from '../constants';
import ErrorBanner from '../components/ErrorBanner';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import TableSkeleton from '../components/TableSkeleton';

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

  // Filters
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [gameFilter, setGameFilter] = useState<string | undefined>();

  const GAME_OPTIONS = ['王者荣耀', '英雄联盟', '和平精英', '无畏契约', '永劫无间', 'CS2', 'DOTA2', 'APEX', '其他'];

  const STATUS_TABS: { label: string; value: string | undefined }[] = [
    { label: '全部', value: undefined },
    { label: '在线', value: 'AVAILABLE' },
    { label: '忙碌', value: 'BUSY' },
    { label: '娱乐', value: 'ENTERTAINMENT' },
    { label: '休息', value: 'RESTING' },
    { label: '离线', value: 'OFFLINE' },
  ];

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
      setError(extractErrorMessage(err, '加载陪玩列表失败'));
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

  const sorted = useMemo(() => {
    let list = [...companions];

    // Name search
    if (searchText) {
      const lower = searchText.toLowerCase();
      list = list.filter((c) => (c.user?.username || '').toLowerCase().includes(lower));
    }

    // Status filter
    if (statusFilter) {
      list = list.filter((c) => c.status === statusFilter);
    }

    // Game filter — checks companions.games array for string or object {game}
    if (gameFilter) {
      list = list.filter((c) => {
        if (!c.games || c.games.length === 0) return false;
        return c.games.some((g: any) => {
          if (typeof g === 'string') return g === gameFilter;
          return g.game === gameFilter;
        });
      });
    }

    return list.sort((a, b) => (STATUS_SORT[a.status] ?? 9) - (STATUS_SORT[b.status] ?? 9));
  }, [companions, searchText, statusFilter, gameFilter]);

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
      setTimeLogsCache((prev) => ({
        ...prev,
        [companionId]: { loading: false, logs: [], error: extractErrorMessage(err, '加载时间日志失败') },
      }));
    }
  }, []);

  const handleResign = async (id: string) => {
    try {
      await companionsApi.resign(id);
      message.success('陪玩已离职，工位和微信已释放');
      fetchCompanions();
    } catch (err: any) {
      message.error(extractErrorMessage(err, '操作失败'));
    }
  };

  const columns = useMemo(() => {
    const cols: any[] = [
      {
        title: '陪玩姓名',
        key: 'name',
        width: 90,
        render: (_: unknown, r: Companion) => {
          const username = r.user?.username || r.id;
          const avatarUrl = r.user?.avatar ? `/uploads/avatars/${r.user.avatar}?v=${r.user.avatar}` : null;
          return (
            <Space size={8}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: avatarUrl ? `url(${avatarUrl}) center/cover` : '#1677ff',
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
        width: 70,
        render: (status: CompanionStatus) => {
          const cfg = companionStatusConfig[status];
          return <Tag color={cfg?.color}>{cfg?.label ?? status}</Tag>;
        },
      },
      {
        title: '游戏',
        dataIndex: 'games',
        key: 'games',
        width: 180,
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
                    <span
                      style={{
                        color: '#7C3AED',
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
        title: '今日接单数量',
        key: 'todayOrders',
        width: 80,
        render: (_: unknown, r: any) => (
          <Text strong style={{ fontSize: 13 }}>
            {r.todayOrderCount ?? '-'}
          </Text>
        ),
      },
      {
        title: '月收入',
        dataIndex: 'monthlyRevenue',
        key: 'monthlyRevenue',
        width: 80,
        render: (val: number | undefined) => (
          <span style={{ color: '#FF4757', fontWeight: 600 }}>¥{val?.toFixed(2) || '0.00'}</span>
        ),
      },
      {
        title: '手机',
        dataIndex: 'phone',
        key: 'phone',
        width: 90,
        render: (v: string | undefined) => v || '-',
      },
      {
        title: 'PC状态',
        key: 'pcStatus',
        width: 140,
        render: (_: unknown, record: Companion) => {
          const hb = formatHeartbeat(record.pc?.lastHeartbeat);
          const isAbnormal = !hb.online && record.status !== 'OFFLINE' && record.pc?.lastHeartbeat !== null;
          return (
            <Space size={4}>
              <Tag color={isAbnormal ? 'red' : hb.online ? 'green' : 'default'}>
                {React.createElement(DesktopOutlined)} {isAbnormal ? '异常离线' : hb.online ? '在线' : '离线'}
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

    // Admin/Owner only: resign action column
    if (isAdmin) {
      cols.push({
        title: '操作',
        key: 'actions',
        width: 90,
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
          <EmptyState description="暂无时间日志" />
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
                {log.endedAt ? ` — ${new Date(log.endedAt).toLocaleString('zh-CN')}` : ' — 进行中'}
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
      <PageHeader
        title={isAdmin ? '员工管理' : role === 'CS' ? '陪玩管理' : '陪玩状态'}
        subtitle={`共 ${companions.length} 位陪玩 · 60s 刷新`}
        extra={
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
        }
      />

      {error && <ErrorBanner message={error} onRetry={fetchCompanions} />}

      {loading && companions.length === 0 ? (
        <TableSkeleton columns={6} rows={5} />
      ) : (
        <Card size="small" style={{ overflow: 'auto' }}>
          {/* Filter row */}
          <div style={{ marginBottom: 12 }}>
            <Space size="middle" wrap style={{ marginBottom: 8 }}>
              <Input
                placeholder="搜索陪玩姓名"
                allowClear
                style={{ width: 180 }}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                prefix={React.createElement(SearchOutlined)}
              />
              <Select
                placeholder="状态筛选"
                allowClear
                style={{ width: 120 }}
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { label: '空闲', value: 'AVAILABLE' },
                  { label: '接单', value: 'BUSY' },
                  { label: '娱乐', value: 'ENTERTAINMENT' },
                  { label: '休息', value: 'RESTING' },
                  { label: '离线', value: 'OFFLINE' },
                ]}
              />
              <Select
                placeholder="游戏筛选"
                allowClear
                style={{ width: 130 }}
                value={gameFilter}
                onChange={setGameFilter}
                options={GAME_OPTIONS.map((g) => ({ label: g, value: g }))}
              />
            </Space>
            {/* Status quick-tabs */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {STATUS_TABS.map((tab) => (
                <Tag
                  key={tab.label}
                  style={{
                    cursor: 'pointer',
                    padding: '2px 12px',
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: statusFilter === tab.value ? 600 : 400,
                    border: statusFilter === tab.value
                      ? '1px solid #2563EB'
                      : '1px solid #E2E8F0',
                    background: statusFilter === tab.value ? '#EFF6FF' : '#FFFFFF',
                    color: statusFilter === tab.value ? '#2563EB' : '#64748B',
                  }}
                  onClick={() => setStatusFilter(tab.value)}
                >
                  {tab.label}
                </Tag>
              ))}
            </div>
          </div>

          <Table
            columns={columns}
            dataSource={sorted}
            rowKey="id"
            size="small"
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
        </Card>
      )}
    </div>
  );
};

export default CompanionsPage;
