// craftsman-ignore: TS001,TS002
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Descriptions, Drawer, Form, Input, Modal, Space, Statistic, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import {
  CloudDownloadOutlined, DesktopOutlined, ExclamationCircleOutlined, ReloadOutlined, SafetyCertificateOutlined,
  SearchOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import {
  MachineItem, MachineTask, machineApi, taskStatusLabels, taskTypeLabels,
} from '../../api/machines';
import { visibleInterval } from '../../hooks/usePolling';
import ManagedPcPanel from './ManagedPcPanel';
import PageHeader from '../../components/PageHeader';

const { Text, Paragraph } = Typography;

/** 有任务在排队/执行时刷新快一点，平时慢一点，别一直打服务器。 */
const FAST_MS = 10 * 1000;
const SLOW_MS = 60 * 1000;

function fmtTime(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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

const MachinesPage: React.FC = () => {
  const [items, setItems] = useState<MachineItem[]>([]);
  const [stats, setStats] = useState({
    total: 0, onlineCount: 0, remoteReadyCount: 0, clientlessCount: 0, diagScriptVersion: '', watchdogLatestBuild: '',
  });
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
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

  const hasPending = useMemo(() => items.some((i) => (i.pendingTasks || 0) > 0), [items]);

  const fetchItems = useCallback(async () => {
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
      message.error('加载机器列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
    const timer = visibleInterval(fetchItems, hasPending ? FAST_MS : SLOW_MS);
    return () => clearInterval(timer);
  }, [fetchItems, hasPending]);

  const loadTasks = useCallback(async (machine: MachineItem) => {
    setTasksLoading(true);
    try {
      const { data } = await machineApi.tasks(machine.machineId, 30);
      setTasks((data?.data as MachineTask[]) ?? []);
    } catch {
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  const openDetail = (machine: MachineItem) => {
    setActive(machine);
    setTasks([]);
    loadTasks(machine);
  };

  const guard = (machine: MachineItem): boolean => {
    if (!machine.diagnosable) {
      message.warning('这台电脑还没上报过机器信息（客服端还停在旧版本），等它的客户端升级到新版后就能远程诊断了');
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
      message.success(data?.message || '已派发');
      setTimeout(() => {
        fetchItems();
        if (active?.machineId === machine.machineId) loadTasks(machine);
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
      message.success(data?.message || '已派发');
      setTimeout(() => {
        fetchItems();
        if (active?.machineId === machine.machineId) loadTasks(machine);
      }, 3000);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '派发失败');
    } finally {
      setBusy((p) => ({ ...p, [machine.machineId]: false }));
    }
  };

  const openReport = async (task: MachineTask) => {
    setReportOpen(true);
    setReportTitle(`${taskTypeLabels[task.type] || task.type} · ${task.machineLabel} · ${fmtTime(task.finishedAt || task.createdAt)}`);
    setReportLoading(true);
    setReportText('');
    try {
      const { data } = await machineApi.report(task.id);
      setReportText(data?.data?.text || '（报告是空的）');
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
      message.success(data?.message || '已派发');
      setShellOpen(false);
      shellForm.resetFields();
      setTimeout(() => loadTasks(active), 3000);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '派发失败');
    } finally {
      setBusy((p) => ({ ...p, [active.machineId]: false }));
    }
  };

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return items;
    return items.filter((i) =>
      [i.label, i.hostname, i.loginUser, i.windowsUser, i.primaryIp, (i.ips || []).join(' '), i.mac, i.machineId]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(k)),
    );
  }, [items, keyword]);

  /** 真有客户端在上报的机器：统计和主表都只认这些。 */
  const realMachines = useMemo(() => filtered.filter((i) => i.source === 'machine'), [filtered]);
  /** 没有客户端在跑的行（旧客服端版本记录 / 手工登记的电脑）：开不了远程管理，单独一组。 */
  const clientless = useMemo(() => filtered.filter((i) => i.source !== 'machine'), [filtered]);

  // 看门狗版本汇总（老板 2026-10-05：「不都应该是最新的么？还用我费脑子去看？」）：
  // 一行说清楚全机队是不是都最新，不用再去表格里一台台找那枚红色「待自动更新」标签。
  const wdBehind = useMemo(
    () => (stats.watchdogLatestBuild ? realMachines.filter((m) => m.watchdogBuild !== stats.watchdogLatestBuild) : []),
    [realMachines, stats.watchdogLatestBuild],
  );

  const columns = [
    {
      title: '状态',
      key: 'online',
      width: 84,
      render: (_: unknown, r: MachineItem) =>
        r.online ? <Tag color="success">在线</Tag> : <Tag color="default">离线</Tag>,
    },
    {
      title: '这台电脑',
      key: 'label',
      width: 300,
      render: (_: unknown, r: MachineItem) => (
        <Space direction="vertical" size={0} style={{ maxWidth: 280 }}>
          <Space size={6} wrap={false}>
            <Tooltip title={r.label}>
              <Text strong ellipsis style={{ maxWidth: 150 }}>{r.label}</Text>
            </Tooltip>
            <Tag color={r.clientType === 'CS' ? 'blue' : r.clientType === 'COMPANION' ? 'geekblue' : 'default'}>
              {r.clientType === 'CS' ? '客服端' : r.clientType === 'COMPANION' ? '陪玩端' : '未知'}
            </Tag>
            {r.source !== 'machine' && <Tag color="warning">旧版客户端</Tag>}
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }} ellipsis>
            {r.loginUser ? `使用人 ${r.loginUser}` : r.windowsUser ? `Windows 账号 ${r.windowsUser}` : '—'}
          </Text>
        </Space>
      ),
    },
    {
      title: 'IP / 网卡',
      key: 'ip',
      width: 220,
      render: (_: unknown, r: MachineItem) => (
        <Space direction="vertical" size={0}>
          <Text code>{r.primaryIp || '—'}</Text>
          {(r.ips || []).length > 1 && (
            <Text type="secondary" style={{ fontSize: 12 }}>{(r.ips || []).slice(1).join('、')}</Text>
          )}
          {r.mac ? <Text type="secondary" style={{ fontSize: 12 }}>{r.mac}</Text> : null}
        </Space>
      ),
    },
    {
      title: '版本',
      key: 'appVersion',
      width: 168,
      render: (_: unknown, r: MachineItem) => (
        <Space direction="vertical" size={0}>
          <Text code>{r.appVersion || '未知'}</Text>
          <Tooltip title="看门狗（SystemHelper）负责自动更新和远程任务；不是最新的会被自动补上">
            <Text
              type={r.watchdogBuild && stats.watchdogLatestBuild && r.watchdogBuild !== stats.watchdogLatestBuild ? 'danger' : 'secondary'}
              style={{ fontSize: 12 }}
            >
              看门狗 {r.watchdogBuild || '未知'}
              {r.watchdogBuild && stats.watchdogLatestBuild && r.watchdogBuild !== stats.watchdogLatestBuild ? '（待自动更新）' : ''}
            </Text>
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '远程管理',
      key: 'remoteReady',
      width: 180,
      render: (_: unknown, r: MachineItem) =>
        r.remoteReady ? (
          <Space direction="vertical" size={0}>
            <Tag icon={<SafetyCertificateOutlined />} color="success">已开通</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {r.remoteAccount || 'chunlvops'} / {r.remotePassword ? r.remotePassword : '口令见本机留档'}
            </Text>
          </Space>
        ) : (
          <Tag color="default">未开通</Tag>
        ),
    },
    {
      title: '最后上报',
      key: 'lastSeenAt',
      width: 120,
      render: (_: unknown, r: MachineItem) => (
        <Tooltip title={r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleString('zh-CN') : ''}>
          <span>{agoText(r.lastSeenAt)}</span>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'ops',
      width: 300,
      render: (_: unknown, r: MachineItem) => (
        <Space wrap>
          <Button
            size="small"
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={!!busy[r.machineId]}
            disabled={!r.diagnosable}
            onClick={() => runDiag(r)}
          >
            一键诊断
          </Button>
          <Button size="small" onClick={() => openDetail(r)}>查看记录</Button>
          {!r.remoteReady && (
            <Tooltip title="在这台电脑上建运维账号、打开远程管理通道，并把账号口令报回台账">
              <Button
                size="small"
                icon={<CloudDownloadOutlined />}
                disabled={!r.diagnosable}
                onClick={() => runEnableRemote(r)}
              >
                开通远程管理
              </Button>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  /** 「没有客户端的记录」那组的列：只留看得懂的几项，一个按钮都不给（这些行点不动）。 */
  const clientlessColumns = [
    {
      title: '记录',
      key: 'label',
      width: 360,
      render: (_: unknown, r: MachineItem) => (
        <Space direction="vertical" size={0} style={{ maxWidth: 340 }}>
          <Space size={6} wrap={false}>
            <Text strong ellipsis style={{ maxWidth: 200 }}>{r.label}</Text>
            <Tag color="default">没有机器信息</Tag>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }} ellipsis>{r.machineId}</Text>
        </Space>
      ),
    },
    {
      title: '使用人',
      key: 'loginUser',
      width: 120,
      render: (_: unknown, r: MachineItem) => r.loginUser || '—',
    },
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
        <Tooltip title={r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleString('zh-CN') : ''}>
          <span>{agoText(r.lastSeenAt)}</span>
        </Tooltip>
      ),
    },
    {
      title: '为什么开不了',
      key: 'why',
      render: (_: unknown, r: MachineItem) =>
        r.source === 'cs-user' ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            这条只登记了版本和在线时间，没有机器信息；这台电脑上的客户端把机器信息报一次，就会自动挪到上面的真机器里
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            以前手工登记的电脑（那时还没装客户端）；装上客户端上报一次就会自动挪到上面的真机器里
          </Text>
        ),
    },
  ];

  const taskColumns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 130,
      render: (v: string) => fmtTime(v),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 130,
      render: (v: string) => taskTypeLabels[v] || v,
    },
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
      render: (v: string) => (v === 'system' ? <Tooltip title="没人点，客户端一上报发现缺东西就自动补的"><Tag color="purple">自动</Tag></Tooltip> : v || '—'),
    },
    {
      title: '概要',
      key: 'summary',
      render: (_: unknown, t: MachineTask) =>
        t.status === 'failed' ? (
          <Text type="danger">{t.error || '执行失败'}</Text>
        ) : (
          <Space direction="vertical" size={0}>
            <Text type="secondary">{t.reportLines ? `${t.reportLines} 行报告` : '等待结果…'}</Text>
            {t.reason ? <Text type="secondary" style={{ fontSize: 12 }}>{t.reason}</Text> : null}
          </Space>
        ),
    },
    {
      title: '操作',
      key: 'ops',
      width: 100,
      render: (_: unknown, t: MachineTask) => (
        <Button size="small" disabled={!t.reportLines && !t.reportFile} onClick={() => openReport(t)}>
          看报告
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="机器管理"
        subtitle="本店电脑台账：谁在用、在不在线、看门狗版本，以及远程管理开通没有"
      />
      <Space style={{ marginBottom: 16 }} wrap>
        <Statistic title="真机器" value={stats.total} />
        <Statistic title="在线" value={stats.onlineCount} valueStyle={{ color: '#52c41a' }} />
        <Statistic title="已开通远程管理" value={stats.remoteReadyCount} />
        {stats.clientlessCount > 0 && (
          <Tooltip title="没有客户端把机器信息报上来的行（以前手工登记的电脑、或只会报个版本号的旧记录）—— 不算真机器、也开不了远程管理，在下面单独一组">
            <Statistic title="开不了远程管理的记录" value={stats.clientlessCount} valueStyle={{ color: '#faad14' }} />
          </Tooltip>
        )}
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜电脑名 / 使用人 / IP / MAC"
          style={{ width: 260 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <Button icon={<ReloadOutlined />} loading={loading} onClick={fetchItems}>刷新</Button>
        {!!stats.watchdogLatestBuild &&
          (wdBehind.length === 0 ? (
            <Tooltip title={`看门狗负责自动更新和远程任务，现在全机队都是最新版（${stats.watchdogLatestBuild}）`}>
              <Tag color="success" style={{ marginInlineStart: 4, padding: '4px 10px' }}>
                看门狗 全部最新 ✓
              </Tag>
            </Tooltip>
          ) : (
            <Tooltip
              title={`这 ${wdBehind.length} 台还不是最新（最新版 ${stats.watchdogLatestBuild}）。机器一上线，服务端会自动派任务把它补成最新，不用手动点。`}
            >
              <Tag color="danger" style={{ marginInlineStart: 4, padding: '4px 10px' }}>
                看门狗 {wdBehind.length} 台待自动更新（上线自动补齐）
              </Tag>
            </Tooltip>
          ))}
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="远程查看是怎么工作的"
        description={
          <span>
            这些电脑在各自的局域网里，云服务器直连不进去，所以走的是「电脑主动往服务器报」这条路：
            客户端每 5 分钟上报一次机器信息，点「一键诊断」后 1 分钟内它就会把详细报告传回来
            （系统信息 / 磁盘 / 网络 / 到服务器的连通性 / 客户端进程 / 安装目录 / 客户端日志 / 系统报错 / 蓝屏记录 /
            远程账号状态 / 代理 VPN 迹象 / 网络连接）。<br />
            上面三个统计数只算**真有客户端在上报机器信息的机器**。下面单独一组就是「没有客户端上报、开不了」的那些行：
            以前手工登记的电脑，或只会报个版本号、不报机器信息的旧记录；它们开不了远程管理、也点不了「一键诊断」，
            别当成「没开通的机器」。等那台电脑上的客户端把机器信息报一次，就会自动挪到上面的真机器里。
            {stats.diagScriptVersion ? `\u3000当前诊断脚本版本：${stats.diagScriptVersion}` : ''}
          </span>
        }
      />

      <Table<MachineItem>
        rowKey="machineId"
        size="small"
        loading={loading}
        columns={columns as any}
        dataSource={realMachines}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        locale={{ emptyText: '没有匹配的机器' }}
      />

      {clientless.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <Space align="baseline" wrap style={{ marginBottom: 8 }}>
            <Text strong>开不了远程管理的记录（{clientless.length}）</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              这些行就是「没有客户端上报、开不了」的那些：没有机器信息，开不了远程管理、也点不了「一键诊断」。
            </Text>
          </Space>
          <Table<MachineItem>
            rowKey="machineId"
            size="small"
            loading={loading}
            columns={clientlessColumns as any}
            dataSource={clientless}
            pagination={{ pageSize: 10, showSizeChanger: false }}
          />
        </div>
      )}

      <Drawer
        width={860}
        open={!!active}
        onClose={() => setActive(null)}
        title={active ? `${active.label} 的远程记录` : ''}
        extra={
          active && (
            <Space>
              <Button
                type="primary"
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
              <Button icon={<ReloadOutlined />} onClick={() => loadTasks(active)}>刷新</Button>
            </Space>
          )
        }
      >
        {active && (
          <>
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="机器编号">{active.machineId}</Descriptions.Item>
              <Descriptions.Item label="类型">{active.clientType}</Descriptions.Item>
              <Descriptions.Item label="使用人">{active.loginUser || '—'}</Descriptions.Item>
              <Descriptions.Item label="Windows 账号">{active.windowsUser || '—'}</Descriptions.Item>
              <Descriptions.Item label="IP">{active.primaryIp || '—'}</Descriptions.Item>
              <Descriptions.Item label="MAC">{active.mac || '—'}</Descriptions.Item>
              <Descriptions.Item label="客户端版本">{active.appVersion || '—'}</Descriptions.Item>
              <Descriptions.Item label="看门狗版本">{active.watchdogBuild || '未知'}</Descriptions.Item>
              <Descriptions.Item label="系统">{active.os || '—'}</Descriptions.Item>
              <Descriptions.Item label="远程账号">{active.remoteAccount || '未开通'}</Descriptions.Item>
              <Descriptions.Item label="远程口令">
                {active.remotePassword ? <Text copyable>{active.remotePassword}</Text> : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="首次上报">{fmtTime(active.firstSeenAt)}</Descriptions.Item>
              <Descriptions.Item label="最后上报">{fmtTime(active.lastSeenAt)}</Descriptions.Item>
            </Descriptions>
            <Table<MachineTask>
              rowKey="id"
              size="small"
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
        {reportLoading ? <Text>正在读取报告…</Text> : (
          <Paragraph>
            <pre style={{ maxHeight: '62vh', overflow: 'auto', fontSize: 12, lineHeight: 1.6, background: '#fafafa', padding: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {reportText}
            </pre>
          </Paragraph>
        )}
      </Modal>

      <Modal
        open={shellOpen}
        onCancel={() => setShellOpen(false)}
        onOk={submitShell}
        okText="下发"
        title={active ? `给 ${active.label} 下发 PowerShell 指令` : ''}
      >
        <Form form={shellForm} layout="vertical">
          <Form.Item
            name="command"
            label="指令"
            rules={[{ required: true, message: '请填写要执行的指令' }]}
            extra="在目标电脑上以 PowerShell 执行，输出会传回来。只读排查用；别写会重启/删文件的命令。"
          >
            <Input.TextArea rows={5} placeholder="例如：Get-Process | Where-Object { $_.ProcessName -like '*客服*' } | Select-Object ProcessName,Id,StartTime" />
          </Form.Item>
        </Form>
        <Alert
          type="warning"
          showIcon
          icon={<ExclamationCircleOutlined />}
          message="指令是直接在客服/陪玩的电脑上执行的，发之前自己先看清楚。"
        />
      </Modal>

      <div style={{ marginTop: 32, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
        <Space align="baseline" wrap style={{ marginBottom: 8 }}>
          <Text strong>手工登记的电脑（远程开关机）</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            管理员手工登记 IP / MAC 的电脑，用来远程开机 / 关机 / 重启 / 睡眠 / 休眠；
            装上客户端并上报机器信息后，就会出现在上面的「客户端机器」里。
          </Text>
        </Space>
        <ManagedPcPanel />
      </div>
    </div>
  );
};

export default MachinesPage;
