import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Space,
  Typography,
  Tag,
  Card,
  Segmented,
  Radio,
  message,
  Popconfirm,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  ShopOutlined,
  GlobalOutlined,
  LeftOutlined,
} from '@ant-design/icons';
import { studiosApi } from '../../api/studios';

const { Text, Title } = Typography;

const STUDIO_TYPE_LABELS: Record<string, string> = {
  DIRECT: '线下工作室',
  RENTAL: '线上俱乐部',
};

const STUDIO_TYPE_COLORS: Record<string, string> = {
  DIRECT: 'blue',
  RENTAL: 'green',
};

interface Studio {
  id: string;
  name: string;
  type: string;
  splitMode?: string;
  createdAt: string;
  _count?: { users: number; companions: number };
}

const StudiosPage: React.FC = () => {
  const [studios, setStudios] = useState<Studio[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStudio, setEditingStudio] = useState<Studio | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createStep, setCreateStep] = useState<'select-type' | 'fill-form'>('select-type');
  const [selectedType, setSelectedType] = useState<string>('DIRECT');
  const [form] = Form.useForm();

  const fetchStudios = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await studiosApi.list();
      setStudios(data.data ?? []);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '加载工作室列表失败';
      setError(msg);
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStudios();
  }, [fetchStudios]);

  const openCreateModal = () => {
    setEditingStudio(null);
    setCreateStep('select-type');
    setSelectedType('DIRECT');
    form.resetFields();
    setModalOpen(true);
  };

  const openEditModal = (record: Studio) => {
    setEditingStudio(record);
    form.setFieldsValue({ name: record.name, type: record.type, splitMode: record.splitMode ?? 'TIERED' });
    setModalOpen(true);
  };

  const handleCreateSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await studiosApi.create(
        values.name,
        selectedType,
        values.managerUsername,
        values.managerPassword,
        values.managerDisplayName,
        values.splitMode,
      );
      message.success('工作室及店长账号已创建');
      setModalOpen(false);
      form.resetFields();
      fetchStudios();
    } catch (err: any) {
      if (err?.errorFields) return;
      const msg = err?.response?.data?.message || err?.message || '创建失败';
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await studiosApi.update(editingStudio!.id, values.name, values.type, values.splitMode);
      message.success('工作室已更新');
      setModalOpen(false);
      form.resetFields();
      fetchStudios();
    } catch (err: any) {
      if (err?.errorFields) return;
      const msg = err?.response?.data?.message || err?.message || '更新失败';
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const staffCount = (record: Studio) => (record._count?.users ?? 0) + (record._count?.companions ?? 0);

  const columns = [
    {
      title: '工作室名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 130,
      render: (val: string) => (
        <Tag color={STUDIO_TYPE_COLORS[val] || 'default'}>
          {STUDIO_TYPE_LABELS[val] || val}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 200,
      render: (val: string) => val ? new Date(val).toLocaleString('zh-CN') : '-',
    },
    {
      title: '员工数',
      key: 'staffCount',
      width: 100,
      render: (_: unknown, record: Studio) => staffCount(record),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_: unknown, record: Studio) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={React.createElement(EditOutlined)}
            onClick={() => openEditModal(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除该工作室？"
            onConfirm={() => message.info('删除功能待实现')}
            okText="确定"
            cancelText="取消"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={React.createElement(DeleteOutlined)}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <Text strong style={{ fontSize: 16 }}>
          工作室管理
        </Text>
        <Space>
          <Button
            icon={React.createElement(ReloadOutlined)}
            onClick={fetchStudios}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={React.createElement(PlusOutlined)}
            onClick={openCreateModal}
          >
            新建工作室
          </Button>
        </Space>
      </div>

      {error && (
        <div
          style={{
            color: '#ff4d4f',
            background: '#fff2f0',
            border: '1px solid #ffccc7',
            borderRadius: 6,
            padding: '8px 12px',
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <Table
        columns={columns}
        dataSource={studios}
        rowKey="id"
        loading={loading}
        locale={{ emptyText: '暂无工作室数据' }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
      />

      {/* Create Modal — two-step */}
      <Modal
        title={editingStudio ? '编辑工作室' : (createStep === 'select-type' ? '新建工作室 — 选择类型' : '新建工作室 — 填写信息')}
        open={modalOpen}
        onOk={editingStudio ? handleEditSubmit : (createStep === 'fill-form' ? handleCreateSubmit : undefined)}
        onCancel={() => {
          if (!editingStudio && createStep === 'fill-form') {
            setCreateStep('select-type');
            form.resetFields();
          } else {
            setModalOpen(false);
            form.resetFields();
          }
        }}
        confirmLoading={submitting}
        okText={editingStudio ? '保存' : (createStep === 'fill-form' ? '创建' : undefined)}
        okButtonProps={(!editingStudio && createStep === 'select-type') ? { style: { display: 'none' } } : undefined}
        cancelText={(!editingStudio && createStep === 'fill-form') ? '上一步' : '取消'}
        destroyOnClose
        width={editingStudio ? 480 : 560}
      >
        {!editingStudio && createStep === 'select-type' && (
          <div style={{ padding: '8px 0' }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 20, textAlign: 'center' }}>
              请选择要创建的工作室类型
            </Text>
            <div style={{ display: 'flex', gap: 20, justifyContent: 'center' }}>
              <Card
                hoverable
                onClick={() => { setSelectedType('DIRECT'); setCreateStep('fill-form'); }}
                style={{
                  width: 200,
                  textAlign: 'center',
                  border: selectedType === 'DIRECT' ? '2px solid #1677ff' : '1px solid #d9d9d9',
                  borderRadius: 12,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 48, marginBottom: 12 }}>
                  {React.createElement(ShopOutlined)}
                </div>
                <Title level={5} style={{ margin: 0 }}>线下工作室</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  实体场地运营，陪玩在门店接单
                </Text>
              </Card>
              <Card
                hoverable
                onClick={() => { setSelectedType('RENTAL'); setCreateStep('fill-form'); }}
                style={{
                  width: 200,
                  textAlign: 'center',
                  border: selectedType === 'RENTAL' ? '2px solid #1677ff' : '1px solid #d9d9d9',
                  borderRadius: 12,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 48, marginBottom: 12 }}>
                  {React.createElement(GlobalOutlined)}
                </div>
                <Title level={5} style={{ margin: 0 }}>线上俱乐部</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  纯线上运营，陪玩远程在家接单
                </Text>
              </Card>
            </div>
          </div>
        )}

        {(!editingStudio && createStep === 'fill-form') && (
          <div style={{ padding: '8px 0' }}>
            <div style={{
              background: '#f6f8fa',
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <span style={{ fontSize: 20, color: STUDIO_TYPE_COLORS[selectedType] }}>
                {React.createElement(selectedType === 'DIRECT' ? ShopOutlined : GlobalOutlined)}
              </span>
              <div>
                <Text strong>{STUDIO_TYPE_LABELS[selectedType]}</Text>
                <Button
                  type="link"
                  size="small"
                  icon={React.createElement(LeftOutlined)}
                  onClick={() => { setCreateStep('select-type'); form.resetFields(); }}
                  style={{ marginLeft: 8, padding: 0 }}
                >
                  重新选择
                </Button>
              </div>
            </div>
            <Form form={form} layout="vertical">
              <Form.Item
                name="name"
                label="工作室名称"
                rules={[{ required: true, message: '请输入工作室名称' }]}
              >
                <Input placeholder="请输入工作室名称" autoFocus />
              </Form.Item>
              <Form.Item
                name="splitMode"
                label="分账模式"
                initialValue="TIERED"
              >
                <Radio.Group>
                  <Radio.Button value="TIERED">阶梯分成</Radio.Button>
                  <Radio.Button value="FIXED">固定比例</Radio.Button>
                </Radio.Group>
              </Form.Item>
              <div style={{
                borderTop: '1px solid #f0f0f0',
                paddingTop: 16,
                marginTop: 4,
                marginBottom: 8,
              }}>
                <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>
                  👤 店长信息设置
                </Text>
                <Form.Item
                  name="managerDisplayName"
                  label="店长名字"
                  rules={[{ required: false }]}
                >
                  <Input placeholder="店长显示名字（选填）" />
                </Form.Item>
                <Form.Item
                  name="managerUsername"
                  label="登录账号"
                  rules={[{ required: true, message: '请输入店长登录账号' }]}
                >
                  <Input placeholder="店长登录账号" />
                </Form.Item>
                <Form.Item
                  name="managerPassword"
                  label="登录密码"
                  rules={[
                    { required: true, message: '请输入店长密码' },
                    { min: 6, message: '密码至少6位' },
                  ]}
                >
                  <Input.Password placeholder="店长登录密码（至少6位）" />
                </Form.Item>
              </div>
            </Form>
          </div>
        )}

        {editingStudio && (
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              name="name"
              label="工作室名称"
              rules={[{ required: true, message: '请输入工作室名称' }]}
            >
              <Input placeholder="请输入工作室名称" />
            </Form.Item>
            <Form.Item
              name="type"
              label="工作室类型"
              rules={[{ required: true, message: '请选择工作室类型' }]}
            >
              <Segmented
                options={[
                  { label: '🏢 线下工作室', value: 'DIRECT' },
                  { label: '🌐 线上俱乐部', value: 'RENTAL' },
                ]}
                block
              />
            </Form.Item>
            <Form.Item
              name="splitMode"
              label="分账模式"
            >
              <Radio.Group>
                <Radio.Button value="TIERED">阶梯分成</Radio.Button>
                <Radio.Button value="FIXED">固定比例</Radio.Button>
              </Radio.Group>
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
};

export default StudiosPage;
