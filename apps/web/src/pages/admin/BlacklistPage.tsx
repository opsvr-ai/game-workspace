import React, { useState, useEffect, useCallback, createElement } from 'react';
import { Select, Table, Input, Button, Tag, Typography, message, Popconfirm, Space } from 'antd';
import { PlusOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { companionsApi } from '../../api/companions';
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
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>();
  const [entries, setEntries] = useState<StatusBlacklistEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [newProcessName, setNewProcessName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchEntries = useCallback(async () => {
    if (!selectedStatus) {
      setEntries([]);
      return;
    }
    setLoading(true);
    try {
      const { data } = await companionsApi.getStatusBlacklist(selectedStatus);
      setEntries(data.data ?? []);
    } catch (err: any) {
      message.error(err?.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [selectedStatus]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleAdd = async () => {
    const name = newProcessName.trim();
    if (!name) {
      message.warning('请输入进程名称');
      return;
    }
    if (!selectedStatus) {
      message.warning('请先选择状态');
      return;
    }
    setSubmitting(true);
    try {
      await companionsApi.addStatusBlacklist({
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
    try {
      await companionsApi.removeStatusBlacklist(entryId);
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
          针对本店所有陪玩，按状态配置禁止运行的进程；陪玩切到该状态时，系统会自动关闭匹配进程。
        </Text>
      </div>

      <Space style={{ marginBottom: 12 }} size={12}>
        <Select
          placeholder="选择状态"
          style={{ width: 180 }}
          value={selectedStatus}
          onChange={setSelectedStatus}
          options={STATUS_OPTIONS.map((s) => ({
            label: companionStatusConfig[s]?.label || s,
            value: s,
          }))}
        />
        <Button icon={createElement(ReloadOutlined)} onClick={fetchEntries} loading={loading} disabled={!selectedStatus}>
          刷新
        </Button>
      </Space>

      <Table
        size="small"
        columns={columns}
        dataSource={entries}
        rowKey="id"
        loading={loading}
        locale={{ emptyText: selectedStatus ? '该状态下暂无黑名单' : '请先选择状态' }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
        style={{ marginBottom: 12 }}
      />

      <Space.Compact style={{ width: '100%', maxWidth: 520 }}>
        <Input
          placeholder="输入进程名称，如 cheatengine.exe"
          value={newProcessName}
          onChange={(e) => setNewProcessName(e.target.value)}
          onPressEnter={handleAdd}
          disabled={!selectedStatus}
        />
        <Button
          type="primary"
          icon={createElement(PlusOutlined)}
          onClick={handleAdd}
          loading={submitting}
          disabled={!selectedStatus || !newProcessName.trim()}
        >
          添加
        </Button>
      </Space.Compact>
    </div>
  );
};

export default BlacklistPage;
