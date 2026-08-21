import React, { useState, useEffect, useCallback, createElement } from 'react';
import { Table, Input, Button, Tag, Typography, message, Tabs, Select, Space, Card, Checkbox } from 'antd';
import { PlusOutlined, ReloadOutlined, CloudDownloadOutlined } from '@ant-design/icons';
import { companionsApi } from '../../api/companions';
import { blacklistApi } from '../../api/blacklist';
import { companionStatusConfig } from '../../constants';

const { Text } = Typography;

const STATUS_OPTIONS = ['AVAILABLE', 'BUSY', 'ENTERTAINMENT', 'RESTING'];

interface StatusBlacklistEntry {
  id: string;
  studioId: string;
  status: string;
  processName: string;
  createdAt: string;
}

const BlacklistPage: React.FC = () => {
  const [entries, setEntries] = useState<StatusBlacklistEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // 采集（备用进程列表）
  const [companions, setCompanions] = useState<any[]>([]);
  const [collectedCompanionId, setCollectedCompanionId] = useState<string | undefined>();
  const [collectedApps, setCollectedApps] = useState<any[]>([]);
  const [collecting, setCollecting] = useState(false);

  // 手动添加
  const [manualStatus, setManualStatus] = useState<string>(STATUS_OPTIONS[0]);
  const [manualName, setManualName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await companionsApi.listStatusBlacklists();
      setEntries(data.data ?? []);
    } catch (err: any) {
      message.error(err?.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    companionsApi
      .list()
      .then(({ data }: any) => setCompanions(data.data ?? []))
      .catch(() => {});
  }, [fetchAll]);

  const collectApps = async () => {
    if (!collectedCompanionId || collecting) return;
    setCollecting(true);
    try {
      await companionsApi.sendCommand(collectedCompanionId, 'collect_processes', {});
      message.info('已发送采集指令，请稍候…');
    } catch (err: any) {
      message.error(err?.response?.data?.message || '发送采集指令失败');
    }
    setTimeout(async () => {
      try {
        const { data } = await blacklistApi.getUniqueNames(collectedCompanionId);
        setCollectedApps(data.data ?? []);
      } catch {
        setCollectedApps([]);
      }
      setCollecting(false);
    }, 6000);
  };

  const toggleApp = async (status: string, app: any, checked: boolean) => {
    const exe = app.exe || app.name || '';
    if (!exe) return;
    const existing = entries.find(
      (e) => e.status === status && e.processName.toLowerCase() === exe.toLowerCase(),
    );
    try {
      if (checked && !existing) {
        await companionsApi.addStatusBlacklist({ status, processName: exe });
      } else if (!checked && existing) {
        await companionsApi.removeStatusBlacklist(existing.id);
      }
      fetchAll();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '操作失败');
    }
  };

  const handleManualAdd = async () => {
    const name = manualName.trim();
    if (!name) {
      message.warning('请输入进程名称');
      return;
    }
    setSubmitting(true);
    try {
      await companionsApi.addStatusBlacklist({ status: manualStatus, processName: name });
      message.success('已添加');
      setManualName('');
      fetchAll();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '添加失败');
    } finally {
      setSubmitting(false);
    }
  };

  const renderTab = (status: string) => {
    const blacklisted = new Map<string, string>();
    entries
      .filter((e) => e.status === status)
      .forEach((e) => blacklisted.set(e.processName.toLowerCase(), e.id));

    if (collectedApps.length === 0) {
      return (
        <div style={{ color: '#999', padding: '20px 0' }}>
          请先在上方「采集陪玩进程」里选陪玩并采集，再回到这里勾选。
        </div>
      );
    }

    const columns = [
      {
        title: '软件名称',
        key: 'name',
        render: (_: unknown, a: any) => (
          <span>
            {a.name || a.exe || '-'}
            {a.exe && a.exe !== a.name ? <Text type="secondary" style={{ fontSize: 12 }}>（{a.exe}）</Text> : null}
          </span>
        ),
      },
      {
        title: '在该状态下禁用',
        key: 'disabled',
        width: 140,
        render: (_: unknown, a: any) => {
          const exe = a.exe || a.name || '';
          const checked = blacklisted.has(exe.toLowerCase());
          return (
            <Checkbox
              checked={checked}
              onChange={(e) => toggleApp(status, a, e.target.checked)}
            />
          );
        },
      },
    ];

    return (
      <div>
        <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
          勾选即禁止该进程，取消勾选即解除禁止（针对本店所有陪玩）。
        </Text>
        <Table
          size="small"
          rowKey={(a: any) => a.exe || a.name}
          columns={columns}
          dataSource={collectedApps}
          loading={loading}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 个软件` }}
        />
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <Text strong style={{ fontSize: 16 }}>
            状态黑名单管理
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            第一步先采集陪玩进程，第二步在各状态下勾选要禁止的软件。
          </Text>
        </div>
        <Button icon={createElement(ReloadOutlined)} onClick={fetchAll} loading={loading}>
          刷新
        </Button>
      </div>

      <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
        <Text strong style={{ fontSize: 13 }}>
          第一步：采集陪玩进程
        </Text>
        <Space style={{ marginTop: 8 }}>
          <Select
            placeholder="选择陪玩"
            style={{ width: 220 }}
            showSearch
            value={collectedCompanionId}
            onChange={(cid) => {
              setCollectedCompanionId(cid);
              setCollectedApps([]);
            }}
            filterOption={(input, option) =>
              ((option?.label as string) || '').toLowerCase().includes(input.toLowerCase())
            }
            options={companions.map((c: any) => ({ label: c.user?.username || c.id, value: c.id }))}
          />
          <Button
            type="primary"
            icon={createElement(CloudDownloadOutlined)}
            loading={collecting}
            disabled={!collectedCompanionId}
            onClick={collectApps}
          >
            {collecting ? '采集中…' : '采集进程'}
          </Button>
          {collectedApps.length > 0 && (
            <Tag color="blue">已采集 {collectedApps.length} 个软件</Tag>
          )}
        </Space>
      </Card>

      <Tabs
        items={STATUS_OPTIONS.map((s) => ({
          key: s,
          label: companionStatusConfig[s]?.label || s,
          children: renderTab(s),
        }))}
      />

      <Card size="small" style={{ marginTop: 4 }}>
        <Text strong style={{ fontSize: 13 }}>
          手动补充进程
        </Text>
        <Space style={{ marginTop: 8 }}>
          <Select
            style={{ width: 140 }}
            value={manualStatus}
            onChange={setManualStatus}
            options={STATUS_OPTIONS.map((s) => ({ label: companionStatusConfig[s]?.label || s, value: s }))}
          />
          <Input
            placeholder="如 WeChat.exe"
            style={{ width: 240 }}
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            onPressEnter={handleManualAdd}
          />
          <Button type="primary" icon={createElement(PlusOutlined)} loading={submitting} onClick={handleManualAdd}>
            添加
          </Button>
        </Space>
      </Card>
    </div>
  );
};

export default BlacklistPage;
