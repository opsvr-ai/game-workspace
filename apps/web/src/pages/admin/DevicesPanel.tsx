// craftsman-ignore: TS001,TS002,TS003
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, Collapse, Descriptions, Divider, Drawer, Dropdown, Form, Input, Modal,
  Popconfirm, Row, Segmented, Select, Space, Spin, Table, Tag, Tooltip, Typography,
} from 'antd';
import { message } from '../../utils/feedback';
import {
  CheckCircleOutlined, CloudDownloadOutlined, CloudUploadOutlined, CopyOutlined, DesktopOutlined,
  DownloadOutlined, ExclamationCircleOutlined, LaptopOutlined, LogoutOutlined, PoweroffOutlined,
  RedoOutlined, ReloadOutlined, SafetyCertificateOutlined, SearchOutlined, SendOutlined,
  StopOutlined, SyncOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import {
  MachineItem, MachineTask, machineApi, taskStatusLabels, taskTypeLabels,
} from '../../api/machines';
import { agentApi } from '../../api/agent';
import { companionsApi } from '../../api/companions';
import { managedPcApi, ManagedPcItem } from '../../api/managedPc';
import { companionStatusConfig, modeLabels } from '../../constants';
import { visibleInterval } from '../../hooks/usePolling';
import { useSocket } from '../../hooks/useSocket';
import StatCard from '../../components/StatCard';
import PageHeader from '../../components/PageHeader';
import { SEMANTIC } from '../../styles/tokens';
import ManagedPcPanel from './ManagedPcPanel';

const { Text, Paragraph } = Typography;

/**
 * 「电脑」—— 老板 2026-10-07 第三次合并的结果。
 *
 * 原话：「机器管理、远程控制、客户端版本不都基本类似的？不能整合在一个页面么」。
 * 这三件事本来就是同一台电脑的三个侧面，以前却是三个平级页签，各拉一遍接口、各画一张表：
 *   机器管理 —— 这台电脑是谁的、在不在线、看门狗什么版本、远程管理开没开；
 *   远程控制 —— 同一个使用人的陪玩状态 / 模式 / 限速 + 关机 / 重启 / 限速 / 踢出；
 *   客户端版本 —— 同一个陪玩端的版本是不是最新 + 推送更新 / 装机包 / 部署助手。
 *
 * 现在合成一张表：**一行一台电脑**，右边一列操作全给它（一键诊断 / 查看记录 / 远程指令 / 开通远程管理）。
 *
 * 数据怎么拼（服务端零改动，全在前端按「使用人」对齐）：
 *   /agent/machines（台账）× /companions（实时状态，按 loginUser = 陪玩账号对）
 *   × /agent/version-status（哪个陪玩端版本最新）× /managed-pcs（远程开机要的 MAC）。
 *
 * 取舍：三个页签以前各有一个「推送更新」，现在合并成表头那一个 ——
 * 勾选电脑 → 「推送更新 (n)」只推选中的，「全量推送」推全部在线的。
 */

const FAST_MS = 10 * 1000;
const SLOW_MS = 60 * 1000;

/** 陪玩账号侧的实时信息（/companions 里摘出来的几项）。 */
interface CompanionLite {
  id: string;
  status: string;
  username: string;
  currentMode: string;
  isThrottled: boolean;
  lastHeartbeat: string | null;
}

interface CompanionVersion {
  companionId: string;
  name: string;
  status: string;
  agentVersion: string;
  lastHeartbeat: string | null;
  isLatest: boolean;
}

interface VersionStatus {
  latestVersion: string;
  onlineCount: number;
  upToDateCount: number;
  pendingCount: number;
  list: CompanionVersion[];
}

interface PushResultItem {
  companionId: string;
  name: string;
  status: string;
  agentVersion: string;
  lastHeartbeat: string | null;
  sent: boolean;
  state: 'updating' | 'success' | 'failed' | 'offline';
}

interface DeployScriptData {
  script: string;
  downloadUrl: string;
  serverUrl: string;
}

/** 可以下发的远程指令（走陪玩账号的 /command 接口）。 */
const COMMANDS: { key: string; label: string; danger?: boolean }[] = [
  { key: 'shutdown', label: '关机', danger: true },
  { key: 'restart', label: '重启' },
  { key: 'throttle', label: '限速 500KB/s' },
  { key: 'unthrottle', label: '解除限速' },
  { key: 'kick', label: '踢出陪玩', danger: true },
];

const commandLabel = (key: string): string => COMMANDS.find((c) => c.key === key)?.label ?? key;

function fmtTime(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtFull(v?: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN');
}

function agoText(v?: string | null): string {
  if (!v) return '—';
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return '—';
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  return Math.floor(h / 24) + ' 天前';
}

/** 这个陪玩账号现在算不算在线（状态优先，其次看心跳，2 分钟没心跳算离线）。 */
function companionOnline(c: CompanionLite | undefined): boolean {
  if (!c) return false;
  if (c.status === 'AVAILABLE' || c.status === 'ENTERTAINMENT' || c.status === 'BUSY') return true;
  if (!c.lastHeartbeat) return false;
  return Date.now() - new Date(c.lastHeartbeat).getTime() < 120000;
}

/** 一行 = 一台电脑，把上面四个接口的数据对齐到这里。 */
interface DeviceRow extends MachineItem {
  companionId: string;
  companionStatus: string;
  currentMode: string;
  isThrottled: boolean;
  /** undefined = 没有这个陪玩的版本记录（不显示「最新 / 未更新」标签） */
  isLatest?: boolean;
  /** 这台电脑现在能不能收到远程指令（陪玩端在线） */
  commandReady: boolean;
  /** 「手工登记的电脑」里对应的那台（远程开机要它的 MAC） */
  wakeId: string;
  wakeMac: string;
}

const DevicesPanel: React.FC = () => {
  const [items, setItems] = useState<MachineItem[]>([]);
  const [stats, setStats] = useState({
    total: 0, onlineCount: 0, remoteReadyCount: 0, clientlessCount: 0, diagScriptVersion: '', watchdogLatestBuild: '',
  });
  const [loading, setLoading] = useState(false);
  const [companions, setCompanions] = useState<CompanionLite[]>([]);
  const [versionStatus, setVersionStatus] = useState<VersionStatus | null>(null);
  const [csVersionStatus, setCsVersionStatus] = useState<Record<string, any>[]>([]);
  const [pcs, setPcs] = useState<ManagedPcItem[]>([]);

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [modeFilter, setModeFilter] = useState<string | undefined>();
  const [onlineFilter, setOnlineFilter] = useState<string | undefined>();

  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [tasks, setTasks] = useState<MachineTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [active, setActive] = useState<MachineItem | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTitle, setReportTitle] = useState('');
  const [reportText, setReportText] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [shellOpen, setShellOpen] = useState(false);
  const [shellForm] = Form.useForm();

  const [pushing, setPushing] = useState(false);
  const [building, setBuilding] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [pushResults, setPushResults] = useState<PushResultItem[]>([]);
  const [pushResultOpen, setPushResultOpen] = useState(false);
  const [pushSummary, setPushSummary] = useState('');
  const pushPollTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const pushStartAtRef = React.useRef<number>(0);
  const pushLatestVersionRef = React.useRef<string>('');

  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployData, setDeployData] = useState<DeployScriptData | null>(null);
  const [remoteIPs, setRemoteIPs] = useState('');
  const [remoteUser, setRemoteUser] = useState('Administrator');
  const [remotePass, setRemotePass] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [deployOutput, setDeployOutput] = useState<string | null>(null);
  const [scannedIPs, setScannedIPs] = useState<{ ip: string; mac?: string }[]>([]);
  const [scanning, setScanning] = useState(false);

  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;
  const downloadOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const companionDownloadUrl = downloadOrigin + '/api/agent/download/exe';
  const csDownloadUrl = downloadOrigin + '/api/agent/download/cs';
  // 发给对方的那条「新电脑一键装机」链接：服务端 uploads/ 下的固定文件（改一个文件 = 改所有新装机）
  const setupPcUrl = downloadOrigin + '/uploads/setup-pc.bat';

  const copyText = (text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => message.success(label + '已复制'))
      .catch(() => message.error('复制失败，请手动复制'));
  };

  const hasPending = useMemo(() => items.some((i) => (i.pendingTasks || 0) > 0), [items]);

  const fetchMachines = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await machineApi.list();
      const d = data?.data;
      setItems(d?.items ?? []);
      setStats({
        total: d?.total ?? 0,
        onlineCount: d?.onlineCount ?? 0,
        remoteReadyCount: d?.remoteReadyCount ?? 0,
        clientlessCount: d?.clientlessCount ?? 0,
        diagScriptVersion: d?.diagScriptVersion ?? '',
        watchdogLatestBuild: d?.watchdogLatestBuild ?? '',
      });
    } catch {
      message.error('加载电脑列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCompanions = useCallback(async () => {
    try {
      const { data } = await companionsApi.list();
      const list = (data as any)?.data ?? [];
      setCompanions(
        list.map((c: any) => ({
          id: c.id,
          status: c.status ?? '',
          username: c.user?.username ?? '',
          currentMode: c.pc?.currentMode ?? '',
          isThrottled: !!c.pc?.isThrottled,
          lastHeartbeat: c.pc?.lastHeartbeat ?? null,
        })),
      );
    } catch {
      // 台账不依赖它，静默重试
    }
  }, []);

  const fetchVersions = useCallback(async () => {
    try {
      const { data } = await agentApi.getVersionStatus();
      setVersionStatus((data as any)?.data ?? null);
    } catch {
      // 静默
    }
  }, []);

  const fetchCsVersions = useCallback(async () => {
    try {
      const { data } = await agentApi.getCsVersionStatus();
      setCsVersionStatus((data as any)?.data ?? []);
    } catch {
      // 静默
    }
  }, []);

  const fetchPcs = useCallback(async () => {
    try {
      const { data } = await managedPcApi.list();
      setPcs(data?.data ?? []);
    } catch {
      // 手工登记的电脑可能一台都没有，静默
    }
  }, []);

  const refreshAll = useCallback(() => {
    void fetchMachines();
    void fetchCompanions();
    void fetchVersions();
    void fetchCsVersions();
    void fetchPcs();
  }, [fetchMachines, fetchCompanions, fetchVersions, fetchCsVersions, fetchPcs]);

  useEffect(() => {
    refreshAll();
    const t1 = visibleInterval(fetchMachines, hasPending ? FAST_MS : SLOW_MS);
    const t2 = visibleInterval(fetchCompanions, 30000);
    const t3 = visibleInterval(() => { void fetchVersions(); void fetchCsVersions(); }, 60000);
    const t4 = visibleInterval(fetchPcs, 120000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
      clearInterval(t4);
    };
  }, [refreshAll, fetchMachines, fetchCompanions, fetchVersions, fetchCsVersions, fetchPcs, hasPending]);

  useEffect(() => () => { if (pushPollTimerRef.current) clearInterval(pushPollTimerRef.current); }, []);

  useSocket({ onStatusBroadcast: () => { void fetchCompanions(); } });

  const companionByUsername = useMemo(() => {
    const m = new Map<string, CompanionLite>();
    companions.forEach((c) => { if (c.username && !m.has(c.username)) m.set(c.username, c); });
    return m;
  }, [companions]);

  const versionById = useMemo(() => {
    const m = new Map<string, CompanionVersion>();
    (versionStatus?.list ?? []).forEach((c) => m.set(c.companionId, c));
    return m;
  }, [versionStatus]);

  const pcByLogin = useMemo(() => {
    const m = new Map<string, ManagedPcItem>();
    pcs.forEach((p) => { if (p.loginAccount && !m.has(p.loginAccount)) m.set(p.loginAccount, p); });
    return m;
  }, [pcs]);

  const rows = useMemo<DeviceRow[]>(
    () =>
      items
        .filter((i) => i.source === 'machine')
        .map((i) => {
          const c = companionByUsername.get(i.loginUser);
          const v = c ? versionById.get(c.id) : undefined;
          const pc = pcByLogin.get(i.loginUser);
          return {
            ...i,
            companionId: c?.id ?? '',
            companionStatus: c?.status ?? '',
            currentMode: c?.currentMode ?? '',
            isThrottled: !!c?.isThrottled,
            isLatest: v ? v.isLatest : undefined,
            commandReady: !!c && (i.online || companionOnline(c)),
            wakeId: pc?.id ?? '',
            wakeMac: pc?.macAddress ?? '',
          };
        }),
    [items, companionByUsername, versionById, pcByLogin],
  );

  /** 没有客户端在跑的行（旧客服端版本记录 / 手工登记的电脑）：开不了远程管理，单独一组。 */
  const clientless = useMemo(() => items.filter((i) => i.source !== 'machine'), [items]);

  const wdBehind = useMemo(
    () => (stats.watchdogLatestBuild ? rows.filter((m) => m.watchdogBuild !== stats.watchdogLatestBuild) : []),
    [rows, stats.watchdogLatestBuild],
  );

  const filteredRows = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (k) {
        const hay = [r.label, r.hostname, r.loginUser, r.windowsUser, r.primaryIp, (r.ips || []).join(' '), r.mac, r.machineId];
        if (!hay.filter(Boolean).some((v) => String(v).toLowerCase().includes(k))) return false;
      }
      if (statusFilter && r.companionStatus !== statusFilter) return false;
      if (modeFilter && r.currentMode !== modeFilter) return false;
      if (onlineFilter === 'online' && !r.online) return false;
      if (onlineFilter === 'offline' && r.online) return false;
      return true;
    });
  }, [rows, keyword, statusFilter, modeFilter, onlineFilter]);

  const rowByMachineId = useMemo(() => new Map(rows.map((r) => [r.machineId, r])), [rows]);

  const selectedCompanionIds = useMemo(
    () => selectedRowKeys.map((k) => rowByMachineId.get(String(k))?.companionId).filter((v): v is string => !!v),
    [selectedRowKeys, rowByMachineId],
  );

  const loadTasks = useCallback(async (machine: MachineItem) => {
    setTasksLoading(true);
    try {
      const { data } = await machineApi.tasks(machine.machineId, 30);
      setTasks(((data as any)?.data as MachineTask[]) ?? []);
    } catch {
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  const openDetail = (machine: MachineItem) => {
    setActive(machine);
    setTasks([]);
    void loadTasks(machine);
  };

  const guard = (machine: MachineItem): boolean => {
    if (!machine.diagnosable) {
      message.warning('这台电脑还没上报过机器信息（客户端还停在老版本），等它升级到新版后就能远程诊断了');
      return false;
    }
    if (!machine.online) {
      message.warning('这台电脑现在不在线（客户端没在跑 / 关机 / 断网），等它上线后任务会自动执行');
    }
    return true;
  };

  const runDiag = async (machine: MachineItem) => {
    if (!guard(machine)) return;
    setBusy((p) => ({ ...p, [machine.machineId]: true }));
    try {
      const { data } = await machineApi.diag(machine.machineId);
      message.success((data as any)?.message || '已派发');
      setTimeout(() => {
        void fetchMachines();
        if (active?.machineId === machine.machineId) void loadTasks(machine);
      }, 3000);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '派发失败');
    } finally {
      setBusy((p) => ({ ...p, [machine.machineId]: false }));
    }
  };

  const runEnableRemote = async (machine: MachineItem) => {
    if (!guard(machine)) return;
    setBusy((p) => ({ ...p, [machine.machineId]: true }));
    try {
      const { data } = await machineApi.enableRemote(machine.machineId);
      message.success((data as any)?.message || '已派发');
      setTimeout(() => {
        void fetchMachines();
        if (active?.machineId === machine.machineId) void loadTasks(machine);
      }, 3000);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '派发失败');
    } finally {
      setBusy((p) => ({ ...p, [machine.machineId]: false }));
    }
  };

  const openReport = async (task: MachineTask) => {
    setReportOpen(true);
    setReportTitle(taskTypeLabels[task.type] + ' · ' + task.machineLabel + ' · ' + fmtTime(task.finishedAt || task.createdAt));
    setReportLoading(true);
    setReportText('');
    try {
      const { data } = await machineApi.report(task.id);
      setReportText((data as any)?.data?.text || '（报告是空的）');
    } catch (e: any) {
      setReportText(e?.response?.data?.message || '读取报告失败');
    } finally {
      setReportLoading(false);
    }
  };

  const submitShell = async () => {
    const values = await shellForm.validateFields();
    if (!active) return;
    setBusy((p) => ({ ...p, [active.machineId]: true }));
    try {
      const { data } = await machineApi.shell(active.machineId, values.command);
      message.success((data as any)?.message || '已派发');
      setShellOpen(false);
      shellForm.resetFields();
      setTimeout(() => void loadTasks(active), 3000);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '派发失败');
    } finally {
      setBusy((p) => ({ ...p, [active.machineId]: false }));
    }
  };

  const handleCommand = useCallback(
    async (r: DeviceRow, command: string) => {
      if (!r.companionId) {
        message.warning('这个使用人没有对应的陪玩账号，发不了远程指令');
        return;
      }
      setBusy((p) => ({ ...p, [r.machineId]: true }));
      try {
        if (command === 'kick') {
          await companionsApi.kick(r.companionId);
          message.success('已踢出陪玩');
        } else {
          const params = command === 'throttle' ? { limitKB: 500 } : undefined;
          await companionsApi.sendCommand(r.companionId, command, params);
          message.success('指令「' + commandLabel(command) + '」已发送');
        }
      } catch (e: any) {
        message.error(e?.response?.data?.message || e?.message || '指令发送失败');
      } finally {
        setBusy((p) => ({ ...p, [r.machineId]: false }));
        void fetchCompanions();
      }
    },
    [fetchCompanions],
  );

  const confirmCommand = useCallback(
    (r: DeviceRow, key: string) => {
      const label = commandLabel(key);
      Modal.confirm({
        title: '确定给「' + (r.label || r.machineId) + '」执行' + label + '？',
        content:
          key === 'kick'
            ? '会把这位陪玩强制下线（客户端断开），他要重新登录才接得了单。'
            : key === 'shutdown'
              ? '这台电脑会立刻关机；正在接单的话单子会被打断。'
              : '指令会立刻在这台电脑上执行。',
        okText: '确定' + label,
        okButtonProps: { danger: key === 'shutdown' || key === 'kick' },
        cancelText: '取消',
        onOk: () => handleCommand(r, key),
      });
    },
    [handleCommand],
  );

  const wakePc = async (r: DeviceRow) => {
    if (!r.wakeId) {
      message.warning('这台电脑没在「手工登记的电脑」里登记过，先到下面那一栏登记（要 MAC）才能远程开机');
      return;
    }
    if (!r.wakeMac) {
      message.warning('这台电脑登记里缺 MAC 地址，补上才能远程开机');
      return;
    }
    setBusy((p) => ({ ...p, [r.machineId]: true }));
    try {
      await managedPcApi.power(r.wakeId, 'wake');
      message.success('远程开机指令已发送');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '开机指令发送失败');
    } finally {
      setBusy((p) => ({ ...p, [r.machineId]: false }));
    }
  };

  const columns = [
    {
      title: '状态',
      key: 'online',
      width: 92,
      render: (_: unknown, r: DeviceRow) => (
        <Space direction='vertical' size={0}>
          {r.online ? <Tag color='success'>在线</Tag> : <Tag color='default'>离线</Tag>}
          <Tooltip title={fmtFull(r.lastSeenAt)}>
            <Text type='secondary' style={{ fontSize: 12 }}>{agoText(r.lastSeenAt)}</Text>
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '这台电脑',
      key: 'label',
      width: 200,
      render: (_: unknown, r: DeviceRow) => (
        <Space direction='vertical' size={0} style={{ maxWidth: 189 }}>
          <Space size={6} wrap={false}>
            <Tooltip title={r.label}>
              <Text strong ellipsis style={{ maxWidth: 112 }}>{r.label}</Text>
            </Tooltip>
            <Tag color={r.clientType === 'CS' ? 'blue' : r.clientType === 'COMPANION' ? 'geekblue' : 'default'}>
              {r.clientType === 'CS' ? '客服端' : r.clientType === 'COMPANION' ? '陪玩端' : '未知'}
            </Tag>
          </Space>
          <Text type='secondary' style={{ fontSize: 12 }} ellipsis>
            {r.loginUser ? '使用人 ' + r.loginUser : r.windowsUser ? 'Windows 账号 ' + r.windowsUser : '—'}
          </Text>
        </Space>
      ),
    },
    {
      title: '陪玩状态',
      key: 'companion',
      width: 146,
      render: (_: unknown, r: DeviceRow) => {
        if (!r.companionId) return <Text type='secondary' style={{ fontSize: 12 }}>不是陪玩账号</Text>;
        const cfg = companionStatusConfig[r.companionStatus] || { label: r.companionStatus || '未知', color: 'default' };
        return (
          <Space direction='vertical' size={0}>
            <Space size={4}>
              <Tag color={cfg.color}>{cfg.label}</Tag>
              {r.currentMode ? <Tag color='blue'>{modeLabels[r.currentMode] || r.currentMode}</Tag> : null}
            </Space>
            {r.isThrottled ? <Tag color='orange'>已限速</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: 'IP / 网卡',
      key: 'ip',
      width: 154,
      render: (_: unknown, r: DeviceRow) => (
        <Space direction='vertical' size={0}>
          <Text code>{r.primaryIp || '—'}</Text>
          {(r.ips || []).length > 1 && (
            <Text type='secondary' style={{ fontSize: 12 }}>{(r.ips || []).slice(1).join('、')}</Text>
          )}
          {r.mac ? <Text type='secondary' style={{ fontSize: 12 }}>{r.mac}</Text> : null}
        </Space>
      ),
    },
    {
      title: '版本',
      key: 'appVersion',
      width: 190,
      render: (_: unknown, r: DeviceRow) => {
        const wdOld = !!r.watchdogBuild && !!stats.watchdogLatestBuild && r.watchdogBuild !== stats.watchdogLatestBuild;
        return (
          <Space direction='vertical' size={0}>
            <Space size={6} wrap={false}>
              <Text code>{r.appVersion || '未知'}</Text>
              {r.isLatest === true && <Tag color='green' icon={<CheckCircleOutlined />}>最新</Tag>}
              {r.isLatest === false && <Tag color='orange' icon={<SyncOutlined />}>未更新</Tag>}
            </Space>
            <Tooltip title='看门狗（SystemHelper）负责自动更新和远程任务；不是最新的会被自动补上'>
              <Text type={wdOld ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
                看门狗 {r.watchdogBuild || '未知'}{wdOld ? ' 待自动更新' : ''}
              </Text>
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: '远程管理',
      key: 'remoteReady',
      width: 128,
      render: (_: unknown, r: DeviceRow) =>
        r.remoteReady ? (
          <Space direction='vertical' size={0}>
            <Tag icon={<SafetyCertificateOutlined />} color='success'>已开通</Tag>
            <Text type='secondary' style={{ fontSize: 12 }}>
              {r.remoteAccount || 'chunlvops'} / {r.remotePassword ? r.remotePassword : '口令见本机留档'}
            </Text>
          </Space>
        ) : (
          <Tag color='default'>未开通</Tag>
        ),
    },
    {
      title: '操作',
      key: 'ops',
      width: 254,
      fixed: 'right' as const,
      render: (_: unknown, r: DeviceRow) => {
        const menuItems: { key: string; label: string; danger?: boolean }[] = COMMANDS.map((c) => ({
          key: c.key,
          label: c.label,
          danger: c.danger,
        }));
        return (
          <Space wrap size={4}>
            <Tooltip title={r.diagnosable ? '让这台电脑把系统 / 网络 / 客户端状态报回来' : '这台电脑还没上报过机器信息，诊断用不了'}>
              <Button
                size='small'
                type='primary'
                icon={<ThunderboltOutlined />}
                loading={!!busy[r.machineId]}
                disabled={!r.diagnosable}
                onClick={() => runDiag(r)}
              >
                诊断
              </Button>
            </Tooltip>
            <Button size='small' onClick={() => openDetail(r)}>记录</Button>
            <span
              title={
                r.commandReady
                  ? '下发远程指令：关机 / 重启 / 限速 / 解除限速 / 踢出'
                  : r.companionId
                    ? '这台电脑现在联系不上（陪玩端不在线），指令发不出去'
                    : '这个使用人不是陪玩账号，没有可下发的在线指令'
              }
            >
              <Dropdown disabled={!r.commandReady} menu={{ items: menuItems, onClick: ({ key }) => confirmCommand(r, key) }}>
                <Button size='small' icon={<DesktopOutlined />} disabled={!r.commandReady}>远程指令</Button>
              </Dropdown>
            </span>
            {!r.remoteReady && (
              <Tooltip title='在这台电脑上建运维账号、开远程管理通道，并把账号口令报回台账'>
                <Button size='small' icon={<CloudDownloadOutlined />} disabled={!r.diagnosable} onClick={() => runEnableRemote(r)}>
                  开通远程
                </Button>
              </Tooltip>
            )}
            {!!r.wakeId && !r.online && (
              <Tooltip title='用登记里的 MAC 把这台电脑唤醒（要主板支持网络唤醒）'>
                <Button size='small' icon={<ThunderboltOutlined />} loading={!!busy[r.machineId]} onClick={() => wakePc(r)}>
                  开机
                </Button>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  /** 「没有客户端的记录」那组的列：只留看得懂的几项，一个按钮都不给（这些行点不动）。 */
  const clientlessColumns = [
    {
      title: '记录',
      key: 'label',
      width: 360,
      render: (_: unknown, r: MachineItem) => (
        <Space direction='vertical' size={0} style={{ maxWidth: 340 }}>
          <Space size={6} wrap={false}>
            <Text strong ellipsis style={{ maxWidth: 200 }}>{r.label}</Text>
            <Tag color='default'>没有机器信息</Tag>
          </Space>
          <Text type='secondary' style={{ fontSize: 12 }} ellipsis>{r.machineId}</Text>
        </Space>
      ),
    },
    { title: '使用人', key: 'loginUser', width: 120, render: (_: unknown, r: MachineItem) => r.loginUser || '—' },
    {
      title: '版本',
      key: 'appVersion',
      width: 160,
      render: (_: unknown, r: MachineItem) => <Text code>{r.appVersion || '未知'}</Text>,
    },
    {
      title: '最后上报',
      key: 'lastSeenAt',
      width: 120,
      render: (_: unknown, r: MachineItem) => (
        <Tooltip title={fmtFull(r.lastSeenAt)}>
          <span>{agoText(r.lastSeenAt)}</span>
        </Tooltip>
      ),
    },
    {
      title: '为什么开不了',
      key: 'why',
      render: (_: unknown, r: MachineItem) =>
        r.source === 'cs-user' ? (
          <Text type='secondary' style={{ fontSize: 12 }}>
            这条只登记了版本和在线时间，没有机器信息；这台电脑上的客户端把机器信息报一次，就会自动挪到上面的表里
          </Text>
        ) : (
          <Text type='secondary' style={{ fontSize: 12 }}>
            以前手工登记的电脑（那时还没装客户端）；装上客户端上报一次就会自动挪到上面的表里
          </Text>
        ),
    },
  ];

  const taskColumns = [
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 130, render: (v: string) => fmtTime(v) },
    { title: '类型', dataIndex: 'type', key: 'type', width: 130, render: (v: string) => taskTypeLabels[v] || v },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 96,
      render: (v: string) => {
        const cfg = taskStatusLabels[v] || { text: v, color: 'default' };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '谁点的',
      dataIndex: 'createdBy',
      key: 'createdBy',
      width: 100,
      render: (v: string) => (v === 'system' ? <Tooltip title='没人点，客户端一上报发现缺东西就自动补的'><Tag color='purple'>自动</Tag></Tooltip> : v || '—'),
    },
    {
      title: '概要',
      key: 'summary',
      render: (_: unknown, t: MachineTask) =>
        t.status === 'failed' ? (
          <Text type='danger'>{t.error || '执行失败'}</Text>
        ) : (
          <Space direction='vertical' size={0}>
            <Text type='secondary'>{t.reportLines ? t.reportLines + ' 行报告' : '等待结果…'}</Text>
            {t.reason ? <Text type='secondary' style={{ fontSize: 12 }}>{t.reason}</Text> : null}
          </Space>
        ),
    },
    {
      title: '操作',
      key: 'ops',
      width: 100,
      render: (_: unknown, t: MachineTask) => (
        <Button size='small' disabled={!t.reportLines && !t.reportFile} onClick={() => openReport(t)}>
          看报告
        </Button>
      ),
    },
  ];

  const secondaryItems: any[] = [
    ...(clientless.length > 0
      ? [
          {
            key: 'clientless',
            label: '开不了远程管理的记录（' + clientless.length + '）',
            children: (
              <div>
                <Text type='secondary' style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                  这些行没有客户端把机器信息报上来（以前手工登记的电脑，或只会报个版本号的旧记录）：开不了远程管理、也不能一键诊断。
                  那台电脑上的客户端把机器信息报一次，就会自动挪到上面的表里。
                </Text>
                <Table<MachineItem>
                  rowKey='machineId'
                  size='small'
                  loading={loading}
                  columns={clientlessColumns as any}
                  dataSource={clientless}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                />
              </div>
            ),
          },
        ]
      : []),
    {
      key: 'csVersion',
      label: '客户端版本上报（客服端 / 陪玩端账号，共 ' + csVersionStatus.length + ' 条）',
      children: (
        <div>
          <Table
            rowKey='userId'
            dataSource={csVersionStatus}
            size='small'
            pagination={{ pageSize: 20 }}
            locale={{ emptyText: '暂无客服端版本上报' }}
            columns={[
              { title: '账号', dataIndex: 'username' },
              { title: '角色', dataIndex: 'role', render: (v: string) => (v === 'CS' ? '客服' : v === 'ADMIN' ? '店长' : v) },
              {
                title: '哪个客户端',
                dataIndex: 'clientKind',
                render: (v: string) => (v === 'companion' ? <Tag>陪玩端</Tag> : <Tag color='blue'>客服端</Tag>),
              },
              {
                title: '版本状态',
                key: 'isLatest',
                render: (_: unknown, r: any) =>
                  r.version === '未登录' ? <Tag color='default'>未登录</Tag> : r.isLatest ? <Tag color='green'>最新</Tag> : <Tag color='orange'>未更新</Tag>,
              },
              { title: '版本', dataIndex: 'version', render: (v: string) => v || '-' },
              { title: '电脑 IP', dataIndex: 'ip', render: (v: string) => v || '-' },
              { title: '最后上报', dataIndex: 'lastSeen', render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-') },
            ]}
          />
          <Text type='secondary' style={{ fontSize: 12 }}>
            标「陪玩端」的是用陪玩端窗口登录的账号（老板 / 店长自己也会），报的是陪玩端版本，不代表这台电脑装了客服端。
            客服端在 1.0.20260935 之后自己带看门狗、静默自动更新，不会再停在老版本。
          </Text>
        </div>
      ),
    },
    {
      key: 'managedPc',
      label: '手工登记的电脑（远程开关机）',
      children: (
        <div>
          <Text type='secondary' style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            管理员手工登记 IP / MAC 的电脑，用来远程开机 / 关机 / 重启 / 睡眠 / 休眠；装上客户端并上报机器信息后，就会出现在上面的表里。
          </Text>
          <ManagedPcPanel />
        </div>
      ),
    },
  ];

  const pollPushResults = async () => {
    try {
      const { data } = await agentApi.getVersionStatus();
      const status = (data as any)?.data as VersionStatus | undefined;
      const latestVersion = pushLatestVersionRef.current || status?.latestVersion || '';
      const onlineMap = new Map((status?.list ?? []).map((c) => [c.companionId, c]));
      const timedOut = Date.now() - pushStartAtRef.current > 5 * 60 * 1000;
      setPushResults((prev) => {
        const next = prev.map((item) => {
          if (item.state === 'offline' || !item.sent) return item;
          const online = onlineMap.get(item.companionId);
          if (online && online.agentVersion === latestVersion) {
            return { ...item, agentVersion: online.agentVersion, state: 'success' as const };
          }
          if (online && online.agentVersion !== latestVersion) {
            return timedOut
              ? { ...item, agentVersion: online.agentVersion, state: 'failed' as const }
              : { ...item, agentVersion: online.agentVersion, state: 'updating' as const };
          }
          return timedOut ? { ...item, state: 'failed' as const } : { ...item, state: 'updating' as const };
        });
        if (prev.some((i) => i.sent && i.state !== 'success') && next.every((i) => !i.sent || i.state === 'success')) {
          message.success('全部在线电脑已更新到最新版本');
        }
        return next;
      });
    } catch {
      // 轮询失败静默重试
    }
  };

  const startPushResultPolling = (results: any[], latestVersion: string) => {
    const initial: PushResultItem[] = (results || []).map((item: any) => ({
      ...item,
      state: item.sent ? 'updating' : 'offline',
    }));
    setPushResults(initial);
    pushLatestVersionRef.current = latestVersion;
    pushStartAtRef.current = Date.now();
    if (pushPollTimerRef.current) clearInterval(pushPollTimerRef.current);
    pushPollTimerRef.current = setInterval(() => { void pollPushResults(); }, 5000);
    void pollPushResults();
  };

  const closePushResult = () => {
    if (pushPollTimerRef.current) clearInterval(pushPollTimerRef.current);
    pushPollTimerRef.current = null;
    setPushResultOpen(false);
  };

  const handlePushSelected = async () => {
    if (selectedCompanionIds.length === 0) {
      message.warning('先在表格里勾选要更新的电脑（没有陪玩账号的、已经是最新的勾不了）');
      return;
    }
    setPushing(true);
    try {
      const { data } = await agentApi.pushUpdate(selectedCompanionIds);
      const res = data as any;
      if (res.code === 200) {
        setPushSummary(res.message);
        startPushResultPolling(res.data?.results || [], res.data?.version || '');
        setPushResultOpen(true);
        setSelectedRowKeys([]);
      } else {
        message.error(res.message || '推送失败');
      }
    } catch {
      message.error('推送请求失败');
    } finally {
      setPushing(false);
    }
  };

  const handlePushAll = async () => {
    setPushing(true);
    try {
      const { data } = await agentApi.pushUpdateStudio();
      const res = data as any;
      if (res.code === 200) {
        setPushSummary(res.message);
        startPushResultPolling(res.data?.results || [], res.data?.version || '');
        setPushResultOpen(true);
      } else {
        message.error(res.message || '全量推送失败');
      }
    } catch {
      message.error('全量推送请求失败');
    } finally {
      setPushing(false);
    }
  };

  const handleBuildAndPush = async () => {
    setBuilding(true);
    try {
      const { data } = await agentApi.buildAndPush();
      const res = data as any;
      if (res.code === 200) {
        message.success(res.message || '构建成功，已推送');
        void fetchVersions();
      } else {
        message.error(res.data?.output || res.message || '构建失败');
      }
    } catch (e: any) {
      message.error(e?.response?.data?.message || '构建请求失败');
    } finally {
      setBuilding(false);
    }
  };

  const handleOpenDeploy = async () => {
    setDeployModalOpen(true);
    try {
      const { data } = await agentApi.getDeployScript();
      const res = data as any;
      if (res.code === 200) setDeployData(res.data as DeployScriptData);
    } catch {
      message.error('获取部署脚本失败');
    }
  };

  const handleScanLan = async () => {
    setScanning(true);
    try {
      const res = await agentApi.scanLan();
      const list = ((res.data as any)?.data as { ip: string; mac?: string }[]) || [];
      setScannedIPs(list);
      setRemoteIPs(list.map((h) => h.ip).join('\n'));
      message.success('发现 ' + list.length + ' 台设备');
    } catch {
      message.error('扫描失败');
    } finally {
      setScanning(false);
    }
  };

  const handleDeployAll = async () => {
    if (!remoteIPs.trim()) {
      message.warning('请先扫描局域网或手填 IP');
      return;
    }
    setDeploying(true);
    setDeployOutput(null);
    try {
      const ips = remoteIPs.split(/[,\s]+/).filter(Boolean);
      if (isElectron && (window as any).electronAPI?.executeRemoteDeploy) {
        const res = await agentApi.getRemoteDeployScript({ targetIPs: ips, adminUser: remoteUser, adminPass: remotePass });
        const script = (res.data as any)?.data?.script;
        if (!script) {
          message.error('脚本生成失败');
          setDeploying(false);
          return;
        }
        const out = await (window as any).electronAPI.executeRemoteDeploy(script);
        message.success(out.success ? '全部安装完成！' : '部分失败，查看输出');
        setDeployOutput(out.output || (out.success ? '全部成功' : '部分失败'));
      } else {
        const res = await agentApi.executeRemoteDeploy({ targetIPs: ips, adminUser: remoteUser, adminPass: remotePass });
        const result = (res.data as any)?.data;
        if (result?.success) {
          const ok = (result.results || []).filter((r: any) => r.status === 'OK').length;
          message.success('部署完成：' + ok + '/' + ips.length + ' 成功');
        } else {
          message.warning('部分失败，查看详情');
        }
        setDeployOutput(
          ((result?.results || []) as any[])
            .map((r) => '[' + (r.status === 'OK' ? '✓' : '✗') + '] ' + r.ip + ' — ' + r.reason)
            .join('\n'),
        );
      }
    } catch {
      message.error('部署失败，请检查目标电脑网络');
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div>
      <PageHeader
        embedded
        title='电脑'
        extra={
          <Space wrap>
            <Tooltip title='下载安装包（发给新工作室 / 新电脑）'>
              <Button icon={<DownloadOutlined />} onClick={() => setDownloadModalOpen(true)}>下载安装包</Button>
            </Tooltip>
            <Tooltip title='新电脑批量装客户端'>
              <Button icon={<LaptopOutlined />} onClick={handleOpenDeploy}>部署助手</Button>
            </Tooltip>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={refreshAll}>刷新</Button>
            <Popconfirm
              title='给全部在线陪玩推送更新？'
              description='只影响在线电脑；正在接单的不会被打断（客户端自己挑空闲升级）'
              onConfirm={handlePushAll}
              okText='确认'
              cancelText='取消'
            >
              <Button icon={<SendOutlined />} loading={pushing}>全量推送</Button>
            </Popconfirm>
            <Popconfirm
              title='构建并推送？'
              description='会在服务器上拉代码 + 构建，完成后自动推给在线电脑'
              onConfirm={handleBuildAndPush}
              okText='确认'
              cancelText='取消'
            >
              <Button type='primary' icon={<CloudUploadOutlined />} loading={building}>构建并推送</Button>
            </Popconfirm>
          </Space>
        }
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col flex='1 1 168px'><StatCard size='sm' label='本店电脑' value={stats.total} sub='有客户端在上报的台数' /></Col>
        <Col flex='1 1 168px'><StatCard size='sm' label='在线' value={stats.onlineCount} tint={SEMANTIC.success} /></Col>
        <Col flex='1 1 168px'><StatCard size='sm' label='已开通远程管理' value={stats.remoteReadyCount} /></Col>
        <Col flex='1 1 168px'>
          <StatCard
            size='sm'
            label='陪玩端待更新'
            value={versionStatus?.pendingCount ?? 0}
            tint={SEMANTIC.warning}
            sub={(versionStatus?.onlineCount ?? 0) + ' 人在线 · ' + (versionStatus?.upToDateCount ?? 0) + ' 人已最新'}
          />
        </Col>
        {stats.clientlessCount > 0 && (
          <Col flex='1 1 168px'>
            <StatCard size='sm' label='开不了远程管理的记录' value={stats.clientlessCount} tint={SEMANTIC.warning} sub='在下方折叠区' />
          </Col>
        )}
      </Row>

      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder='搜电脑名 / 使用人 / IP / MAC'
          style={{ width: 240 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Select
          placeholder='陪玩状态'
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
          placeholder='模式'
          allowClear
          style={{ width: 120 }}
          value={modeFilter}
          onChange={setModeFilter}
          options={[
            { label: '娱乐模式', value: 'ENTERTAINMENT' },
            { label: '工作模式', value: 'WORK' },
          ]}
        />
        <Segmented
          size='small'
          value={onlineFilter}
          onChange={(v) => setOnlineFilter(v as string | undefined)}
          options={[
            { label: '全部', value: undefined },
            { label: '在线', value: 'online' },
            { label: '离线', value: 'offline' },
          ]}
        />
        {!!stats.watchdogLatestBuild &&
          (wdBehind.length === 0 ? (
            <Tooltip title={'看门狗负责自动更新和远程任务，现在全机队都是最新版（' + stats.watchdogLatestBuild + '）'}>
              <Tag color='success' style={{ padding: '4px 10px' }}>看门狗 全部最新 ✓</Tag>
            </Tooltip>
          ) : (
            <Tooltip
              title={'这 ' + wdBehind.length + ' 台还不是最新（最新版 ' + stats.watchdogLatestBuild + '）。机器一上线，服务端会自动派任务把它补成最新，不用手动点。'}
            >
              <Tag color='red' style={{ padding: '4px 10px' }}>看门狗 {wdBehind.length} 台待自动更新（上线自动补齐）</Tag>
            </Tooltip>
          ))}
      </Space>

      <Alert
        type='info'
        showIcon
        style={{ marginBottom: 12 }}
        message='这一张表就是一台电脑的一生'
        description={
          <span>
            谁在用、在不在线、装的是不是最新版、看门狗要不要补、远程管理开没开、能下什么指令 —— 都在这一行里。
            这些电脑在各自的局域网里，云服务器直连不进去，走的是「客户端每 5 分钟主动上报」这条路：点「诊断」后 1 分钟内它就会把详细报告传回来
            （系统信息 / 磁盘 / 网络 / 到服务器的连通性 / 客户端进程 / 安装目录 / 客户端日志 / 蓝屏记录）。
            上面几个统计数只算真有客户端在上报机器信息的机器。
            {stats.diagScriptVersion ? '　当前诊断脚本版本：' + stats.diagScriptVersion : ''}
          </span>
        }
      />

      {selectedRowKeys.length > 0 && (
        <div
          style={{
            marginBottom: 12,
            padding: '8px 16px',
            background: SEMANTIC.infoSoft,
            border: '1px solid ' + SEMANTIC.infoBorder,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Text>
            已勾选 <Text strong>{selectedRowKeys.length}</Text> 台电脑
            {selectedCompanionIds.length !== selectedRowKeys.length
              ? '（其中 ' + selectedCompanionIds.length + ' 台有陪玩账号、能推更新）'
              : ''}
          </Text>
          <Space>
            <Button size='small' onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            <Popconfirm
              title='给勾选的电脑推送更新？'
              description={'会给选中的 ' + selectedCompanionIds.length + ' 位陪玩发更新命令，正在接单的会等接完再升'}
              onConfirm={handlePushSelected}
              okText='确认'
              cancelText='取消'
            >
              <Button type='primary' size='small' icon={<SendOutlined />} loading={pushing}>
                推送更新 ({selectedCompanionIds.length})
              </Button>
            </Popconfirm>
          </Space>
        </div>
      )}

      <Text type='secondary' style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
        勾选电脑可以只给那几台推更新（已经是最新的、没有陪玩账号的勾不了）。
      </Text>

      <Table<DeviceRow>
        scroll={{ x: 1196 }}
        rowKey='machineId'
        size='small'
        loading={loading}
        columns={columns as any}
        dataSource={filteredRows}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
          getCheckboxProps: (record: DeviceRow) => ({ disabled: !record.companionId || record.isLatest === true }),
        }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => '共 ' + t + ' 台' }}
        locale={{ emptyText: '没有匹配的电脑' }}
      />

      <Collapse ghost style={{ marginTop: 16 }} items={secondaryItems} />

      <Drawer
        width={860}
        open={!!active}
        onClose={() => setActive(null)}
        title={active ? active.label + ' 的远程记录' : ''}
        extra={
          active && (
            <Space>
              <Button
                type='primary'
                icon={<ThunderboltOutlined />}
                disabled={!active.diagnosable}
                loading={!!busy[active.machineId]}
                onClick={() => runDiag(active)}
              >
                一键诊断
              </Button>
              <Button
                icon={<DesktopOutlined />}
                disabled={!active.diagnosable}
                onClick={() => { shellForm.resetFields(); setShellOpen(true); }}
              >
                下发指令
              </Button>
              <Button icon={<ReloadOutlined />} onClick={() => void loadTasks(active)}>刷新</Button>
            </Space>
          )
        }
      >
        {active && (
          <>
            <Descriptions size='small' column={2} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label='机器编号'>{active.machineId}</Descriptions.Item>
              <Descriptions.Item label='类型'>{active.clientType}</Descriptions.Item>
              <Descriptions.Item label='使用人'>{active.loginUser || '—'}</Descriptions.Item>
              <Descriptions.Item label='Windows 账号'>{active.windowsUser || '—'}</Descriptions.Item>
              <Descriptions.Item label='IP'>{active.primaryIp || '—'}</Descriptions.Item>
              <Descriptions.Item label='MAC'>{active.mac || '—'}</Descriptions.Item>
              <Descriptions.Item label='客户端版本'>{active.appVersion || '—'}</Descriptions.Item>
              <Descriptions.Item label='看门狗版本'>{active.watchdogBuild || '未知'}</Descriptions.Item>
              <Descriptions.Item label='系统'>{active.os || '—'}</Descriptions.Item>
              <Descriptions.Item label='远程账号'>{active.remoteAccount || '未开通'}</Descriptions.Item>
              <Descriptions.Item label='远程口令'>
                {active.remotePassword ? <Text copyable>{active.remotePassword}</Text> : '—'}
              </Descriptions.Item>
              <Descriptions.Item label='首次上报'>{fmtTime(active.firstSeenAt)}</Descriptions.Item>
              <Descriptions.Item label='最后上报'>{fmtTime(active.lastSeenAt)}</Descriptions.Item>
            </Descriptions>
            <Table<MachineTask>
              rowKey='id'
              size='small'
              loading={tasksLoading}
              columns={taskColumns as any}
              dataSource={tasks}
              pagination={false}
              locale={{ emptyText: '还没有派过任务' }}
            />
          </>
        )}
      </Drawer>

      <Modal
        open={reportOpen}
        onCancel={() => setReportOpen(false)}
        footer={<Button onClick={() => setReportOpen(false)}>关闭</Button>}
        width={980}
        title={reportTitle}
      >
        {reportLoading ? (
          <Text>正在读取报告…</Text>
        ) : (
          <Paragraph>
            <pre style={{ maxHeight: '62vh', overflow: 'auto', fontSize: 12, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {reportText}
            </pre>
          </Paragraph>
        )}
      </Modal>

      <Modal
        open={shellOpen}
        onCancel={() => setShellOpen(false)}
        onOk={submitShell}
        okText='下发'
        title={active ? '给 ' + active.label + ' 下发 PowerShell 指令' : ''}
      >
        <Form form={shellForm} layout='vertical'>
          <Form.Item
            name='command'
            label='指令'
            rules={[{ required: true, message: '请填写要执行的指令' }]}
            extra='在目标电脑上以 PowerShell 执行，输出会传回来。只读排查用；别写会重启 / 删文件的命令。'
          >
            <Input.TextArea rows={5} placeholder='例如：Get-Process | Where-Object { $_.ProcessName -like "*客服*" } | Select-Object ProcessName,Id,StartTime' />
          </Form.Item>
        </Form>
        <Alert
          type='warning'
          showIcon
          icon={<ExclamationCircleOutlined />}
          message='指令是直接在客服 / 陪玩的电脑上执行的，发之前自己先看清楚。'
        />
      </Modal>

      <Modal
        title={<><DownloadOutlined /> 下载安装包</>}
        open={downloadModalOpen}
        onCancel={() => setDownloadModalOpen(false)}
        footer={null}
        width={560}
      >
        <Space direction='vertical' style={{ width: '100%' }} size='middle'>
          <div style={{ background: SEMANTIC.successSoft, border: '1px solid ' + SEMANTIC.successBorder, borderRadius: 8, padding: 12 }}>
            <Text strong>🖥️ 新电脑一键装机（发给对方的就是这一条链接）</Text>
            <div style={{ marginTop: 6 }}>
              <Input value={setupPcUrl} readOnly />
            </div>
            <Space style={{ marginTop: 8 }}>
              <Button type='primary' icon={<CopyOutlined />} onClick={() => copyText(setupPcUrl, '一键装机链接')}>
                复制链接
              </Button>
            </Space>
            <div style={{ marginTop: 6 }}>
              <Text type='secondary' style={{ fontSize: 12 }}>
                对方双击它 → 自动建 Windows 运维账号（随机口令）+ 装好客户端 + 自动打开；
                账号和口令会自动回传到「客户端管理 → 电脑」，不用问他。
              </Text>
            </div>
          </div>
          <Divider style={{ margin: 0 }} />
          <div>
            <Text strong>🎮 陪玩端（陪玩管理）</Text>
            <div style={{ marginTop: 6 }}>
              <Input value={companionDownloadUrl} readOnly />
            </div>
            <Space style={{ marginTop: 8 }}>
              <Button type='primary' icon={<DownloadOutlined />} href={companionDownloadUrl}>下载</Button>
              <Button icon={<CopyOutlined />} onClick={() => copyText(companionDownloadUrl, '陪玩端链接')}>复制链接</Button>
            </Space>
          </div>
          <Divider style={{ margin: 0 }} />
          <div>
            <Text strong>💬 客服端</Text>
            <div style={{ marginTop: 6 }}>
              <Input value={csDownloadUrl} readOnly />
            </div>
            <Space style={{ marginTop: 8 }}>
              <Button type='primary' icon={<DownloadOutlined />} href={csDownloadUrl}>下载</Button>
              <Button icon={<CopyOutlined />} onClick={() => copyText(csDownloadUrl, '客服端链接')}>复制链接</Button>
            </Space>
          </div>
          <Text type='secondary' style={{ fontSize: 12 }}>
            把「复制链接」得到的地址发给对方，对方浏览器打开即可下载安装（服务端已经是公网地址，外地工作室直接用这个就行）。
          </Text>
        </Space>
      </Modal>

      <Modal
        title='更新推送结果'
        open={pushResultOpen}
        onCancel={closePushResult}
        footer={[<Button key='close' type='primary' onClick={closePushResult}>知道了</Button>]}
        width={760}
      >
        <Alert
          type={pushResults.some((r) => !r.sent) ? 'warning' : 'success'}
          showIcon
          message={pushSummary}
          description='系统会自动等客户端上报新版本：显示「更新成功」才是真的更新完了。下载 / 安装期间是「更新中」，5 分钟还没更新会标成「更新失败」。'
          style={{ marginBottom: 12 }}
        />
        <Table
          rowKey='companionId'
          dataSource={pushResults}
          size='small'
          pagination={false}
          locale={{ emptyText: '没有找到在线陪玩' }}
          columns={[
            { title: '陪玩', dataIndex: 'name' },
            {
              title: '状态',
              dataIndex: 'status',
              render: (s: string) => <Tag color={companionStatusConfig[s]?.color || 'default'}>{companionStatusConfig[s]?.label || s}</Tag>,
            },
            { title: '当前版本', dataIndex: 'agentVersion' },
            {
              title: '推送结果',
              key: 'state',
              render: (_: unknown, item: PushResultItem) => {
                if (item.state === 'success') return <Tag color='green'>更新成功</Tag>;
                if (item.state === 'failed') return <Tag color='red'>更新失败</Tag>;
                if (item.state === 'offline') return <Tag color='default'>未在线</Tag>;
                return <Tag color='processing'>更新中</Tag>;
              },
            },
          ]}
        />
      </Modal>

      <Modal
        title={<><LaptopOutlined /> 部署助手 — 新电脑安装客户端</>}
        open={deployModalOpen}
        onCancel={() => { setDeployModalOpen(false); setRemotePass(''); }}
        width={720}
        footer={[<Button key='close' onClick={() => { setDeployModalOpen(false); setRemotePass(''); }}>关闭</Button>]}
      >
        <Spin spinning={!deployData}>
          {deployData && (
            <>
              <Card size='small' style={{ background: SEMANTIC.warningSoft }}>
                <Text strong style={{ fontSize: 15 }}>⚡ PsExec 远程批量部署</Text>
                <div style={{ marginTop: 8 }}>
                  <Button size='small' loading={scanning} onClick={handleScanLan}>📡 扫描局域网</Button>
                  {scannedIPs.length > 0 && (
                    <div style={{ marginTop: 8, maxHeight: 200, overflow: 'auto' }}>
                      {scannedIPs.map((h, i) => (
                        <div key={h.ip} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                          <span>
                            <Text type='secondary' style={{ marginRight: 6 }}>{i + 1}.</Text>
                            <Text code>{h.ip}</Text>
                            {h.mac ? <Text type='secondary' style={{ fontSize: 10, marginLeft: 8 }}>{h.mac}</Text> : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <Input.TextArea
                    rows={3}
                    style={{ marginTop: 4 }}
                    value={remoteIPs}
                    onChange={(e) => setRemoteIPs(e.target.value)}
                    placeholder='192.168.1.10 192.168.1.11（一行一个，也能用逗号 / 空格分开）'
                  />
                  <Space size={8} style={{ marginTop: 8, width: '100%' }}>
                    <Input value={remoteUser} onChange={(e) => setRemoteUser(e.target.value)} placeholder='管理员账号' style={{ width: 150 }} />
                    <Input.Password value={remotePass} onChange={(e) => setRemotePass(e.target.value)} placeholder='管理员密码（空密码留空）' style={{ width: 210 }} />
                  </Space>
                  <Button danger type='primary' loading={deploying} block style={{ marginTop: 8 }} onClick={handleDeployAll}>
                    ⚡ 一键全部安装
                  </Button>
                  {deployOutput && (
                    <div style={{ marginTop: 8 }}>
                      <Text strong>安装结果：</Text>
                      <details style={{ marginTop: 4 }}>
                        <summary style={{ cursor: 'pointer', fontSize: 12 }}>查看原始输出</summary>
                        <pre style={{ padding: 8, borderRadius: 6, fontSize: 10, whiteSpace: 'pre-wrap', maxHeight: 150, overflow: 'auto', marginTop: 4 }}>
                          {deployOutput}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              </Card>
              <div style={{ marginTop: 12 }}>
                <Text type='secondary'>💡 服务器地址：{deployData.serverUrl}</Text>
              </div>
            </>
          )}
        </Spin>
      </Modal>
    </div>
  );
};

export default DevicesPanel;
