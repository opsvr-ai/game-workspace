import React, { useCallback, useEffect, useState } from 'react';
import {
  Button, Space, Table, Typography, Tag, message, Modal, Form, Input, Switch, Popconfirm,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, PoweroffOutlined, RedoOutlined, MoonOutlined, CloudOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { managedPcApi, ManagedPcItem } from '../../api/managedPc';

const { Text, Title } = Typography;

const ManagedPcPage: React.FC = () => {
  const [items, setItems] = useState<ManagedPcItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedPcItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await managedPcApi.list();
      setItems(data.data ?? []);
    } catch {
      message.error('加载电脑列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
    const timer = setInterval(fetchItems, 30000);
    return () => clearInterval(timer);
  }, [fetchItems]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record: ManagedPcItem) => {
    setEditing(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editing) {
        await managedPcApi.update(editing.id, values);
        message.success('已更新');
      } else {
        await managedPcApi.create(values);
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

  const runAction = async (record: ManagedPcItem, action: 'shutdown' | 'restart' | 'sleep' | 'hibernate') => {
    setActionLoading((prev) => ({ ...prev, [record.id]: true }));
    try {
      await managedPcApi.power(record.id, action);
      message.success('指令已发送');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '执行失败');
    } finally {
      setActionLoading((prev) => ({ ...prev, [record.id]: false }));
      setTimeout(fetchItems, 2000);
    }
  };

  const columns = [
    { title: 'IP 地址', dataIndex: 'ip', key: 'ip', width: 150, render: (v: string) => <Text code>{v}</Text> },
    { title: '登录账号', dataIndex: 'loginAccount', key: 'loginAccount', width: 150 },
    { title: '备注', dataIndex: 'label', key: 'label', render: (v?: string | null) => v || '-' },
    {
      title: '状态',
      key: 'online',
      width: 90,
      render: (_: unknown, r: ManagedPcItem) => <Tag color={r.online ? 'green' : 'default'}>{r.online ? '在线' : '离线'}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 420,
      render: (_: unknown, record: ManagedPcItem) => (
        <Space size="small" wrap>
          <Popconfirm title="确定关机？" onConfirm={() => runAction(record, 'shutdown')}>
            <Button size="small" danger icon={<PoweroffOutlined />} loading={actionLoading[record.id]}>关机</Button>
          </Popconfirm>
          <Popconfirm title="确定重启？" onConfirm={() => runAction(record, 'restart')}>
            <Button size="small" icon={<RedoOutlined />}>重启</Button>
          </Popconfirm>
          <Popconfirm title="确定睡眠？" onConfirm={() => runAction(record, 'sleep')}>
            <Button size="small" icon={<CloudOutlined />}>睡眠</Button>
          </Popconfirm>
          <Popconfirm title="确定休眠？" onConfirm={() => runAction(record, 'hibernate')}>
            <Button size="small" icon={<MoonOutlined />}>休眠</Button>
          </Popconfirm>
          <Button size="small" onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={async () => { await managedPcApi.remove(record.id); fetchItems(); }}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>电脑管理</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchItems} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加电脑</Button>
        </Space>
      </div>
      <Table rowKey="id" columns={columns} dataSource={items} loading={loading} pagination={{ pageSize: 20 }} />

      <Modal
        title={editing ? '编辑电脑' : '添加电脑'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="ip" label="IP 地址" rules={[{ required: true, message: '请输入 IP' }]}>
            <Input placeholder="192.168.0.10" />
          </Form.Item>
          <Form.Item name="loginAccount" label="登录账号" rules={[{ required: true, message: '请输入登录账号' }]}>
            <Input placeholder="例如 chunlvops" />
          </Form.Item>
          <Form.Item name="label" label="备注">
            <Input placeholder="例如 王昊电脑" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ManagedPcPage;
