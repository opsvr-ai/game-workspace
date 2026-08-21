import React, { useState, useEffect, useCallback, createElement } from 'react';
import { Table, Input, Button, Tag, Typography, message, Popconfirm, Tabs, Space } from 'antd';
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
  const [entries, setEntries] = useState<StatusBlacklistEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [newProcessName, setNewProcessName] = useState('');
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
  }, [fetchAll]);

  const handleAdd = async (status: string) => {
    const name = newProcessName.trim();
    if (!name) {
      message.warning('请输入进程名称');
      return;
    }
    setSubmitting(true);
    try {
      await companionsApi.addStatusBlacklist({ status, processName: name });
      message.success('已添加');
      setNewProcessName('');
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
          pagination={false}
          style={{ marginBottom: 12 }}
        />
        <Space.Compact style={{ width: '100%', maxWidth: 520 }}>
          <Input
            placeholder="输入进程名称，如 cheatengine.exe"
            value={newProcessName}
            onChange={(e) => setNewProcessName(e.target.value)}
            onPressEnter={() => handleAdd(status)}
          />
          <Button
            type="primary"
            icon={createElement(PlusOutlined)}
            onClick={() => handleAdd(status)}
            loading={submitting}
            disabled={!newProcessName.trim()}
          >
            添加
          </Button>
        </Space.Compact>
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

      <Tabs
        items={STATUS_OPTIONS.map((s) => ({
          key: s,
          label: companionStatusConfig[s]?.label || s,
          children: renderTab(s),
        }))}
        onChange={() => setNewProcessName('')}
      />
    </div>
  );
};

export default BlacklistPage;
