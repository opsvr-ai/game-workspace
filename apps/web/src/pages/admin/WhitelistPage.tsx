import React, { useState, useEffect, useCallback, createElement } from 'react';
import { Table, Button, Space, Modal, Input, Popconfirm, message, Tag, Typography, Select, Radio } from 'antd';
import { ReloadOutlined, PlusOutlined, DeleteOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { blacklistApi } from '../../api/blacklist';

const { Text } = Typography;

interface WhitelistEntry {
  id: string;
  processName: string;
  processPath?: string | null;
  isSystem: boolean;
}

const WhitelistPage: React.FC = () => {
  const [items, setItems] = useState<WhitelistEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [processName, setProcessName] = useState('');
  const [processPath, setProcessPath] = useState('');
  const [addMode, setAddMode] = useState<'select' | 'manual'>('select');
  const [selectedCompanionForAdd, setSelectedCompanionForAdd] = useState<string | undefined>();
  const [selectedProcess, setSelectedProcess] = useState<string[]>([]);
  const [reportedProcesses, setReportedProcesses] = useState<string[]>([]);
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [companions, setCompanions] = useState<any[]>([]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await blacklistApi.getWhitelist();
      setItems(data.data ?? []);
    } catch (err: any) {
      message.error('加载白名单失败');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchItems(); import('../../api/companions').then(m => m.companionsApi.list().then(({ data }: any) => setCompanions(data.data ?? [])).catch(() => {})); }, [fetchItems]);

  const loadReportedProcesses = async (companionId: string) => {
    setLoadingProcesses(true);
    try {
      const { data } = await blacklistApi.getUniqueNames(companionId);
      setReportedProcesses(data.data ?? []);
    } catch { setReportedProcesses([]); }
    finally { setLoadingProcesses(false); }
  };

  const handleAdd = async () => {
    const names = addMode === 'select' ? selectedProcess : [processName.trim()];
    if (names.length === 0 || !names[0]) { message.warning(addMode === 'select' ? '请选择进程' : '请输入进程名称'); return; }
    setSubmitting(true);
    try {
      await Promise.all(names.map(name => blacklistApi.addWhitelist({ processName: name, processPath: addMode === 'manual' ? (processPath.trim() || undefined) : undefined })));
      message.success(`已添加 ${names.length} 个进程到白名单`);
      setModalOpen(false);
      setProcessName('');
      setProcessPath('');
      setSelectedCompanionForAdd(undefined);
      setSelectedProcess([]);
      setAddMode('select');
      fetchItems();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '添加失败');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      await blacklistApi.removeWhitelist(id);
      message.success('已删除');
      fetchItems();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '删除失败');
    }
  };

  const columns = [
    {
      title: '类型', dataIndex: 'isSystem', key: 'type', width: 80,
      render: (v: boolean) => v
        ? <Tag color="blue" icon={createElement(SafetyCertificateOutlined)}>系统内置</Tag>
        : <Tag>自定义</Tag>,
    },
    {
      title: '进程名称', dataIndex: 'processName', key: 'processName',
      render: (v: string) => <Text code style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: '操作', key: 'actions', width: 80,
      render: (_: unknown, record: WhitelistEntry) => {
        if (record.isSystem) return <Text type="secondary" style={{ fontSize: 12 }}>不可删除</Text>;
        return (
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger size="small" icon={createElement(DeleteOutlined)}>删除</Button>
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <Text strong style={{ fontSize: 16 }}>进程白名单</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            白名单中的进程不会被关闭（优先级高于黑名单） · 系统内置条目不可删除
          </Text>
        </div>
        <Space>
          <Button icon={createElement(ReloadOutlined)} onClick={fetchItems} loading={loading}>刷新</Button>
          <Button type="primary" icon={createElement(PlusOutlined)}
            onClick={() => { setProcessName(''); setProcessPath(''); setModalOpen(true); }}>添加白名单</Button>
        </Space>
      </div>

      <Table size="small" columns={columns} dataSource={items} rowKey="id" loading={loading}
        locale={{ emptyText: '暂无白名单条目' }}
        pagination={{ pageSize: 50, showTotal: (t) => `共 ${t} 条` }} />

      <Modal title="添加白名单进程" open={modalOpen} onOk={handleAdd}
        onCancel={() => { setModalOpen(false); setAddMode('select'); setSelectedCompanionForAdd(undefined); setSelectedProcess([]); }}
        confirmLoading={submitting} okText="添加" cancelText="取消" destroyOnClose width={480}>
        <div style={{ marginTop: 16 }}>
          <Radio.Group value={addMode} onChange={(e) => setAddMode(e.target.value)} style={{ marginBottom: 12 }}>
            <Radio.Button value="select">从陪玩已上报进程选择</Radio.Button>
            <Radio.Button value="manual">手动输入</Radio.Button>
          </Radio.Group>

          {addMode === 'select' ? (
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>选择陪玩</Text>
              <Select placeholder="选择陪玩" style={{ width: '100%', marginBottom: 12 }} showSearch filterOption={(input, option) => (option?.label as string || '').toLowerCase().includes(input.toLowerCase())}
                value={selectedCompanionForAdd}
                onChange={(cid) => { setSelectedCompanionForAdd(cid); setSelectedProcess([]); loadReportedProcesses(cid); }}
                options={companions.map((c: any) => ({ label: c.user?.username || c.id, value: c.id }))} />
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>选择进程</Text>
              <Select placeholder={selectedCompanionForAdd ? '选择进程' : '请先选择陪玩'} style={{ width: '100%' }}
                mode="multiple" value={selectedProcess} onChange={setSelectedProcess}
                loading={loadingProcesses}
                disabled={!selectedCompanionForAdd}
                options={reportedProcesses.map((n) => ({ label: n, value: n }))}
                showSearch filterOption={(input, option) => (option?.label as string || '').toLowerCase().includes(input.toLowerCase())} />
              {selectedCompanionForAdd && reportedProcesses.length === 0 && !loadingProcesses && (
                <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>该陪玩暂无进程上报数据</Text>
              )}
            </div>
          ) : (
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                进程名称（如 WeChat.exe、YY.exe）
              </Text>
              <Input placeholder="输入进程名称" value={processName}
                onChange={(e) => setProcessName(e.target.value)} onPressEnter={handleAdd} />
              <Text type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 4, display: 'block' }}>
                进程路径（可选）
              </Text>
              <Input placeholder="输入完整路径" value={processPath}
                onChange={(e) => setProcessPath(e.target.value)} />
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default WhitelistPage;
