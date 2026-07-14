import React, { useState, useEffect, useCallback, createElement } from 'react';
import { Modal, Select, Table, Input, Button, Tag, Typography, message, Popconfirm } from 'antd';
import { PlusOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { companionsApi } from '../api/companions';
import { companionStatusConfig } from '../constants';

const { Text } = Typography;

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface StatusBlacklistEntry {
  id: string;
  companionId: string;
  status: string;
  processName: string;
  createdAt: string;
}

const STATUS_OPTIONS = ['AVAILABLE', 'BUSY', 'ENTERTAINMENT', 'RESTING'];

const StatusBlacklistConfigModal: React.FC<Props> = ({ visible, onClose }) => {
  const [companions, setCompanions] = useState<any[]>([]);
  const [selectedCompanionId, setSelectedCompanionId] = useState<string | undefined>();
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>();
  const [entries, setEntries] = useState<StatusBlacklistEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [newProcessName, setNewProcessName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchCompanions = useCallback(async () => {
    try {
      const { data } = await companionsApi.list();
      setCompanions(data.data ?? []);
    } catch { /* silent */ }
  }, []);

  const fetchEntries = useCallback(async () => {
    if (!selectedCompanionId || !selectedStatus) {
      setEntries([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await companionsApi.getStatusBlacklist(selectedCompanionId, selectedStatus);
      setEntries(data.data ?? []);
    } catch (err: any) {
      message.error(err?.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [selectedCompanionId, selectedStatus]);

  useEffect(() => {
    if (visible) {
      fetchCompanions();
      setSelectedCompanionId(undefined);
      setSelectedStatus(undefined);
      setEntries([]);
      setNewProcessName('');
    }
  }, [visible, fetchCompanions]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleAdd = async () => {
    const name = newProcessName.trim();
    if (!name) { message.warning('请输入进程名称'); return; }
    if (!selectedCompanionId || !selectedStatus) { message.warning('请先选择陪玩和状态'); return; }
    setSubmitting(true);
    try {
      await companionsApi.addStatusBlacklist(selectedCompanionId, {
        status: selectedStatus,
        processName: name,
      });
      message.success('已添加');
      setNewProcessName('');
      fetchEntries();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '添加失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (entryId: string) => {
    if (!selectedCompanionId) return;
    try {
      await companionsApi.removeStatusBlacklist(selectedCompanionId, entryId);
      message.success('已删除');
      fetchEntries();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '删除失败');
    }
  };

  const columns = [
    {
      title: '进程名称',
      dataIndex: 'processName',
      key: 'processName',
      render: (v: string) => <Text code style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: string) => (
        <Tag color={companionStatusConfig[s]?.color}>{companionStatusConfig[s]?.label || s}</Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      render: (_: unknown, record: StatusBlacklistEntry) => (
        <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
          <Button type="link" danger size="small" icon={createElement(DeleteOutlined)}>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <Modal
      title="状态黑名单配置"
      open={visible}
      onCancel={onClose}
      footer={null}
      width={700}
      destroyOnClose
    >
      <div style={{ marginTop: 8 }}>
        <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
          为指定陪玩在特定状态下配置禁止运行的进程列表。当陪玩切换至该状态时，系统将自动检查并关闭匹配的黑名单进程。
        </Text>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>选择陪玩</Text>
            <Select
              placeholder="选择陪玩"
              style={{ width: '100%' }}
              showSearch
              value={selectedCompanionId}
              onChange={(val) => { setSelectedCompanionId(val); setSelectedStatus(undefined); }}
              filterOption={(input, option) => (option?.label as string || '').toLowerCase().includes(input.toLowerCase())}
              options={companions.map((c: any) => ({ label: c.user?.username || c.id, value: c.id }))}
            />
          </div>
          <div style={{ flex: 1 }}>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>选择状态</Text>
            <Select
              placeholder="选择状态"
              style={{ width: '100%' }}
              value={selectedStatus}
              onChange={setSelectedStatus}
              disabled={!selectedCompanionId}
              options={STATUS_OPTIONS.map((s) => ({
                label: companionStatusConfig[s]?.label || s,
                value: s,
              }))}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text strong style={{ fontSize: 14 }}>
            {selectedCompanionId && selectedStatus ? '黑名单进程列表' : '请选择陪玩和状态'}
          </Text>
          <Button
            size="small"
            icon={createElement(ReloadOutlined)}
            onClick={fetchEntries}
            loading={loading}
            disabled={!selectedCompanionId || !selectedStatus}
          >
            刷新
          </Button>
        </div>

        <Table
          size="small"
          columns={columns}
          dataSource={entries}
          rowKey="id"
          loading={loading}
          locale={{ emptyText: selectedCompanionId && selectedStatus ? '暂无黑名单规则' : '请先选择陪玩和状态' }}
          pagination={false}
          style={{ marginBottom: 12 }}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            placeholder="输入进程名称，如 cheatengine.exe"
            value={newProcessName}
            onChange={(e) => setNewProcessName(e.target.value)}
            onPressEnter={handleAdd}
            disabled={!selectedCompanionId || !selectedStatus}
          />
          <Button
            type="primary"
            icon={createElement(PlusOutlined)}
            onClick={handleAdd}
            loading={submitting}
            disabled={!selectedCompanionId || !selectedStatus || !newProcessName.trim()}
          >
            添加
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default StatusBlacklistConfigModal;
