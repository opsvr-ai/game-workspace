import React, { useState, useEffect, useCallback, createElement } from 'react';
import { Select, Table, Input, Button, Tag, Typography, message, Popconfirm, Space } from 'antd';
import { PlusOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { companionsApi } from '../../api/companions';
import { companionStatusConfig } from '../../constants';

const { Text } = Typography;

const STATUS_OPTIONS = ['AVAILABLE', 'BUSY', 'ENTERTAINMENT', 'RESTING'];

interface StatusBlacklistEntry {
  id: string;
  companionId: string;
  status: string;
  processName: string;
  createdAt: string;
}

const BlacklistPage: React.FC = () => {
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
    } catch {
      /* silent */
    }
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
    fetchCompanions();
  }, [fetchCompanions]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleAdd = async () => {
    const name = newProcessName.trim();
    if (!name) {
      message.warning('请输入进程名称');
      return;
    }
    if (!selectedCompanionId || !selectedStatus) {
      message.warning('请先选择陪玩和状态');
      return;
    }
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
      render: (v: string) => (
        <Text code style={{ fontSize: 13 }}>
          {v}
        </Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: string) => <Tag color={companionStatusConfig[s]?.color}>{companionStatusConfig[s]?.label || s}</Tag>,
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

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 16 }}>
          状态黑名单管理
        </Text>
        <br />
        <Text type="secondary" style={{ fontSize: 12 }}>
          给陪玩在不同状态下配置禁止运行的进程；陪玩切到该状态时，系统会自动关闭匹配进程。
        </Text>
      </div>

      <Space style={{ marginBottom: 12 }} size={12}>
        <Select
          placeholder="选择陪玩"
          style={{ width: 220 }}
          showSearch
          value={selectedCompanionId}
          onChange={(val) => {
            setSelectedCompanionId(val);
            setSelectedStatus(undefined);
          }}
          filterOption={(input, option) =>
            ((option?.label as string) || '').toLowerCase().includes(input.toLowerCase())
          }
          options={companions.map((c: any) => ({ label: c.user?.username || c.id, value: c.id }))}
        />
        <Select
          placeholder="选择状态"
          style={{ width: 160 }}
          value={selectedStatus}
          onChange={setSelectedStatus}
          disabled={!selectedCompanionId}
          options={STATUS_OPTIONS.map((s) => ({
            label: companionStatusConfig[s]?.label || s,
            value: s,
          }))}
        />
        <Button icon={createElement(ReloadOutlined)} onClick={fetchEntries} loading={loading} disabled={!selectedCompanionId || !selectedStatus}>
          刷新
        </Button>
      </Space>

      <Table
        size="small"
        columns={columns}
        dataSource={entries}
        rowKey="id"
        loading={loading}
        locale={{ emptyText: selectedCompanionId && selectedStatus ? '该状态下暂无黑名单' : '请先选择陪玩和状态' }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
        style={{ marginBottom: 12 }}
      />

      <Space.Compact style={{ width: '100%', maxWidth: 520 }}>
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
      </Space.Compact>
    </div>
  );
};

export default BlacklistPage;
