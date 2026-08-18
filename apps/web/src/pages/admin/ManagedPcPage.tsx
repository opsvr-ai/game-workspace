import React, { useCallback, useEffect, useState } from 'react';
import {
  Button, Space, Table, Typography, Tag, message, Modal, Form, Input, Switch, Popconfirm,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, PoweroffOutlined, RedoOutlined, MoonOutlined, CloudOutlined, DeleteOutlined, ThunderboltOutlined,
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
  const [labelEditing, setLabelEditing] = useState<Record<string, string>>({});
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);

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

  const runAction = async (record: ManagedPcItem, action: 'wake' | 'shutdown' | 'restart' | 'sleep' | 'hibernate') => {
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

  const runBatchAction = async (action: 'wake' | 'shutdown' | 'restart' | 'sleep' | 'hibernate') => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先勾选电脑');
      return;
    }
    setBatchLoading(true);
    try {
      const { data } = await managedPcApi.powerBatch(selectedRowKeys, action);
      const ok = data?.data?.success ?? 0;
      const total = data?.data?.total ?? selectedRowKeys.length;
      message.success(`批量${actionLabel(action)}完成：${ok}/${total} 台成功`);
      setSelectedRowKeys([]);
      setTimeout(fetchItems, 2000);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '批量执行失败');
    } finally {
      setBatchLoading(false);
    }
  };

  const actionLabel = (action: string) =>
    ({ wake: '开机', shutdown: '关机', restart: '重启', sleep: '睡眠', hibernate: '休眠' } as Record<string, string>)[action] || action;

  const columns = [
    { title: 'IP 地址', dataIndex: 'ip', key: 'ip', width: 150, render: (v: string) => <Text code>{v}</Text> },
    { title: '登录账号', dataIndex: 'loginAccount', key: 'loginAccount', width: 150 },
    {
      title: 'MAC 地址',
      dataIndex: 'macAddress',
      key: 'macAddress',
      width: 170,
      render: (v?: string | null) => v ? <Text code>{v}</Text> : <Text type="secondary">未填写</Text>,
    },
    {
      title: '备注',
      key: 'label',
      width: 200,
      render: (_: unknown, r: ManagedPcItem) => (
        <Input
          size="small"
          placeholder="输入备注"
          value={labelEditing[r.id] ?? r.label ?? ''}
          onChange={(e) => setLabelEditing((prev) => ({ ...prev, [r.id]: e.target.value }))}
          onBlur={() => {
            const v = labelEditing[r.id];
            if (v !== undefined && v !== r.label) {
              managedPcApi.update(r.id, { label: v }).then(() => fetchItems()).catch(() => {});
            }
          }}
          onPressEnter={(e: any) => e.target.blur()}
        />
      ),
    },
    {
      title: '状态',
      key: 'online',
      width: 90,
      render: (_: unknown, r: ManagedPcItem) => {
        let label = '离线';
        let color = 'default';
        if (r.online) {
          label = '在线';
          color = 'green';
        } else if (r.lastActionAt && Date.now() - new Date(r.lastActionAt).getTime() < 5 * 60 * 1000) {
          // 只在最近 5 分钟内确实执行过电源操作时，才显示“已关机/睡眠/休眠”，避免旧记录一直误显示
          if (r.lastAction === 'shutdown') {
            label = '已关机';
            color = 'red';
          } else if (r.lastAction === 'sleep') {
            label = '睡眠中';
            color = 'blue';
          } else if (r.lastAction === 'hibernate') {
            label = '休眠中';
            color = 'purple';
          }
        }
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 520,
      render: (_: unknown, record: ManagedPcItem) => (
        <Space size={4} wrap={false} style={{ whiteSpace: 'nowrap' }}>
          <Popconfirm title="确定远程开机？" onConfirm={() => runAction(record, 'wake')}>
            <Button size="small" type="primary" icon={<ThunderboltOutlined />}>开机</Button>
          </Popconfirm>
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
          <Popconfirm title="确定删除？" onConfirm={async () => { await managedPcApi.remove(record.id); fetchItems(); }}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
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
          <Button
            icon={<ThunderboltOutlined />}
            onClick={async () => {
              try {
                const { data } = await managedPcApi.syncMac();
                message.success(`MAC 已同步（${data?.data?.updated ?? 0} 台已更新）`);
                fetchItems();
              } catch {
                message.error('同步 MAC 失败');
              }
            }}
          >
            同步MAC
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加电脑</Button>
        </Space>
      </div>
      {selectedRowKeys.length > 0 && (
        <div style={{ marginBottom: 8, padding: '8px 12px', background: '#e6f7ff', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text>已选 {selectedRowKeys.length} 台</Text>
          <Space size={4} wrap>
            <Button size="small" type="primary" icon={<ThunderboltOutlined />} loading={batchLoading} onClick={() => runBatchAction('wake')}>批量开机</Button>
            <Button size="small" danger icon={<PoweroffOutlined />} onClick={() => runBatchAction('shutdown')}>批量关机</Button>
            <Button size="small" icon={<RedoOutlined />} onClick={() => runBatchAction('restart')}>批量重启</Button>
            <Button size="small" icon={<CloudOutlined />} onClick={() => runBatchAction('sleep')}>批量睡眠</Button>
            <Button size="small" icon={<MoonOutlined />} onClick={() => runBatchAction('hibernate')}>批量休眠</Button>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
          </Space>
        </div>
      )}
      <Table
        rowKey="id"
        rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys as string[]) }}
        columns={columns}
        dataSource={items}
        loading={loading}
        pagination={{ pageSize: 20 }}
      />

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
          <Form.Item name="macAddress" label="MAC 地址">
            <Input placeholder="例如 50:eb:f6:ee:0d:7f（用于远程开机，在线会自动填）" />
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
