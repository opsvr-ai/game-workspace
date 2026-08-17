// craftsman-ignore: TS001,TS002
import React, { useCallback, useEffect, useState } from 'react';
import {
  Button, Space, Table, Typography, Tag, message, Modal, Form, Input, Select, Popconfirm,
} from 'antd';
import { PlusOutlined, ReloadOutlined, DeleteOutlined, TagsOutlined } from '@ant-design/icons';
import { trafficAccountApi, TrafficAccountItem } from '../../api/trafficAccount';
import { configApi } from '../../api/config';

const { Text, Title } = Typography;
const TYPE_COLORS: Record<string, string> = {
  小红书: 'volcano',
  抖音: 'blue',
  咸鱼: 'gold',
  B站: 'purple',
  视频号: 'green',
};

const TrafficAccountPage: React.FC = () => {
  const [items, setItems] = useState<TrafficAccountItem[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TrafficAccountItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [newType, setNewType] = useState('');
  const [form] = Form.useForm();

  const fetchTypes = useCallback(async () => {
    try {
      const { data } = await configApi.get(['traffic.account_types']);
      const list = data?.data?.['traffic.account_types'];
      setTypes(Array.isArray(list) ? list : []);
    } catch {}
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await trafficAccountApi.list();
      setItems(data.data ?? []);
    } catch {
      message.error('加载引流账号失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTypes();
    fetchItems();
  }, [fetchTypes, fetchItems]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record: TrafficAccountItem) => {
    setEditing(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editing) {
        await trafficAccountApi.update(editing.id, values);
        message.success('已更新');
      } else {
        await trafficAccountApi.create(values);
        message.success('已添加');
      }
      setModalOpen(false);
      fetchItems();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const addType = async () => {
    const t = newType.trim();
    if (!t) return;
    if (types.includes(t)) {
      message.warning('该类型已存在');
      return;
    }
    const updated = [...types, t];
    setTypes(updated);
    await configApi.update({ 'traffic.account_types': updated });
    setNewType('');
    setTypeModalOpen(false);
    message.success('类型已添加');
  };

  const columns = [
    {
      title: '类型', dataIndex: 'type', key: 'type', width: 120,
      render: (v: string) => <Tag color={TYPE_COLORS[v] || 'default'}>{v}</Tag>,
    },
    { title: '昵称', dataIndex: 'nickname', key: 'nickname', width: 160 },
    {
      title: '账号ID/主页', dataIndex: 'accountId', key: 'accountId',
      render: (v?: string | null) => v ? <Text copyable>{v}</Text> : '-',
    },
    {
      title: '所属', key: 'user', width: 120,
      render: (_: unknown, r: TrafficAccountItem) => r.user?.displayName || r.user?.username || '-',
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: string) => <Tag color={v === 'ACTIVE' ? 'green' : 'default'}>{v === 'ACTIVE' ? '在用' : '停用'}</Tag>,
    },
    {
      title: '备注', dataIndex: 'notes', key: 'notes',
      render: (v?: string | null) => v || '-',
    },
    {
      title: '操作', key: 'actions', width: 180,
      render: (_: unknown, r: TrafficAccountItem) => (
        <Space size={4}>
          <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={async () => { await trafficAccountApi.remove(r.id); fetchItems(); }}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>引流账号管理</Title>
          <Text type="secondary">管理小红书、抖音、咸鱼、B站、视频号等引流账号</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchItems} loading={loading}>刷新</Button>
          <Button icon={<TagsOutlined />} onClick={() => setTypeModalOpen(true)}>管理类型</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加账号</Button>
        </Space>
      </div>
      <Table rowKey="id" columns={columns} dataSource={items} loading={loading} pagination={{ pageSize: 20 }} />

      <Modal
        title={editing ? '编辑引流账号' : '添加引流账号'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="type" label="平台类型" rules={[{ required: true, message: '请选择或输入类型' }]}>
            <Select
              placeholder="选择类型"
              options={types.map((t) => ({ value: t, label: t }))}
            />
          </Form.Item>
          <Form.Item name="nickname" label="账号昵称" rules={[{ required: true, message: '请输入昵称' }]}>
            <Input placeholder="例如 小鹿陪玩" />
          </Form.Item>
          <Form.Item name="accountId" label="账号ID / 主页链接">
            <Input placeholder="例如 小红书号 / 抖音号 / 主页链接" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="例如 主号 / 备用号 / 负责机密客户" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="管理平台类型"
        open={typeModalOpen}
        onCancel={() => setTypeModalOpen(false)}
        onOk={addType}
        okText="添加"
        cancelText="关闭"
      >
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {types.map((t) => (
              <Tag key={t} color={TYPE_COLORS[t] || 'default'}>{t}</Tag>
            ))}
          </div>
          <Input
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            onPressEnter={addType}
            placeholder="输入新平台类型，例如 快手"
          />
        </div>
      </Modal>
    </div>
  );
};

export default TrafficAccountPage;
