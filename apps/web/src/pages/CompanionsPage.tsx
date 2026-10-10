// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { extractErrorMessage } from '../utils/error-handler';
import { Table, Tag, Typography, Button, Space, Popconfirm, Tooltip, Card, Input, InputNumber, Select, Image, Modal, Form, DatePicker } from 'antd';
import dayjs from 'dayjs';
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

/** 钱包记录类型（跟服务端 WalletTransaction.type 对齐）。 */
const WALLET_TYPE_LABELS: Record<string, string> = {
  DEPOSIT: '押金',
  WITHDRAW: '支取',
  FREEZE: '冻结',
  UNFREEZE: '解冻',
  SETTLEMENT: '结算 / 业绩调整',
};

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
  // 编辑业绩（老板 2026-10-10）：店长 / 老板在「陪玩列表」直接改某个陪玩的业绩，
  // 不用再绕「员工管理 → 员工列表 → 编辑财务」那一圈（店长原来根本点不到那个入口）。
  const [financeCompanion, setFinanceCompanion] = useState<Personnel | null>(null);
  const [financeSaving, setFinanceSaving] = useState(false);
  const [financeForm] = Form.useForm();
  // 他一条条业绩记录（老板 2026-10-11）：他打的单 + 钱包记录，店长 / 老板能改能删。
  const [moneyRecords, setMoneyRecords] = useState<any>({
    orders: [],
    wallet: [],
    revenueFromOrders: 0,
    storedRevenue: 0,
  });
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordEdit, setRecordEdit] = useState<{ kind: 'order' | 'wallet'; row: any } | null>(null);
  const [recordSaving, setRecordSaving] = useState(false);
  const [recordForm] = Form.useForm();
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

  /**
   * 编辑业绩（老板 2026-10-10）。
   *
   * 老板原话：「陪玩的业绩我在哪里输入修改，只能店长才有权限」→ 确认「店长 + 老板都能改」。
   * 入口就放在「陪玩列表」每行（比单独开一页顺手）：店长 / 老板看得到这个按钮，
   * 客服 / 陪玩看不到 —— 后端 `PUT /companions/:id/finance` 同样只放行 店长 + 老板。
   *
   * 「业绩」= 列表里的「业绩」列 = 财务弹窗里的「总业绩」= `Companion.monthlyRevenue`。
   * 老板 2026-10-10 统一口径：全站只叫「业绩」，不再有「月收入 / 流水 / 总流水」几种叫法。
   */
  const openFinance = (record: Personnel) => {
    setFinanceCompanion(record);
    financeForm.setFieldsValue({ revenue: Number(record.monthlyRevenue ?? 0), note: '' });
    if (record.companionId) void loadMoneyRecords(record.companionId);
  };

  const saveFinance = async () => {
    const companionId = financeCompanion?.companionId;
    if (!companionId) return;
    const values = await financeForm.validateFields().catch(() => null);
    if (!values) return; // 校验没过：红字提示由 antd 出，不发请求
    setFinanceSaving(true);
    try {
      const payload: any = {
        totalRevenue: Number(values.revenue) || 0,
        note: values.note?.trim() || '店长手动调整业绩',
      };
      // 「今日业绩」留空就不发（保持原样）；填了才覆盖今天那个数。
      if (values.todayRevenue !== undefined && values.todayRevenue !== null) {
        payload.todayRevenue = Number(values.todayRevenue) || 0;
      }
      await companionsApi.updateFinance(companionId, payload);
      message.success(`${financeCompanion?.username || '该陪玩'} 的业绩已更新`);
      setFinanceCompanion(null);
      financeForm.resetFields();
      fetchCompanions();
    } catch (err: any) {
      message.error(extractErrorMessage(err, '更新业绩失败'));
    } finally {
      setFinanceSaving(false);
    }
  };

  useEffect(() => {
    fetchCompanions();
  }, [fetchCompanions]);

  /** 读他一条条业绩记录（他打的单 + 钱包记录）。 */
  const loadMoneyRecords = useCallback(async (companionId: string) => {
    setRecordsLoading(true);
    try {
      const { data: res } = await companionsApi.moneyRecords(companionId);
      setMoneyRecords({
        orders: [],
        wallet: [],
        revenueFromOrders: 0,
        storedRevenue: 0,
        ...(res?.data || {}),
      });
    } catch {
      setMoneyRecords({ orders: [], wallet: [], revenueFromOrders: 0, storedRevenue: 0 });
    } finally {
      setRecordsLoading(false);
    }
  }, []);

  /** 点某一条的「改」：金额 / 日期 / 备注。 */
  const openRecordEdit = (kind: 'order' | 'wallet', row: any) => {
    setRecordEdit({ kind, row });
    recordForm.setFieldsValue({
      amount: Number(kind === 'order' ? row.myRevenue : row.amount) || 0,
      createdAt: row.createdAt ? dayjs(row.createdAt) : null,
      note: kind === 'wallet' ? row.note || '' : '',
    });
  };

  const saveRecordEdit = async () => {
    const companionId = financeCompanion?.companionId;
    if (!recordEdit || !companionId) return;
    const values = await recordForm.validateFields().catch(() => null);
    if (!values) return;
    setRecordSaving(true);
    try {
      if (recordEdit.kind === 'order') {
        await companionsApi.updateMoneyOrderRecord(companionId, recordEdit.row.id, {
          amount: Number(values.amount) || 0,
          note: values.note?.trim() || '',
        });
        message.success('这一单的业绩已更正');
      } else {
        await companionsApi.updateMoneyWalletRecord(companionId, recordEdit.row.id, {
          amount: Number(values.amount) || 0,
          createdAt: values.createdAt ? values.createdAt.format('YYYY-MM-DD HH:mm:ss') : undefined,
          note: values.note?.trim() || '',
        });
        message.success('这条记录已更正');
      }
      setRecordEdit(null);
      recordForm.resetFields();
      void loadMoneyRecords(companionId);
      fetchCompanions();
    } catch (err: any) {
      message.error(extractErrorMessage(err, '更正失败'));
    } finally {
      setRecordSaving(false);
    }
  };

  /** 作废 / 恢复某一单（作废 = 这一单不计业绩，随时能恢复）。 */
  const setOrderRecordVoided = async (row: any, voided: boolean) => {
    const companionId = financeCompanion?.companionId;
    if (!companionId) return;
    try {
      await companionsApi.updateMoneyOrderRecord(companionId, row.id, { voided });
      message.success(voided ? '已作废：这一单不计业绩' : '已恢复这一单的业绩');
      void loadMoneyRecords(companionId);
      fetchCompanions();
    } catch (err: any) {
      message.error(extractErrorMessage(err, '操作失败'));
    }
  };

  /** 删掉一条钱包记录。 */
  const removeWalletRecord = async (row: any) => {
    const companionId = financeCompanion?.companionId;
    if (!companionId) return;
    try {
      await companionsApi.deleteMoneyWalletRecord(companionId, row.id);
      message.success('这条记录已删除');
      void loadMoneyRecords(companionId);
      fetchCompanions();
    } catch (err: any) {
      message.error(extractErrorMessage(err, '删除失败'));
    }
  };

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
        title: '业绩',
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
        // 304 = 「标记老员工 编辑业绩 工作记录 身份证 离职处理」排一行要的宽度。
        // 原来是 248（四个按钮，老板 2026-09-28 定：写 240 时最后一个字会被切）；
        // 老板 2026-10-10 加了「编辑业绩」这一个，按同样的按钮规格算下来要宽 56px。
        // 老板 2026-10-11 又加了「结束会话」（只在对方卡在「接单中」时出现），再 +56。
        width: 360,
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
                <Button type="link" size="small" onClick={() => openFinance(record)}>
                  编辑业绩
                </Button>
                {record.status === 'BUSY' && (
                  <Popconfirm
                    title="把 TA 放回空闲？"
                    description="TA 卡在「接单中」时点这里：把在跑的会话收尾、状态放回空闲（电脑不在线就是离线）。只改状态，不动钱 —— 金额和业绩还是走「订单管理」那条路。"
                    onConfirm={async () => {
                      try {
                        const res: any = await companionsApi.releaseSession(record.companionId!);
                        message.success(res?.data?.message || '已放回');
                        fetchCompanions();
                      } catch (e: any) {
                        message.error(e?.response?.data?.message || '操作失败');
                      }
                    }}
                    okText="确认"
                    cancelText="取消"
                  >
                    <Button type="link" size="small">
                      结束会话
                    </Button>
                  </Popconfirm>
                )}
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
                      description="恢复后可以重新登录；已清零的业绩、已释放的工位和工作微信不会自动还原"
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
                    description="账号停用、无法登录；业绩清零，工位和工作微信交回。历史记录保留"
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

      {/* 编辑业绩（老板 2026-10-10）：店长 / 老板在「陪玩列表」直接改这个陪玩的业绩；
          客服 / 陪玩看不到这个入口（后端 `PUT /companions/:id/finance` 也只放行店长 + 老板）。 */}
      <Modal
        title={`编辑业绩 — ${financeCompanion?.username ?? ''}`}
        open={!!financeCompanion}
        onOk={saveFinance}
        onCancel={() => {
          setFinanceCompanion(null);
          financeForm.resetFields();
          setMoneyRecords({ orders: [], wallet: [], revenueFromOrders: 0, storedRevenue: 0 });
        }}
        confirmLoading={financeSaving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
        width={760}
      >
        <Form form={financeForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="todayRevenue"
            label="今日业绩（要测娱乐就填这格，留空 = 不改）"
            extra="能不能点「娱乐」、接单名额解不解锁，看的就是「今天」的业绩 —— 填到本店免单线（默认 300），他今天就能免费玩娱乐。填多少今天就算多少（不是往上加）；只算今天这一天，明天自动失效。"
          >
            <InputNumber min={0} step={50} style={{ width: '100%' }} prefix="¥" placeholder="不改就不填" />
          </Form.Item>
          <Form.Item
            name="revenue"
            label="累计业绩（列表里那一列，不影响娱乐）"
            extra="就是列表里那一列「业绩」（财务弹窗里叫「总业绩」），改的是同一份数据；只记账，跟今天能不能玩娱乐无关。"
            rules={[{ required: true, message: '请填业绩金额' }]}
          >
            <InputNumber min={0} step={100} style={{ width: '100%' }} prefix="¥" />
          </Form.Item>
          <Form.Item name="note" label="调整备注">
            <Input placeholder="为什么改（比如：补录 10 月 3 日漏记的单）" />
          </Form.Item>
        </Form>

        {/* 他一条条记录（老板 2026-10-11）：记错的那一条直接点「改」；不该算的点「作废」（随时能恢复）。 */}
        <Space size={8} style={{ marginBottom: 6 }}>
          <Text strong>他一条条记录</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            单子加起来 ¥{Number(moneyRecords.revenueFromOrders || 0).toFixed(1)} · 库里存的业绩 ¥
            {Number(moneyRecords.storedRevenue || 0).toFixed(1)}
          </Text>
          {Number(moneyRecords.revenueFromOrders || 0) === Number(moneyRecords.storedRevenue || 0) ? (
            <Tag color="green" style={{ margin: 0 }}>一致</Tag>
          ) : (
            <Tag color="orange" style={{ margin: 0 }}>对不上（改一条记录就会自动对上）</Tag>
          )}
        </Space>
        <Table
          rowKey="id"
          size="small"
          loading={recordsLoading}
          dataSource={moneyRecords.orders}
          scroll={{ x: 688 }}
          pagination={{ pageSize: 5, size: 'small', hideOnSinglePage: true }}
          locale={{ emptyText: '他还没有计入业绩的单' }}
          columns={[
            {
              title: '时间',
              dataIndex: 'createdAt',
              width: 130,
              render: (v: string) => (v ? dayjs(v).format('MM-DD HH:mm') : '-'),
            },
            {
              title: '客户',
              dataIndex: 'customerCode',
              width: 100,
              render: (v: string, r: any) => v || r.customerWechat || '-',
            },
            { title: '游戏', dataIndex: 'gameName', width: 90 },
            {
              title: '身份',
              dataIndex: 'role',
              width: 64,
              render: (v: string) => (v === 'MAIN' ? '主陪' : '搭档'),
            },
            {
              title: '这一单业绩',
              dataIndex: 'myRevenue',
              width: 96,
              align: 'right' as const,
              render: (v: number, r: any) =>
                r.voided ? (
                  <Text delete type="secondary">¥{Number(r.prevRevenue || 0).toFixed(1)}</Text>
                ) : (
                  <span>¥{Number(v || 0).toFixed(1)}</span>
                ),
            },
            {
              title: '状态',
              width: 88,
              render: (_: unknown, r: any) =>
                r.voided ? (
                  <Tag color="default">已作废</Tag>
                ) : r.refunded ? (
                  <Tag color="red">已退款</Tag>
                ) : (
                  <Tag color="green">已计入</Tag>
                ),
            },
            {
              title: '操作',
              width: 120,
              fixed: 'right' as const,
              render: (_: unknown, r: any) => (
                <Space size={0}>
                  <Button type="link" size="small" onClick={() => openRecordEdit('order', r)}>
                    改
                  </Button>
                  {r.voided ? (
                    <Button type="link" size="small" onClick={() => setOrderRecordVoided(r, false)}>
                      恢复
                    </Button>
                  ) : (
                    <Popconfirm
                      title="这一单不计业绩？"
                      description="作废后这一单不算他的业绩（列表里的累计业绩会跟着减掉），随时能点「恢复」。"
                      onConfirm={() => setOrderRecordVoided(r, true)}
                      okText="作废"
                      cancelText="取消"
                    >
                      <Button type="link" size="small" danger>作废</Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />

        {moneyRecords.wallet.length > 0 && (
          <>
            <Text strong style={{ display: 'block', marginTop: 12 }}>
              钱包记录（押金 / 支取 / 冻结 / 手动调整）
            </Text>
            <Table
              rowKey="id"
              size="small"
              loading={recordsLoading}
              dataSource={moneyRecords.wallet}
              scroll={{ x: 620 }}
              pagination={{ pageSize: 5, size: 'small', hideOnSinglePage: true }}
              locale={{ emptyText: '暂无钱包记录' }}
              columns={[
                {
                  title: '时间',
                  dataIndex: 'createdAt',
                  width: 130,
                  render: (v: string) => (v ? dayjs(v).format('MM-DD HH:mm') : '-'),
                },
                {
                  title: '类型',
                  dataIndex: 'type',
                  width: 110,
                  render: (v: string) => WALLET_TYPE_LABELS[v] || v,
                },
                {
                  title: '金额',
                  dataIndex: 'amount',
                  width: 96,
                  align: 'right' as const,
                  render: (v: number) => `¥${Number(v || 0).toFixed(1)}`,
                },
                {
                  title: '备注',
                  dataIndex: 'note',
                  ellipsis: true,
                  render: (v: string, r: any) => (
                    <Tooltip title={v || ''}>
                      <span>{v || '-'}</span>
                      {r.operatorName ? <Text type="secondary" style={{ marginLeft: 6, fontSize: 11 }}>（{r.operatorName}）</Text> : null}
                    </Tooltip>
                  ),
                },
                {
                  title: '操作',
                  width: 100,
                  fixed: 'right' as const,
                  render: (_: unknown, r: any) => (
                    <Space size={0}>
                      <Button type="link" size="small" onClick={() => openRecordEdit('wallet', r)}>
                        改
                      </Button>
                      <Popconfirm
                        title="删掉这条记录？"
                        description="删了就没了（支取类的删掉后「可支取」会跟着重算）。"
                        onConfirm={() => removeWalletRecord(r)}
                        okText="删除"
                        cancelText="取消"
                      >
                        <Button type="link" size="small" danger>删</Button>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]}
            />
          </>
        )}
      </Modal>

      {/* 改某一条记录（金额 / 日期 / 备注）——不嵌套在上面的弹窗里，免得点一下关两层。 */}
      <Modal
        title={recordEdit?.kind === 'order' ? '改这一单的业绩' : '改这条钱包记录'}
        open={!!recordEdit}
        onOk={saveRecordEdit}
        onCancel={() => {
          setRecordEdit(null);
          recordForm.resetFields();
        }}
        confirmLoading={recordSaving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
        width={420}
      >
        <Form form={recordForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="amount"
            label={recordEdit?.kind === 'order' ? '这一单算他多少业绩' : '金额'}
            rules={[{ required: true, message: '请填金额' }]}
          >
            <InputNumber min={0} step={10} style={{ width: '100%' }} prefix="¥" />
          </Form.Item>
          {recordEdit?.kind === 'wallet' && recordEdit?.row?.type === 'WITHDRAW' && (
            <Form.Item name="createdAt" label="日期（支取记录按月份算可支取，改日期会换月）">
              <DatePicker showTime style={{ width: '100%' }} format="YYYY-MM-DD HH:mm" />
            </Form.Item>
          )}
          <Form.Item name="note" label="备注" extra="改完会在备注里留一句「原来多少 → 改成多少、谁改的」">
            <Input placeholder="为什么改（比如：这单记错了）" />
          </Form.Item>
        </Form>
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
