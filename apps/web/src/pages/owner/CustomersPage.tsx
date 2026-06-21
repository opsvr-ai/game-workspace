import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Space,
  Typography,
  message,
  Popconfirm,
  Tag,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { customersApi } from '../../api/customers';

const { Text } = Typography;
const { Option } = Select;

interface Customer {
  id: string;
  customerCode: string;
  wechatId: string;
  platform: string;
  platformAccount: string;
  notes: string;
  totalSpent: number;
  companion?: {
    id: string;
    username: string;
  };
}

const platformOptions = [
  { label: '微信', value: 'WECHAT' },
  { label: 'QQ', value: 'QQ' },
  { label: '电话', value: 'PHONE' },
  { label: '其他', value: 'OTHER' },
];

const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await customersApi.list();
      setCustomers(data.data?.items ?? data.data ?? []);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '加载客户列表失败';
      setError(msg);
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const openCreateModal = () => {
    setEditingCustomer(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEditModal = (record: Customer) => {
    setEditingCustomer(record);
    form.setFieldsValue({
      wechatId: record.wechatId,
      platform: record.platform,
      platformAccount: record.platformAccount,
      notes: record.notes,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (editingCustomer) {
        await customersApi.update(editingCustomer.id, values);
        message.success('客户信息已更新');
      } else {
        await customersApi.create(values);
        message.success('客户已创建');
      }
      setModalOpen(false);
      form.resetFields();
      fetchCustomers();
    } catch (err: any) {
      if (err?.errorFields) return; // form validation error
      const msg = err?.response?.data?.message || err?.message || '操作失败';
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await customersApi.delete(id);
      message.success('客户已删除');
      fetchCustomers();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '删除失败';
      message.error(msg);
    }
  };

  const columns = [
    {
      title: '客户编号',
      dataIndex: 'customerCode',
      key: 'customerCode',
      width: 140,
    },
    {
      title: '微信号',
      dataIndex: 'wechatId',
      key: 'wechatId',
    },
    {
      title: '平台',
      dataIndex: 'platform',
      key: 'platform',
      width: 90,
      render: (platform: string) => {
        const found = platformOptions.find((o) => o.value === platform);
        return <Tag>{found?.label ?? platform}</Tag>;
      },
    },
    {
      title: '陪玩',
      dataIndex: ['companion', 'username'],
      key: 'companion',
      render: (name: string) => name ?? <Text type="secondary">未分配</Text>,
    },
    {
      title: '累计消费',
      dataIndex: 'totalSpent',
      key: 'totalSpent',
      width: 120,
      render: (val: number) => (val != null ? `¥${val.toFixed(2)}` : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_: unknown, record: Customer) => (
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
            title="确定删除该客户？"
            onConfirm={() => handleDelete(record.id)}
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
          marginBottom: 16,
        }}
      >
        <Text strong style={{ fontSize: 16 }}>
          客户管理
        </Text>
        <Space>
          <Button
            icon={React.createElement(ReloadOutlined)}
            onClick={fetchCustomers}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={React.createElement(PlusOutlined)}
            onClick={openCreateModal}
          >
            新建客户
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
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <Table
        columns={columns}
        dataSource={customers}
        rowKey="id"
        loading={loading}
        locale={{ emptyText: '暂无客户数据' }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
      />

      <Modal
        title={editingCustomer ? '编辑客户' : '新建客户'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="wechatId"
            label="微信号"
            rules={[{ required: true, message: '请输入微信号' }]}
          >
            <Input placeholder="请输入微信号" />
          </Form.Item>
          <Form.Item
            name="platform"
            label="平台"
            rules={[{ required: true, message: '请选择平台' }]}
          >
            <Select placeholder="请选择平台">
              {platformOptions.map((opt) => (
                <Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="platformAccount" label="平台账号">
            <Input placeholder="请输入平台账号" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="请输入备注信息" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CustomersPage;
