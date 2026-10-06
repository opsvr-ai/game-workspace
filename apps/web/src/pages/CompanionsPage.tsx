// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { extractErrorMessage } from '../utils/error-handler';
import { Table, Tag, Typography, Button, Space, Popconfirm, Tooltip, Card, Input, Select, Image, Modal } from 'antd';
import { message } from '../utils/feedback';
import { ReloadOutlined, DesktopOutlined, SearchOutlined } from '@ant-design/icons';
import { CompanionStatus } from '@chunlv/shared';
import { companionsApi } from '../api/companions';
import { employeesApi } from '../api/employees';
import { useAuthStore } from '../stores/authStore';
import { companionStatusConfig, STATUS_SORT, modeLabels, HEARTBEAT_THRESHOLD } from '../constants';
import ErrorBanner from '../components/ErrorBanner';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import TableSkeleton from '../components/TableSkeleton';
import WorkRecordsDrawer from '../components/WorkRecordsDrawer';
import { visibleInterval } from '../hooks/usePolling';
import {
  ACTIONS_CELL_CLASS,
  CELL_ONE_LINE,
  CELL_SUB_TEXT,
  TABLE_STYLE,
} from '../constants/datasetColumns';
import { BRAND, TEXT, SEMANTIC, BORDER, BG } from '../styles/tokens';

const { Text } = Typography;

interface CompanionPC {
  currentMode: string;
  isThrottled: boolean;
  lastHeartbeat: string | null;
}

interface Personnel {
  id: string;
  username: string;
  role: 'COMPANION' | 'CS' | 'ADMIN' | 'OWNER';
  displayName?: string;
  avatar?: string;
  isAuthorized?: boolean;
  studioId?: string | null;
  studioName?: string | null;
  studioType?: string | null;
  companionId?: string | null;
  status?: CompanionStatus | null;
  games?: any[];
  monthlyRevenue?: number | null;
  phone?: string | null;
  realName?: string | null;
  idNumber?: string | null;
  idCardFront?: string | null;
  idCardBack?: string | null;
  isResigned?: boolean;
  isSeniorStaff?: boolean;
  lastHeartbeat?: string | null;
  /** 服务端按服务器时间算好的在线标记：本机时间不准也不会误判 */
  isOnline?: boolean | null;
  currentMode?: string | null;
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

function formatHeartbeat(
  heartbeat: string | null | undefined,
  serverOnline?: boolean | null,
): {
  online: boolean;
  text: string;
} {
  // 有服务端下发的 isOnline 就以它为准：本机系统时间偏几分钟时，
  // 原来按本机时间算会把在线的人全显示成「异常离线」。
  const trustServer = typeof serverOnline === 'boolean';
  if (!heartbeat) {
    const online = trustServer ? !!serverOnline : false;
    return { online, text: online ? '在线' : '离线' };
  }
  const dt = new Date(heartbeat);
  const now = Date.now();
  const diff = now - dt.getTime();
  const online = trustServer ? !!serverOnline : diff < HEARTBEAT_THRESHOLD;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const roleFilter = searchParams.get('role');
  const role = user?.role;
  const isAdmin = role === 'ADMIN' || role === 'OWNER';

  const [companions, setCompanions] = useState<Personnel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchText, setSearchText] = useState('');
  const [wrCompanion, setWrCompanion] = useState<Personnel | null>(null);
  const [wrFocusSession, setWrFocusSession] = useState<string | null>(null);
  const [detailEmployee, setDetailEmployee] = useState<Personnel | null>(null);
  const [idCardMap, setIdCardMap] = useState<Record<string, Personnel>>({});
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [gameFilter, setGameFilter] = useState<string | undefined>();

  // 从「工作抽查异常」通知点「查看」跳过来：?workCompanion=<陪玩id>&workSession=<工作记录id>
  // —— 自动打开这个人的工作记录抽屉，并把异常那一条高亮（老板 2026-10-05）。
  const workCompanionParam = searchParams.get('workCompanion');
  const workSessionParam = searchParams.get('workSession');
  const workNameParam = searchParams.get('workName');

  const GAME_OPTIONS = ['王者荣耀', '英雄联盟', '和平精英', '无畏契约', '永劫无间', 'CS2', 'DOTA2', 'APEX', '其他'];

