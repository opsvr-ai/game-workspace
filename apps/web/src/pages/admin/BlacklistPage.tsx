import React, { useState, useEffect, useCallback, createElement } from 'react';
import { Table, Button, Space, Modal, Input, Switch, Popconfirm, message, Typography, Select, Tabs, Radio, Progress, Checkbox, Tag, Badge } from 'antd';
import { ReloadOutlined, PlusOutlined, DeleteOutlined, SendOutlined } from '@ant-design/icons';
import { blacklistApi } from '../../api/blacklist';
import StatusBlacklistConfigModal from '../../components/StatusBlacklistConfigModal';

const { Text } = Typography;

interface BlacklistEntry {
  id: string;
  processName: string;
  processPath?: string | null;
  isActive: boolean;
  createdAt: string;
}

const BlacklistPage: React.FC = () => {
  const [items, setItems] = useState<BlacklistEntry[]>([]);
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
  const [collecting, setCollecting] = useState(false);
  const [collectProgress, setCollectProgress] = useState(0);
  const [collectText, setCollectText] = useState('');
  const [pushModalOpen, setPushModalOpen] = useState(false);
  const [pushTarget, setPushTarget] = useState<'all' | 'selected'>('all');
  const [selectedCompanions, setSelectedCompanions] = useState<string[]>([]);
  const [companions, setCompanions] = useState<any[]>([]);
  const [pushing, setPushing] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [statusBlacklistVisible, setStatusBlacklistVisible] = useState(false);
  const collectTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await blacklistApi.list();
      setItems(data.data?.items ?? []);
    } catch (err: any) {
      message.error('加载黑名单失败');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchItems(); import('../../api/companions').then(m => m.companionsApi.list().then(({ data }: any) => setCompanions(data.data ?? [])).catch(() => {})); }, [fetchItems]);
  useEffect(() => () => { if (collectTimerRef.current) clearInterval(collectTimerRef.current); }, []);

  const loadReportedProcesses = async (companionId: string) => {
    setLoadingProcesses(true);
    try {
      const { data } = await blacklistApi.getUniqueNames(companionId);
      setReportedProcesses(data.data ?? []);
    } catch { setReportedProcesses([]); }
    finally { setLoadingProcesses(false); }
  };

  // 已加入黑名单的进程名（小写集合），用于在采集列表里标记“已添加”，避免重复添加
  const addedNames = new Set(items.map((i) => i.processName.trim().toLowerCase()));
  const selectableProcesses = reportedProcesses.filter((n) => !addedNames.has(n.trim().toLowerCase()));

  const toggleProcess = (name: string, checked: boolean) => {
    setSelectedProcess((prev) => (checked ? [...prev, name] : prev.filter((p) => p !== name)));
  };

  const selectAllProcesses = () => setSelectedProcess(selectableProcesses);
  const clearProcesses = () => setSelectedProcess([]);

  const handleAdd = async () => {
    const names = addMode === 'select' ? selectedProcess : [processName.trim()];
    if (names.length === 0 || !names[0]) { message.warning(addMode === 'select' ? '请选择进程' : '请输入进程名称'); return; }
    setSubmitting(true);
    try {
      await Promise.all(names.map(name => blacklistApi.add({ processName: name, processPath: addMode === 'manual' ? (processPath.trim() || undefined) : undefined })));
      message.success(`已添加 ${names.length} 个进程到黑名单`);
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

  const handleToggle = async (id: string, isActive: boolean) => {
    try {
      await blacklistApi.update(id, { isActive });
      message.success(isActive ? '已启用' : '已禁用');
      fetchItems();
    } catch (err: any) { message.error('更新失败'); }
  };

  const handleBatchDelete = async () => {
    for (const id of selectedRowKeys) { await blacklistApi.remove(id).catch(() => {}); }
    message.success(`已删除 ${selectedRowKeys.length} 条`);
    setSelectedRowKeys([]);
    fetchItems();
  };

  const handleDelete = async (id: string) => {
    try {
      await blacklistApi.remove(id);
      message.success('已删除');
      fetchItems();
    } catch (err: any) { message.error('删除失败'); }
  };

  const handlePush = async () => {
    setPushing(true);
    try {
      const payload: any = {};
      if (pushTarget === 'all') {
        payload.targetAll = true;
      } else {
        payload.companionIds = selectedCompanions;
      }
      const { data } = await blacklistApi.push(payload);
      message.success(data?.message || `已推送`);
      setPushModalOpen(false);
    } catch (err: any) {
      message.error(err?.response?.data?.message || '推送失败');
    } finally { setPushing(false); }
  };

  const columns = [
    {
      title: '进程名称', dataIndex: 'processName', key: 'processName',
      render: (v: string) => <Text code style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: '路径', dataIndex: 'processPath', key: 'processPath',
      render: (v: string | null) => v ? <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> : '-',
      ellipsis: true,
    },
    {
      title: '状态', dataIndex: 'isActive', key: 'isActive', width: 80,
      render: (v: boolean, record: BlacklistEntry) => (
        <Switch size="small" checked={v} onChange={(checked) => handleToggle(record.id, checked)} />
      ),
    },
    {
      title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 170,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作', key: 'actions', width: 80,
      render: (_: unknown, record: BlacklistEntry) => (
        <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
          <Button type="link" danger size="small" icon={createElement(DeleteOutlined)}>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <Text strong style={{ fontSize: 16 }}>进程黑名单管理</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>管理陪玩终端禁止运行的进程</Text>
        </div>
        <Space>
          <Button icon={createElement(ReloadOutlined)} onClick={fetchItems} loading={loading}>刷新</Button>
          <Button icon={createElement(SendOutlined)} onClick={() => setPushModalOpen(true)}>推送黑名单</Button>
          <Button type="primary" icon={createElement(PlusOutlined)} onClick={() => { setProcessName(''); setProcessPath(''); setAddMode('select'); setModalOpen(true); }}>添加进程</Button>
          <Button onClick={() => setStatusBlacklistVisible(true)}>状态黑名单</Button>
        </Space>
      </div>

      {selectedRowKeys.length > 0 && (
        <div style={{ marginBottom: 8, padding: '8px 12px', background: '#e6f7ff', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text>已选 {selectedRowKeys.length} 项</Text>
          <Button size="small" danger onClick={handleBatchDelete}>批量删除</Button>
        </div>
      )}
      <Table size="small" rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys as string[]) }} columns={columns} dataSource={items} rowKey="id" loading={loading}
        locale={{ emptyText: '暂无黑名单规则' }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }} />

      {/* Drag & Drop quick-add — 移到列表下方，避免抢占主视觉 */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file && (file.name.endsWith('.lnk') || file.name.endsWith('.exe'))) {
            const processName = file.name.replace(/\.lnk$/i, '.exe');
            setProcessName(processName);
            setAddMode('manual');
            setModalOpen(true);
            message.info(`已识别进程: ${processName}`);
          } else {
            message.warning('请拖入 .lnk 或 .exe 文件');
          }
        }}
        style={{
          border: `1px dashed ${dragOver ? '#2563EB' : '#d9d9d9'}`,
          borderRadius: 6,
          padding: '8px 12px',
          marginTop: 12,
          textAlign: 'center',
          background: dragOver ? 'rgba(0,212,255,0.06)' : '#fafafa',
          transition: 'all 0.2s',
        }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          📎 拖拽 .lnk / .exe 文件到此处快速添加进程
        </Text>
      </div>

      {/* Add Modal */}
      <Modal title="添加黑名单进程" open={modalOpen} onOk={handleAdd}
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
              <Button
                size="small"
                loading={collecting}
                disabled={!selectedCompanionForAdd}
                style={{ marginBottom: 12 }}
                onClick={async () => {
                  if (!selectedCompanionForAdd) {
                    message.warning('请先选择陪玩');
                    return;
                  }
                  setCollecting(true);
                  setCollectProgress(0);
                  setCollectText('正在发送采集指令...');
                  if (collectTimerRef.current) clearInterval(collectTimerRef.current);
                  try {
                    const { companionsApi } = await import('../../api/companions');
                    await companionsApi.sendCommand(selectedCompanionForAdd, 'collect_processes');
                    let attempts = 0;
                    collectTimerRef.current = setInterval(async () => {
                      attempts += 1;
                      setCollectProgress(Math.min(90, attempts * 8));
                      setCollectText('陪玩端正在采集进程，请稍候...');
                      try {
                        const { data } = await blacklistApi.getUniqueNames(selectedCompanionForAdd!);
                        if (data.data && data.data.length > 0) {
                          setReportedProcesses(data.data);
                          setCollectProgress(100);
                          setCollectText('采集完成');
                          if (collectTimerRef.current) clearInterval(collectTimerRef.current);
                          setCollecting(false);
                          message.success(`采集完成，共 ${data.data.length} 个进程`);
                          return;
                        }
                      } catch {}
                      if (attempts >= 15) {
                        if (collectTimerRef.current) clearInterval(collectTimerRef.current);
                        setCollectProgress(100);
                        setCollectText('采集超时，暂未收到上报');
                        setCollecting(false);
                        message.warning('采集超时，请确认陪玩端在线');
                      }
                    }, 1000);
                  } catch {
                    setCollecting(false);
                    setCollectText('');
                    message.error('采集指令发送失败');
                  }
                }}
              >
                 📡 立即采集该陪玩进程
               </Button>
               {collecting && (
                 <div style={{ marginBottom: 12 }}>
                   <Progress percent={collectProgress} size="small" status={collectProgress >= 100 ? 'success' : 'active'} />
                   <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>{collectText}</Text>
                 </div>
               )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>选择进程</Text>
                <Space size={4}>
                  <Badge count={selectedProcess.length} size="small" showZero color="#2563EB">
                    <Text type="secondary" style={{ fontSize: 12, marginRight: 4 }}>已选</Text>
                  </Badge>
                  <Button size="small" type="link" disabled={!selectableProcesses.length} onClick={selectAllProcesses}>全选</Button>
                  <Button size="small" type="link" disabled={!selectedProcess.length} onClick={clearProcesses}>清空</Button>
                </Space>
              </div>

              {reportedProcesses.length > 0 ? (
                <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 8, padding: '4px 0', background: '#fff' }}>
                  {reportedProcesses.map((name) => {
                    const isAdded = addedNames.has(name.trim().toLowerCase());
                    return (
                      <div
                        key={name}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 12px',
                          borderBottom: '1px solid #f5f5f5',
                          background: isAdded ? '#f6ffed' : undefined,
                          opacity: isAdded ? 0.75 : 1,
                        }}
                      >
                        <Checkbox
                          checked={selectedProcess.includes(name)}
                          disabled={isAdded}
                          onChange={(e) => toggleProcess(name, e.target.checked)}
                        >
                          <Text code={!isAdded} style={{ fontSize: 13 }}>{name}</Text>
                        </Checkbox>
                        {isAdded && <Tag color="green" style={{ margin: 0 }}>已添加</Tag>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#999', fontSize: 12 }}>
                  {selectedCompanionForAdd
                    ? (loadingProcesses ? '加载中...' : '该陪玩暂无进程上报数据，点上方“立即采集”获取')
                    : '请先选择陪玩'}
                </div>
              )}
            </div>
          ) : (
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>进程名称（如 cheatengine.exe）</Text>
              <Input placeholder="输入进程名称" value={processName}
                onChange={(e) => setProcessName(e.target.value)} onPressEnter={handleAdd} />
              <Text type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 4, display: 'block' }}>进程路径（可选）</Text>
              <Input placeholder="输入完整路径，如 C:\Tools\cheatengine.exe" value={processPath}
                onChange={(e) => setProcessPath(e.target.value)} />
            </div>
          )}
        </div>
      </Modal>

      {/* Push Modal */}
      <Modal title="推送黑名单到陪玩终端" open={pushModalOpen}
        onOk={handlePush} onCancel={() => setPushModalOpen(false)}
        confirmLoading={pushing} okText="推送" cancelText="取消">
        <div style={{ marginTop: 16 }}>
          <Tabs activeKey={pushTarget} onChange={(k) => setPushTarget(k as 'all' | 'selected')}
            items={[
              { key: 'all', label: '全工作室推送' },
              { key: 'selected', label: '指定陪玩' },
            ]} />
          {pushTarget === 'selected' && (
            <Select mode="multiple" placeholder="选择陪玩" style={{ width: '100%' }}
              value={selectedCompanions} onChange={setSelectedCompanions}
              options={companions.map((c) => ({ label: c.user?.username || c.id, value: c.id }))}
              showSearch filterOption={(input, option) => (option?.label as string || '').toLowerCase().includes(input.toLowerCase())} />
          )}
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
            推送后，陪玩终端将立即检查并关闭匹配的黑名单进程
          </Text>
        </div>
      </Modal>

      {/* Status Blacklist Config Modal */}
      <StatusBlacklistConfigModal
        visible={statusBlacklistVisible}
        onClose={() => setStatusBlacklistVisible(false)}
      />
    </div>
  );
};

export default BlacklistPage;
