import React, { useState, useEffect, useCallback, createElement } from 'react';
import { Table, Input, Button, Tag, Typography, message, Popconfirm, Tabs, Modal, Select, Radio, Space, Card } from 'antd';
import { PlusOutlined, DeleteOutlined, ReloadOutlined, CloudDownloadOutlined } from '@ant-design/icons';
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

  // 采集（页面级，一次采集四个状态共用）
  const [companions, setCompanions] = useState<any[]>([]);
  const [collectedCompanionId, setCollectedCompanionId] = useState<string | undefined>();
  const [collectedApps, setCollectedApps] = useState<any[]>([]);
  const [collecting, setCollecting] = useState(false);

  // 添加弹窗
  const [addOpen, setAddOpen] = useState(false);
  const [addStatus, setAddStatus] = useState<string>('');
  const [addMode, setAddMode] = useState<'select' | 'manual'>('select');
  const [selectedApps, setSelectedApps] = useState<string[]>([]);
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

  const loadCollectedApps = async (companionId: string) => {
    const { data } = await blacklistApi.getUniqueNames(companionId);
    setCollectedApps(data.data ?? []);
  };

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
        await loadCollectedApps(collectedCompanionId);
      } catch {
        setCollectedApps([]);
      }
      setCollecting(false);
    }, 6000);
  };

  const openAdd = (status: string) => {
    setAddStatus(status);
    setAddMode('select');
    setSelectedApps([]);
    setManualName('');
    setAddOpen(true);
  };

  const handleAdd = async () => {
    const names = addMode === 'manual' ? [manualName.trim()].filter(Boolean) : selectedApps;
    if (names.length === 0) {
      message.warning(addMode === 'manual' ? '请输入进程名称' : '请选择要添加的软件');
      return;
    }
    setSubmitting(true);
    try {
      await Promise.all(
        names.map((n) => companionsApi.addStatusBlacklist({ status: addStatus, processName: n })),
      );
      message.success(`已添加 ${names.length} 个进程`);
      setAddOpen(false);
      fetchAll();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '添加失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (entryId: string) => {
    try {
      await companionsApi.removeStatusBlacklist(entryId);
      message.success('已删除');
      fetchAll();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '删除失败');
    }
  };

  const columns = [
    {
      title: '进程名称',
      dataIndex: 'processName',
      key: 'processName',
      render: (v: string) => (
        <Text code style={{ fontSize: 13 }}>
          {v}
        </Text>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: StatusBlacklistEntry) => (
        <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
          <Button type="link" danger size="small" icon={createElement(DeleteOutlined)}>
            删除
          </Button>
        </Popconfirm>
      ),
    },
  ];

  const renderTab = (status: string) => {
    const list = entries.filter((e) => e.status === status);
    return (
      <div>
        <Table
          size="small"
          columns={columns}
          dataSource={list}
          rowKey="id"
          loading={loading}
          locale={{ emptyText: '该状态下暂无黑名单' }}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
          style={{ marginBottom: 12 }}
        />
        <Button type="primary" icon={createElement(PlusOutlined)} onClick={() => openAdd(status)}>
          添加进程
        </Button>
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
            针对本店所有陪玩，按状态配置禁止运行的进程；陪玩切到该状态时，系统会自动关闭匹配进程。
          </Text>
        </div>
        <Button icon={createElement(ReloadOutlined)} onClick={fetchAll} loading={loading}>
          刷新
        </Button>
      </div>

      <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
        <Text strong style={{ fontSize: 13 }}>
          第一步：采集陪玩已安装软件
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
            {collecting ? '采集中…' : '采集软件'}
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

      <Modal
        title={`添加到「${companionStatusConfig[addStatus]?.label || addStatus}」黑名单`}
        open={addOpen}
        onOk={handleAdd}
        onCancel={() => setAddOpen(false)}
        confirmLoading={submitting}
        okText="添加"
        cancelText="取消"
        destroyOnClose
        width={500}
      >
        <div style={{ marginTop: 16 }}>
          <Radio.Group value={addMode} onChange={(e) => setAddMode(e.target.value)} style={{ marginBottom: 12 }}>
            <Radio.Button value="select">从已采集软件选择</Radio.Button>
            <Radio.Button value="manual">手动输入</Radio.Button>
          </Radio.Group>

          {addMode === 'select' ? (
            <div>
              {collectedApps.length === 0 ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  还没有采集软件，请先在上方「第一步」选择陪玩并点击采集。
                </Text>
              ) : (
                <>
                  <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                    选择要禁止的软件（可多选）
                  </Text>
                  <Select
                    placeholder="选择软件"
                    style={{ width: '100%' }}
                    mode="multiple"
                    value={selectedApps}
                    onChange={setSelectedApps}
                    showSearch
                    filterOption={(input, option) =>
                      ((option?.label as string) || '').toLowerCase().includes(input.toLowerCase())
                    }
                    options={collectedApps.map((a: any) => {
                      const exe = a.exe || a.name || '';
                      return { label: `${a.name || exe}${exe ? `（${exe}）` : ''}`, value: exe };
                    })}
                  />
                </>
              )}
            </div>
          ) : (
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                进程名称（如 WeChat.exe、YY.exe）
              </Text>
              <Input
                placeholder="输入进程名称"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                onPressEnter={handleAdd}
              />
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default BlacklistPage;
