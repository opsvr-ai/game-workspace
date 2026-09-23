import React, { useState, useEffect, useCallback, createElement } from 'react';
import { Table, Button, Tag, Typography, message, Tabs, Select, Space, Card, Popconfirm, Switch, Modal } from 'antd';
import { PlusOutlined, ReloadOutlined, CloudDownloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { companionsApi } from '../../api/companions';
import { blacklistApi } from '../../api/blacklist';
import { companionStatusConfig } from '../../constants';
import { configApi } from '../../api/config';
import { useAuthStore } from '../../stores/authStore';

const { Text } = Typography;

const STATUS_OPTIONS = ['AVAILABLE', 'BUSY', 'ENTERTAINMENT', 'RESTING'];

interface PendingEntry {
  id: string;
  processName: string;
  displayName?: string | null;
}

const BlacklistPage: React.FC = () => {
  const isOwner = useAuthStore((s) => s.user?.role) === 'OWNER';
  // 各状态黑名单
  const [entries, setEntries] = useState<any[]>([]);
  // 「本店黑名单是否生效」开关：店长自己拨，且是**唯一**的杀进程开关
  // （老板 2026-09-24 把以前那个「全站总开关」整条去掉了）。默认关 = 线上现状：只记录不杀。
  const [studioEnabled, setStudioEnabled] = useState(false);
  const [studioEnabledLoading, setStudioEnabledLoading] = useState(false);
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

  // 老板账号不用管这一项（各店店长自己在自己账号里拨），所以只给店长读。
  const loadSwitches = useCallback(async () => {
    if (isOwner) return;
    try {
      const { data } = await configApi.get(['blacklist.enabled']);
      const values = data?.data ?? {};
      setStudioEnabled(values['blacklist.enabled'] === true);
    } catch {}
  }, [isOwner]);

  /** 保存一个开关：服务端返回 skipped（没权限改）时不改本地状态，免得界面假装改成功了。 */
  const saveSwitch = async (key: string, next: boolean, done: (v: boolean) => void) => {
    const { data } = await configApi.update({ [key]: next });
    const skipped: string[] = data?.data?.skipped ?? [];
    if (skipped.includes(key)) return false;
    done(next);
    return true;
  };

  /** 本店「黑名单是否生效」：关掉 = 本店名单只记录不杀，出问题一键止血。 */
  const toggleStudioEnabled = (next: boolean) => {
    const apply = async () => {
      setStudioEnabledLoading(true);
      try {
        const ok = await saveSwitch('blacklist.enabled', next, setStudioEnabled);
        if (ok) {
          message.success(
            next
              ? '已开启：本店名单会下发给本店陪玩，陪玩处于对应状态时会结束名单里的进程'
              : '已关闭：本店名单只做记录和上报，本店陪玩不会被自动结束任何进程',
          );
        }
      } catch (err: any) {
        message.error(err?.response?.data?.message || '保存失败');
      } finally {
        setStudioEnabledLoading(false);
      }
    };
    if (next) {
      void apply();
      return;
    }
    Modal.confirm({
      title: '确定让本店黑名单「不生效」？',
      content: '关掉后本店名单只做记录和上报，本店陪玩不会被自动结束任何进程；随时可以再打开。',
      okText: '确定关闭',
      cancelText: '取消',
      onOk: apply,
    });
  };

  /** 本店开关开着，客户端才会真的杀进程（老板 2026-09-24：只剩这一道闸）。 */
  const killEffective = studioEnabled;

  useEffect(() => {
    fetchAll();
    loadSwitches();
    companionsApi
      .list()
      .then(({ data }: any) => setCompanions(data.data ?? []))
      .catch(() => {});
  }, [fetchAll, loadSwitches]);

  const collectApps = async () => {
    if (!collectedCompanionId || collecting) return;
    setCollecting(true);
    try {
      await companionsApi.sendCommand(collectedCompanionId, 'collect_processes', {});
      message.info('已发送采集指令，请稍候…');
    } catch (err: any) {
      message.error(err?.response?.data?.message || '发送采集指令失败');
      setCollecting(false);
      return;
    }
    // 轮询采集结果，最多约 15 秒
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const { data } = await blacklistApi.getUniqueNames(collectedCompanionId);
        const apps = data.data ?? [];
        if (apps.length > 0) {
          setCollectedApps(apps);
          message.success(`采集完成，共 ${apps.length} 个软件`);
          setCollecting(false);
          return;
        }
      } catch {
        /* 继续轮询 */
      }
    }
    setCollectedApps([]);
    setCollecting(false);
    message.warning('未采集到结果：请确认该陪玩客户端在线且已更新到最新版，再重试');
  };

  const addToPending = async () => {
    if (selectedCollected.length === 0) {
      message.warning('请先勾选要加入待禁用名单的进程');
      return;
    }
    setAddingToPending(true);
    try {
      const displayMap = new Map(
        collectedApps.map((a: any) => [a.exe || a.name, a.name as string]),
      );
      await Promise.all(
        selectedCollected.map((n) =>
          blacklistApi.addPendingDisable({
            processName: n,
            displayName: displayMap.get(n) || undefined,
          }),
        ),
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

  const toggleStatus = async (
    status: string,
    processName: string,
    checked: boolean,
    displayName?: string | null,
  ) => {
    const existing = entries.find(
      (e) => e.status === status && e.processName.toLowerCase() === processName.toLowerCase(),
    );
    try {
      if (checked && !existing) {
        await companionsApi.addStatusBlacklist({ status, processName, displayName: displayName || undefined });
      } else if (!checked && existing) {
        await companionsApi.removeStatusBlacklist(existing.id);
      }
      fetchAll();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '操作失败');
    }
  };

  const renderStatusTab = (status: string) => {
    const statusEntries = entries.filter((e) => e.status === status);
    const statusNames = new Set(statusEntries.map((e) => e.processName.toLowerCase()));
    const addable = pending.filter((p) => !statusNames.has(p.processName.toLowerCase()));
    const statusLabel = companionStatusConfig[status]?.label || status;
    return (
      <div>
        <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
          在「{statusLabel}」状态下禁用以下进程，可随时删除；从下方下拉添加要禁用的进程。
        </Text>
        <Space style={{ marginBottom: 12 }}>
          <Select
            placeholder="从采集的进程里添加"
            style={{ width: 360 }}
            showSearch
            value={undefined}
            onChange={(processName: string) => {
              if (!processName) return;
              const pendingItem = addable.find((p) => p.processName === processName);
              toggleStatus(status, processName, true, pendingItem?.displayName);
            }}
            optionFilterProp="label"
            options={addable.map((p) => ({
              value: p.processName,
              label: p.displayName || p.processName,
            }))}
          />
        </Space>
        <Table
          size="small"
          rowKey="id"
          dataSource={statusEntries}
          loading={loading}
          pagination={false}
          locale={{ emptyText: '该状态暂无禁用进程' }}
          columns={[
            {
              title: '进程名称',
              dataIndex: 'processName',
              render: (_: string, r: any) => (
                <span>
                  <Text>{r.displayName || r.processName}</Text>
                  {r.displayName && r.displayName !== r.processName && (
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                      ({r.processName})
                    </Text>
                  )}
                </span>
              ),
            },
            {
              title: '操作',
              width: 90,
              render: (_: unknown, r: any) => (
                <Popconfirm title="确定从该状态删除？" onConfirm={() => toggleStatus(status, r.processName, false)}>
                  <Button type="link" danger size="small" icon={createElement(DeleteOutlined)}>删除</Button>
                </Popconfirm>
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

      {isOwner ? (
        <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
          <Text strong style={{ fontSize: 13 }}>
            黑名单是否生效：各店自己定
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            这一项由各店的店长在自己账号里拨（「本店黑名单是否生效」）：拨开 = 那家店的名单才会真的结束进程，
            关着 = 那家店只做记录和上报。各店互相不影响，老板账号不用管这一项。
          </Text>
        </Card>
      ) : (
        <Card
          size="small"
          style={{ marginBottom: 12, background: killEffective ? '#fff2f0' : '#f6ffed', borderColor: killEffective ? '#ffccc7' : '#b7eb8f' }}
        >
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <div>
              <Text strong style={{ fontSize: 13 }}>
                本店黑名单是否生效
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {studioEnabled
                  ? '已开启：本店名单照常下发给本店陪玩，陪玩处于对应状态时会结束名单里的进程。'
                  : '已关闭：本店名单只做记录和上报，本店陪玩不会被自动结束任何进程。'}
              </Text>
              <br />
              <Text type={killEffective ? 'danger' : 'success'} style={{ fontSize: 12 }}>
                当前实际：{killEffective ? '会结束名单里的进程' : '不结束任何进程'}
              </Text>
            </div>
            <Switch
              checked={studioEnabled}
              loading={studioEnabledLoading}
              onChange={toggleStudioEnabled}
              checkedChildren="开"
              unCheckedChildren="关"
            />
          </Space>
        </Card>
      )}

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
            {
              title: '进程名称',
              dataIndex: 'processName',
              render: (_: string, r: PendingEntry) => (
                <span>
                  <Text>{r.displayName || r.processName}</Text>
                  {r.displayName && r.displayName !== r.processName && (
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                      ({r.processName})
                    </Text>
                  )}
                </span>
              ),
            },
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
