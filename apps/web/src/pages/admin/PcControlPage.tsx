import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Tag,
  Typography,
  Button,
  Space,
  Popconfirm,
  message,
  Tooltip,
  Input,
  Select,
} from 'antd';
import {
  ReloadOutlined,
  DesktopOutlined,
  PoweroffOutlined,
  RedoOutlined,
  ThunderboltOutlined,
  StopOutlined,
  LogoutOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { CompanionStatus } from '@chunlv/shared';
import { companionsApi } from '../../api/companions';
import { useSocket } from '../../hooks/useSocket';
import { companionStatusConfig, modeLabels } from '../../constants';

const { Text } = Typography;

interface CompanionPC {
  currentMode: string;
  isThrottled: boolean;
  lastHeartbeat: string | null;
  agentVersion?: string;
  throttleLimitKB?: number | null;
}

interface Companion {
  id: string;
  status: CompanionStatus;
  user?: { username: string };
  pc?: CompanionPC | null;
}

const commandLabels: Record<string, { label: string; color: string }> = {
  shutdown: { label: '关机', color: 'red' },
  restart: { label: '重启', color: 'orange' },
  throttle: { label: '限速', color: 'blue' },
  unthrottle: { label: '解除限速', color: 'green' },
  kick: { label: '踢出', color: 'red' },
};

function formatHeartbeat(heartbeat: string | null | undefined): string {
  if (!heartbeat) return '无记录';
  const dt = new Date(heartbeat);
  return dt.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function isOnline(record: Companion): boolean {
  // Companion status is the primary indicator (set via WS companion:status or REST)
  if (record.status === 'AVAILABLE' || record.status === 'ENTERTAINMENT' || record.status === 'BUSY') return true;
  // Fallback: heartbeat-based check from PC agent
  if (!record.pc?.lastHeartbeat) return false;
  return Date.now() - new Date(record.pc.lastHeartbeat).getTime() < 120_000;
}

const PcControlPage: React.FC = () => {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingCommands, setSendingCommands] = useState<Record<string, boolean>>({});
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();

  const fetchCompanions = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await companionsApi.list();
      setCompanions(data.data ?? []);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || '加载陪玩列表失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompanions();
    // Auto-refresh every 30s as fallback
    const t = setInterval(fetchCompanions, 30000);
    return () => clearInterval(t);
  }, [fetchCompanions]);

  // Real-time status updates via WebSocket
  useSocket({
    onStatusBroadcast: () => {
      fetchCompanions();
    },
  });

  const handleCommand = useCallback(
    async (companionId: string, command: string) => {
      setSendingCommands((prev) => ({ ...prev, [companionId]: true }));
      try {
        if (command === 'kick') {
          await companionsApi.kick(companionId);
          message.success('已踢出陪玩');
        } else {
          const params = command === 'throttle' ? { limitKB: 500 } : undefined;
          await companionsApi.sendCommand(companionId, command, params);
          message.success(`指令「${commandLabels[command]?.label ?? command}」已发送`);
        }
      } catch (err: any) {
        const msg =
          err?.response?.data?.message || err?.message || '指令发送失败';
        message.error(msg);
      } finally {
        setSendingCommands((prev) => ({ ...prev, [companionId]: false }));
        fetchCompanions();
      }
    },
    [fetchCompanions],
  );

  const filtered = companions.filter((c) => {
    const matchName = !searchText || (c.user?.username || '').toLowerCase().includes(searchText.toLowerCase());
    const matchStatus = !statusFilter || c.status === statusFilter;
    return matchName && matchStatus;
  });

  const columns = [
    {
      title: '陪玩姓名',
      dataIndex: ['user', 'username'],
      key: 'username',
      width: 120,
      render: (name: string | undefined) =>
        name ?? <Text type="secondary">-</Text>,
    },
    {
      title: '整体状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: CompanionStatus) => {
        const cfg = companionStatusConfig[status];
        return <Tag color={cfg?.color}>{cfg?.label ?? status}</Tag>;
      },
    },
    {
      title: 'PC 状态',
      key: 'pcOnline',
      width: 100,
      render: (_: unknown, record: Companion) => {
        const online = isOnline(record);
        return (
          <Tag color={online ? 'green' : 'default'}>
            {React.createElement(DesktopOutlined)}
            {' '}{online ? '在线' : '离线'}
          </Tag>
        );
      },
    },
    {
      title: '心跳时间',
      key: 'heartbeat',
      width: 170,
      render: (_: unknown, record: Companion) => {
        const hb = record.pc?.lastHeartbeat;
        return (
          <Tooltip title={hb ? new Date(hb).toLocaleString('zh-CN') : undefined}>
            <Text>{formatHeartbeat(hb)}</Text>
          </Tooltip>
        );
      },
    },
    {
      title: '当前模式',
      key: 'currentMode',
      width: 110,
      render: (_: unknown, record: Companion) => (
        <Tag color="blue">
          {modeLabels[record.pc?.currentMode ?? ''] ?? record.pc?.currentMode ?? '-'}
        </Tag>
      ),
    },
    {
      title: '限速状态',
      key: 'throttle',
      width: 140,
      render: (_: unknown, record: Companion) => {
        if (record.pc?.isThrottled) {
          return (
            <Tag color="orange">
              已限速
              {record.pc.throttleLimitKB != null
                ? ` ${record.pc.throttleLimitKB}KB/s`
                : ''}
            </Tag>
          );
        }
        return <Tag>未限速</Tag>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 320,
      render: (_: unknown, record: Companion) => {
        const pcOnline = isOnline(record);
        const busy = sendingCommands[record.id];
        return (
          <Space size="small" wrap>
            <Popconfirm
              title="确定对该 PC 执行关机？"
              onConfirm={() => handleCommand(record.id, 'shutdown')}
              okText="确定"
              cancelText="取消"
              disabled={!pcOnline}
            >
              <Tooltip title={pcOnline ? '发送关机指令' : 'PC 离线，无法操作'}>
                <Button
                  size="small"
                  danger
                  icon={React.createElement(PoweroffOutlined)}
                  disabled={!pcOnline || busy}
                  loading={busy}
                >
                  关机
                </Button>
              </Tooltip>
            </Popconfirm>

            <Popconfirm
              title="确定对该 PC 执行重启？"
              onConfirm={() => handleCommand(record.id, 'restart')}
              okText="确定"
              cancelText="取消"
              disabled={!pcOnline}
            >
              <Tooltip title={pcOnline ? '发送重启指令' : 'PC 离线，无法操作'}>
                <Button
                  size="small"
                  icon={React.createElement(RedoOutlined)}
                  disabled={!pcOnline || busy}
                >
                  重启
                </Button>
              </Tooltip>
            </Popconfirm>

            <Popconfirm
              title="确定对该 PC 执行限速？"
              onConfirm={() => handleCommand(record.id, 'throttle')}
              okText="确定"
              cancelText="取消"
              disabled={!pcOnline}
            >
              <Tooltip title={pcOnline ? '限速 500KB/s' : 'PC 离线，无法操作'}>
                <Button
                  size="small"
                  icon={React.createElement(ThunderboltOutlined)}
                  disabled={!pcOnline || busy}
                >
                  限速
                </Button>
              </Tooltip>
            </Popconfirm>

            <Popconfirm
              title="确定解除该 PC 限速？"
              onConfirm={() => handleCommand(record.id, 'unthrottle')}
              okText="确定"
              cancelText="取消"
              disabled={!pcOnline}
            >
              <Tooltip title={pcOnline ? '解除限速' : 'PC 离线，无法操作'}>
                <Button
                  size="small"
                  icon={React.createElement(StopOutlined)}
                  disabled={!pcOnline || busy}
                >
                  解除限速
                </Button>
              </Tooltip>
            </Popconfirm>

            <Popconfirm
              title="确定要踢出该陪玩？Agent 将被强制下线"
              onConfirm={() => handleCommand(record.id, 'kick')}
              okText="确定踢出"
              cancelText="取消"
              disabled={!pcOnline}
            >
              <Tooltip title={pcOnline ? '强制踢出陪玩' : 'PC 离线'}>
                <Button
                  size="small"
                  danger
                  icon={React.createElement(LogoutOutlined)}
                  disabled={!pcOnline || busy}
                  loading={busy}
                >
                  踢出
                </Button>
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

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
        <Text strong style={{ fontSize: 16 }}>
          PC 远程控制
        </Text>
        <Space>
          <Input.Search
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
          <Button
            icon={React.createElement(ReloadOutlined)}
            onClick={fetchCompanions}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={filtered}
        rowKey="id"
        loading={loading}
        locale={{ emptyText: '暂无陪玩数据' }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 位陪玩`,
        }}
      />
    </div>
  );
};

export default PcControlPage;