  const STATUS_TABS: { label: string; value: string | undefined }[] = [
    { label: '全部', value: undefined },
    { label: '在线', value: 'AVAILABLE' },
    { label: '忙碌', value: 'BUSY' },
    { label: '娱乐', value: 'ENTERTAINMENT' },
    { label: '休息', value: 'RESTING' },
    { label: '离线', value: 'OFFLINE' },
    { label: '已离职', value: 'RESIGNED' },
  ];

  // Expanded row time logs cache
  const [timeLogsCache, setTimeLogsCache] = useState<
    Record<string, { loading: boolean; logs: TimeLog[]; error?: string }>
  >({});

  const fetchCompanions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 带上已离职的人：主列表默认还是只显示在职的，「已离职」页签单独看
      const { data } = await companionsApi.listPersonnel({ includeResigned: true });
      setCompanions(data.data ?? []);
    } catch (err: any) {
      setError(extractErrorMessage(err, '加载陪玩列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!workCompanionParam && !workNameParam) return;
    // 只有名字（老通知）时，等人员列表加载完再按名字找；找不到就不弹。
    if (!workCompanionParam && loading && companions.length === 0) return;
    const hit = companions.find(
      (c) =>
        (!!workCompanionParam && (c.companionId === workCompanionParam || c.id === workCompanionParam)) ||
        (!!workNameParam && (c.displayName === workNameParam || c.username === workNameParam)),
    );
    if (!hit && !workCompanionParam) return;
    setWrCompanion(
      hit ||
        ({
          id: workCompanionParam,
          companionId: workCompanionParam,
          username: workNameParam || '',
          role: 'COMPANION',
        } as Personnel),
    );
    setWrFocusSession(workSessionParam);
    const next = new URLSearchParams(searchParams);
    next.delete('workCompanion');
    next.delete('workSession');
    next.delete('workName');
    setSearchParams(next, { replace: true });
  }, [workCompanionParam, workSessionParam, workNameParam, companions, loading, searchParams, setSearchParams]);

  const loadEmployeeIdCards = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const { data } = await employeesApi.list({ role: 'COMPANION' });
      const list = (data.data ?? []) as Array<{
        id: string;
        idNumber?: string | null;
        idCardFront?: string | null;
        idCardBack?: string | null;
        companion?: { idNumber?: string | null; idCardFront?: string | null; idCardBack?: string | null } | null;
      }>;
      const map: Record<string, Personnel> = {};
      for (const item of list) {
        map[item.id] = {
          id: item.id,
          username: '',
          role: 'COMPANION',
          idNumber: item.idNumber ?? item.companion?.idNumber ?? null,
          idCardFront: item.idCardFront ?? item.companion?.idCardFront ?? null,
          idCardBack: item.idCardBack ?? item.companion?.idCardBack ?? null,
        };
      }
      setIdCardMap(map);
    } catch {
      // 详情数据加载失败不影响陪玩列表主流程
    }
  }, [isAdmin]);

  const openDetail = async (record: Personnel) => {
    setDetailEmployee({ ...record, ...(idCardMap[record.id] || {}) });
    if (!isAdmin) return;
    try {
      const { data } = await employeesApi.list({ role: 'COMPANION' });
      const item = ((data.data ?? []) as any[]).find((e: any) => e.id === record.id);
      setDetailEmployee((prev) => prev && prev.id === record.id
        ? {
            ...prev,
            idNumber: item?.idNumber ?? item?.companion?.idNumber ?? null,
            idCardFront: item?.idCardFront ?? item?.companion?.idCardFront ?? null,
            idCardBack: item?.idCardBack ?? item?.companion?.idCardBack ?? null,
          }
        : prev);
    } catch {
      // 单次详情获取失败时，保留已经显示的基础信息
    }
  };

  useEffect(() => {
    fetchCompanions();
  }, [fetchCompanions]);

  useEffect(() => {
    loadEmployeeIdCards();
  }, [loadEmployeeIdCards]);

  // 60s auto-refresh
  useEffect(() => {
    const t = visibleInterval(fetchCompanions, 60000);
    return () => clearInterval(t);
  }, [fetchCompanions]);

  const sorted = useMemo(() => {
    let list = [...companions];

    // Name search
    if (searchText) {
      const lower = searchText.toLowerCase();
      list = list.filter((c) => (c.username || '').toLowerCase().includes(lower));
    }

    // 离职的人单独一档：其他页签（包括「全部」）都不显示，避免出现「离职了还在名单里」
    if (statusFilter === 'RESIGNED') {
      list = list.filter((c) => c.isResigned);
    } else {
      list = list.filter((c) => !c.isResigned);
      if (statusFilter) {
        list = list.filter((c) => c.status === statusFilter);
      }
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

    if (roleFilter) {
      list = list.filter((c) => c.role === roleFilter);
    }

    return list.sort((a, b) => (STATUS_SORT[a.status ?? 'OFFLINE'] ?? 9) - (STATUS_SORT[b.status ?? 'OFFLINE'] ?? 9));
  }, [companions, searchText, statusFilter, gameFilter, roleFilter]);

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
      message.success('已办理离职：账号停用、工位和工作微信已交回');
      fetchCompanions();
    } catch (err: any) {
      message.error(extractErrorMessage(err, '操作失败'));
    }
  };

  const handleRestore = async (record: Personnel) => {
    try {
      await employeesApi.restore(record.id);
      message.success(`${record.username} 已恢复在职，可以重新登录了`);
      fetchCompanions();
    } catch (err: any) {
      message.error(extractErrorMessage(err, '恢复失败'));
    }
  };


  const columns = useMemo(() => {
    const cols: any[] = [
      {
        title: '角色',
        dataIndex: 'role',
        key: 'role',
        fixed: 'left' as const,
        width: 66,
        render: (role: string) => {
          const cfg: Record<string, { label: string; color: string }> = {
            COMPANION: { label: '陪玩', color: 'blue' },
            CS: { label: '客服', color: 'green' },
            ADMIN: { label: '店长', color: 'orange' },
            OWNER: { label: '老板', color: 'purple' },
          };
          return <Tag color={cfg[role]?.color}>{cfg[role]?.label || role}</Tag>;
        },
      },
      {
        title: '姓名',
        key: 'name',
        width: 132,
        // 一格一行（老板 2026-09-28）：头像 + 名字 + 灰色真名跟在后面。
        // 以前是名字下面再叠一行真名，一个格子两行，整张表的行高忽高忽低（「马凝 初」还会被挤成竖排）。
        render: (_: unknown, r: Personnel) => {
          const username = r.username || r.id;
          const avatarUrl = r.avatar ? `/uploads/avatars/${r.avatar}?v=${r.avatar}` : null;
          const showReal = !!r.realName && r.realName !== username;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, cursor: 'pointer' }} onClick={() => openDetail(r)}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: avatarUrl ? `url(${avatarUrl}) center/cover` : BRAND.primary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {!avatarUrl && (
                  <span style={{ color: TEXT.inverse, fontSize: 13, fontWeight: 700 }}>
                    {(username || '?')[0].toUpperCase()}
                  </span>
                )}
              </div>
              <div style={{ ...CELL_ONE_LINE, minWidth: 0 }} title={showReal ? `${username} · ${r.realName}` : username}>
                <Text strong>{username}</Text>
                {showReal && <span style={CELL_SUB_TEXT}>· {r.realName}</span>}
              </div>
            </div>
          );
        },
      },
      {
        title: '工作室/俱乐部',
        dataIndex: 'studioName',
        key: 'studioName',
        width: 104,
        render: (_: unknown, r: Personnel) => {
          if (!r.studioName) return <Text type="secondary">-</Text>;
          const isRental = r.studioType === 'RENTAL';
          return (
            <Tag color={isRental ? 'purple' : 'blue'} style={{ margin: 0 }}>
              {r.studioName}
            </Tag>
          );
        },
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 66,
        render: (status: CompanionStatus | null) => {
          if (!status) return <Text type="secondary">-</Text>;
          const cfg = companionStatusConfig[status];
          return <Tag color={cfg?.color}>{cfg?.label ?? status}</Tag>;
        },
      },
      {
        title: '游戏',
        dataIndex: 'games',
        key: 'games',
        // 118 而不是 152：整表 1178px + 50px 展开列 = 1228，1536 的屏只有 1207px，
        // 会在右边多出一条 27px 的横向滚动条（老板 2026-09-28 定的规矩：1536 起不横向滚）。
        // 收到 118 后整表 1194px，1536 起一屏放得下，一格里的「三角洲 王者 有号 +1」仍然放得下。
        width: 118,
        // 一格一行（老板 2026-09-28）：以前每个游戏一个彩色块、放不下就换行，
        // 一列游戏多的陪玩行高能到三行。现在只写第一个游戏（保留段位颜色），
        // 后面跟「+N」，完整的在悬停里看。
        render: (games: any[] | undefined) => {
          if (!games || games.length === 0) return <Text type="secondary">-</Text>;
          const isProfile = typeof games[0] === 'object';
          const full = games
            .map((g: any) => (isProfile ? `${g.game} ${g.rank || '?'} ${g.hasAccount ? '有号' : '无号'}` : String(g)))
            .join(' · ');
          if (!isProfile) {
            return (
              <div style={CELL_ONE_LINE} title={full}>
                {games.join(' ')}
              </div>
            );
          }
          const first = games[0];
          return (
            <div style={CELL_ONE_LINE} title={full}>
              <Text strong>{first.game}</Text>
              <span style={{ ...CELL_SUB_TEXT, color: SEMANTIC.direct, fontWeight: 600 }}>{first.rank || '?'}</span>
              <span style={{ ...CELL_SUB_TEXT, color: first.hasAccount ? '#34C759' : TEXT.tertiary }}>
                {first.hasAccount ? '有号' : '无号'}
              </span>
              {games.length > 1 && <span style={CELL_SUB_TEXT}>+{games.length - 1}</span>}
            </div>
          );
        },
      },
      {
        title: '今日接单',
        key: 'todayOrders',
        width: 76,
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
          <span style={{ color: '#FF4757', fontWeight: 600 }}>¥{val?.toFixed(1) || '0.00'}</span>
        ),
      },
      {
        title: '手机',
        dataIndex: 'phone',
        key: 'phone',
        width: 96,
        render: (v: string | undefined) => v || '-',
      },
      {
        title: 'PC状态',
        key: 'pcStatus',
        width: 158,
        render: (_: unknown, record: Personnel) => {
          const hb = formatHeartbeat(record.lastHeartbeat, record.isOnline);
          const isAbnormal = !hb.online && record.status !== 'OFFLINE' && record.lastHeartbeat !== null;
          return (
            <Space size={4}>
              <Tag color={isAbnormal ? 'red' : hb.online ? 'green' : 'default'}>
                {React.createElement(DesktopOutlined)} {isAbnormal ? '异常离线' : hb.online ? '在线' : '离线'}
              </Tag>
              {record.lastHeartbeat && (
                <Tooltip title={`心跳: ${new Date(record.lastHeartbeat).toLocaleString('zh-CN')}`}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {new Date(record.lastHeartbeat).toLocaleString('zh-CN', {
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
        // 248 = 「标记老员工 工作记录 身份证 离职处理」排一行要的宽度（老板 2026-09-28：写 240 时最后一个字被切）
        width: 248,
        fixed: 'right' as const,
        className: ACTIONS_CELL_CLASS,
        render: (_: unknown, record: Personnel) => (
          <Space size={0}>
            {record.role === 'COMPANION' && (
              <>
                <Button
                  type="link"
                  size="small"
                  onClick={async () => {
                    try {
                      await companionsApi.setSeniorStaff(record.companionId!, !record.isSeniorStaff);
                      message.success(record.isSeniorStaff ? '已取消老员工标记' : '已标记为老员工');
                      fetchCompanions();
                    } catch (e: any) {
                      message.error(e?.response?.data?.message || '操作失败');
                    }
                  }}
                >
                  {record.isSeniorStaff ? '取消老员工' : '标记老员工'}
                </Button>
                <Button type="link" size="small" onClick={() => { setWrCompanion(record); }}>
                  工作记录
                </Button>
                <Button type="link" size="small" onClick={() => openDetail(record)}>
                  身份证
                </Button>
                {record.isResigned ? (
                  <>
                    <Tag color="default" style={{ margin: 0 }}>已离职</Tag>
                    <Popconfirm
                      title="恢复在职？"
                      description="恢复后可以重新登录；已清零的余额、已释放的工位和工作微信不会自动还原"
                      onConfirm={() => handleRestore(record)}
                      okText="恢复"
                      cancelText="取消"
                    >
                      <Button type="link" size="small">恢复在职</Button>
                    </Popconfirm>
                  </>
                ) : (
                  <Popconfirm
                    title="确认离职处理？"
                    description="账号停用、无法登录；流水/余额清零，工位和工作微信交回。历史记录保留"
                    onConfirm={() => handleResign(record.companionId || '')}
                    okText="确认"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button type="link" danger size="small">
                      离职处理
                    </Button>
                  </Popconfirm>
                )}
              </>
            )}
            {record.role !== 'COMPANION' && (
              <Text type="secondary" style={{ fontSize: 12 }}>-</Text>
            )}
          </Space>
        ),
      });
    }

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // 横向滚动宽度 = 当前真正渲染出来的列宽之和（+50 是左边那根「展开」小三角列）。
  // 老板 2026-09-28：写死 1170 的话，客服端（没有「操作」列）会被硬撑到 1170，
  // 白白多出一条横向滚动条、右边那列还被切一半；按实际列算就不会。
  const tableScrollX = useMemo(
    () => columns.reduce((sum, c: any) => sum + (typeof c?.width === 'number' ? c.width : 0), 0) + 50,
    [columns],
  );

  // Inner component for expandable time log rows
  const ExpandableRow: React.FC<{ record: Personnel }> = ({ record }) => {
    // hooks 必须放在任何提前 return 之前：原来这段 useEffect 写在
    // if (!record.companionId) return ... 后面，属于「条件调用 hooks」，
    // 一旦某行在同伴/非同伴之间切换就会打乱 hooks 调用顺序。
    // 挪到前面 + 在回调里自己判断，行为不变（非陪玩人员依然不发请求）。
    useEffect(() => {
      if (record.companionId) loadTimeLogs(record.companionId);
    }, [record.companionId, loadTimeLogs]);

    if (!record.companionId) {
      return (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Text type="secondary">非陪玩人员，无时间日志</Text>
        </div>
      );
    }
    const cache = timeLogsCache[record.companionId];

    if (!cache) {
      return <LoadingState minHeight={120} />;
    }

    if (cache.loading) {
      return <LoadingState minHeight={120} />;
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
        title={isAdmin ? '人员管理' : role === 'CS' ? '人员管理' : '人员状态'}
        subtitle={`共 ${companions.length} 位人员 · 60s 刷新`}
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
                placeholder="搜索人员姓名"
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
                      ? `1px solid ${BRAND.primary}`
                      : `1px solid ${BORDER.base}`,
                    background: statusFilter === tab.value ? SEMANTIC.infoSoftBlue : BG.container,
                    color: statusFilter === tab.value ? BRAND.primary : TEXT.secondary,
                  }}
                  onClick={() => setStatusFilter(tab.value)}
                >
                  {tab.label}
                </Tag>
              ))}
            </div>
          </div>

          {/* 老板 2026-09-28：这张表和员工表一样，以前没有定宽也不能横向滚，
              客服窗口（1320）里 10 列被硬挤，时间和「马凝初」这种三字名会被压成竖排。 */}
          <Table
            className="data-table"
            columns={columns}
            dataSource={sorted}
            rowKey="id"
            size="small"
            style={TABLE_STYLE}
            scroll={{ x: tableScrollX }}
            locale={{ emptyText: '暂无人员数据' }}
            pagination={{
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (t) => `共 ${t} 位人员`,
            }}
            expandable={{
              expandedRowRender: (record) => <ExpandableRow record={record} />,
              rowExpandable: () => true,
            }}
          />
        </Card>
      )}

      <Modal
        title="员工详情"
        open={!!detailEmployee}
        onCancel={() => setDetailEmployee(null)}
        footer={<Button onClick={() => setDetailEmployee(null)}>关闭</Button>}
        width={520}
      >
        {detailEmployee && (
          <div style={{ lineHeight: 2.2 }}>
            <p><Text strong>用户名：</Text>{detailEmployee.username}</p>
            <p><Text strong>姓名：</Text>{detailEmployee.realName || '-'}</p>
            <p><Text strong>手机号：</Text>{detailEmployee.phone || '-'}</p>
            <p><Text strong>身份证号：</Text>{detailEmployee.idNumber || '-'}</p>
            {detailEmployee.idCardFront && (
              <p>
                <Text strong>身份证正面：</Text>
                <Image src={`/uploads/idcards/${detailEmployee.idCardFront}`} width={200} style={{ borderRadius: 4 }} />
              </p>
            )}
            {detailEmployee.idCardBack && (
              <p>
                <Text strong>身份证反面：</Text>
                <Image src={`/uploads/idcards/${detailEmployee.idCardBack}`} width={200} style={{ borderRadius: 4 }} />
              </p>
            )}
          </div>
        )}
      </Modal>

      <WorkRecordsDrawer
        open={!!wrCompanion}
        companionId={wrCompanion?.companionId || null}
        companionName={wrCompanion?.username || undefined}
        focusSessionId={wrFocusSession}
        onClose={() => {
          setWrCompanion(null);
          setWrFocusSession(null);
        }}
      />
    </div>
  );
};

export default CompanionsPage;
