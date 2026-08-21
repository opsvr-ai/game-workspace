import React, { useState, useEffect, useCallback, createElement } from 'react';
import { Table, Button, Tag, Typography, message, Tabs, Select, Space, Card, Checkbox, Popconfirm } from 'antd';
import { PlusOutlined, ReloadOutlined, CloudDownloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { companionsApi } from '../../api/companions';
import { blacklistApi } from '../../api/blacklist';
import { companionStatusConfig } from '../../constants';

const { Text } = Typography;

const STATUS_OPTIONS = ['AVAILABLE', 'BUSY', 'ENTERTAINMENT', 'RESTING'];

interface PendingEntry {
  id: string;
  processName: string;
}

const BlacklistPage: React.FC = () => {
  // 各状态黑名单
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // 采集
  const [companions, setCompanions] = useState<any[]>([]);
  const [collectedCompanionId, setCollectedCompanionId] = useState<string | undefined>();
  const [collectedApps, setCollectedApps] = useState<any[]>([]);
  const [collecting, setCollecting] = useState(false);
  const [selectedCollected, setSelectedCollected] = useState<string[]>([]);

  // 待禁用名单
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [addingToPending, setAddingToPending] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [blRes, pendingRes] = await Promise.all([
        companionsApi.listStatusBlacklists(),
        blacklistApi.listPendingDisable(),
      ]);
      setEntries(blRes.data.data ?? []);
      setPending(pendingRes.data.data ?? []);
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

  const addToPending = async () => {
    if (selectedCollected.length === 0) {
      message.warning('请先勾选要加入待禁用名单的进程');
      return;
    }
    setAddingToPending(true);
    try {
      await Promise.all(
        selectedCollected.map((n) => blacklistApi.addPendingDisable({ processName: n })),
      );
      message.success(`已加入 ${selectedCollected.length} 个进程到待禁用名单`);
      setSelectedCollected([]);
      fetchAll();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '加入失败');
    } finally {
      setAddingToPending(false);
    }
  };

  const removeFromPending = async (id: string) => {
    try {
      await blacklistApi.removePendingDisable(id);
      message.success('已移除');
      fetchAll();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '移除失败');
    }
  };

  const toggleStatus = async (status: string, processName: string, checked: boolean) => {
    const existing = entries.find(
      (e) => e.status === status && e.processName.toLowerCase() === processName.toLowerCase(),
    );
    try {
      if (checked && !existing) {
        await companionsApi.addStatusBlacklist({ status, processName });
      } else if (!checked && existing) {
        await companionsApi.removeStatusBlacklist(existing.id);
      }
      fetchAll();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '操作失败');
    }
  };

  const renderStatusTab = (status: string) => {
    const blacklisted = new Set(
      entries.filter((e) => e.status === status).map((e) => e.processName.toLowerCase()),
    );
    if (pending.length === 0) {
      return <div style={{ color: '#999', padding: '20px 0' }}>待禁用名单为空，请先在上方采集并挑选进程。</div>;
    }
    return (
      <div>
        <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
          勾选 = 禁用该进程；取消勾选 = 解除禁用（删除）。
        </Text>
        <Table
          size="small"
          rowKey="id"
          dataSource={pending}
          loading={loading}
          pagination={false}
          columns={[
            { title: '进程名称', dataIndex: 'processName', render: (v: string) => <Text code>{v}</Text> },
            {
              title: '在该状态下禁用',
              width: 150,
              render: (_: unknown, r: PendingEntry) => (
                <Checkbox
                  checked={blacklisted.has(r.processName.toLowerCase())}
                  onChange={(e) => toggleStatus(status, r.processName, e.target.checked)}
                />
              ),
            },
          ]}
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
            采集进程 → 挑选进待禁用名单 → 再分配到各状态。
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
              setSelectedCollected([]);
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
          {collectedApps.length > 0 && <Tag color="blue">已采集 {collectedApps.length} 个软件</Tag>}
        </Space>

        {collectedApps.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              勾选要放进「待禁用名单」的进程（可多选）：
            </Text>
            <Select
              placeholder="勾选进程"
              mode="multiple"
              allowClear
              style={{ width: '100%', marginTop: 6 }}
              value={selectedCollected}
              onChange={setSelectedCollected}
              showSearch
              filterOption={(input, option) =>
                ((option?.label as string) || '').toLowerCase().includes(input.toLowerCase())
              }
              options={collectedApps.map((a: any) => {
                const exe = a.exe || a.name || '';
                return { label: `${a.name || exe}${exe && exe !== a.name ? `（${exe}）` : ''}`, value: exe };
              })}
            />
            <Button
              type="primary"
              icon={createElement(PlusOutlined)}
              loading={addingToPending}
              disabled={selectedCollected.length === 0}
              onClick={addToPending}
              style={{ marginTop: 8 }}
            >
              加入待禁用名单
            </Button>
          </div>
        )}
      </Card>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>
          第二步：待禁用名单（{pending.length}）
        </Text>
        <Table
          size="small"
          rowKey="id"
          dataSource={pending}
          loading={loading}
          pagination={false}
          locale={{ emptyText: '暂无，请先采集并挑选' }}
          style={{ marginTop: 8 }}
          columns={[
            { title: '进程名称', dataIndex: 'processName', render: (v: string) => <Text code>{v}</Text> },
            {
              title: '操作',
              width: 80,
              render: (_: unknown, r: PendingEntry) => (
                <Popconfirm title="确定移除？" onConfirm={() => removeFromPending(r.id)}>
                  <Button type="link" danger size="small" icon={createElement(DeleteOutlined)}>
                    移除
                  </Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>

      <Card size="small">
        <Text strong style={{ fontSize: 13 }}>
          第三步：分配到各状态（勾选即禁用）
        </Text>
        <Tabs
          style={{ marginTop: 8 }}
          items={STATUS_OPTIONS.map((s) => ({
            key: s,
            label: companionStatusConfig[s]?.label || s,
            children: renderStatusTab(s),
          }))}
        />
      </Card>
    </div>
  );
};

export default BlacklistPage;
