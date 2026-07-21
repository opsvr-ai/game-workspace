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
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { studiosApi } from '../../api/studios';
import http from '../../api/client';

const { Text } = Typography;

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
  address?: string;
  createdAt: string;
  _count?: { users: number; companions: number };
  users?: Array<{ id: string; username: string; role: string; displayName?: string; createdAt: string }>;
}

const StudiosPage: React.FC = () => {
  const [studios, setStudios] = useState<Studio[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStudio, setEditingStudio] = useState<Studio | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  // Pending review
  const [pendingUsers, setPendingUsers] = useState<any[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);

  const fetchPendingUsers = useCallback(async () => {
    setLoadingPending(true);
    try {
      const { data } = await http.get('/users/pending-review');
      setPendingUsers(data.data ?? []);
    } catch { /* non-critical */ }
    finally { setLoadingPending(false); }
  }, []);

  useEffect(() => {
    fetchPendingUsers();
  }, [fetchPendingUsers]);

  const handleApprove = async (userId: string) => {
    try {
      await http.put(`/auth/users/${userId}/authorize`, {});
      message.success('已通过审核');
      fetchPendingUsers();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '操作失败');
    }
  };

  const ROLE_LABELS: Record<string, string> = { COMPANION: '陪玩', CS: '客服', ADMIN: '店长' };

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

  const openEditModal = (record: Studio) => {
    setEditingStudio(record);
    form.setFieldsValue({ name: record.name, type: record.type, splitMode: record.splitMode ?? 'TIERED', address: record.address || '' });
    setModalOpen(true);
  };

  const handleEditSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await studiosApi.update(editingStudio!.id, values.name, values.type, values.splitMode, values.address);
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
            title="确定删除该工作室？此操作不可恢复！"
            onConfirm={async () => {
              try {
                await studiosApi.delete(record.id);
                message.success('工作室已删除');
                fetchStudios();
              } catch (err: any) {
                message.error(err?.response?.data?.message || '删除失败');
              }
            }}
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
        <Button
          icon={React.createElement(ReloadOutlined)}
          onClick={fetchStudios}
          loading={loading}
        >
          刷新
        </Button>
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

      {/* Pending Review Section */}
      {pendingUsers.length > 0 && (
        <Card
          title={<span>📋 待审核申请 <Tag>{pendingUsers.length}</Tag></span>}
          size="small"
          style={{ marginBottom: 16, borderColor: '#faad14' }}
        >
          <Table
            dataSource={pendingUsers}
            rowKey="id"
            loading={loadingPending}
            pagination={false}
            size="small"
            columns={[
              { title: '用户名', dataIndex: 'username', width: 100 },
              { title: '姓名', dataIndex: ['displayName'], width: 80, render: (v: string) => v || '-' },
              { title: '角色', dataIndex: 'role', width: 70, render: (v: string) => <Tag>{ROLE_LABELS[v] || v}</Tag> },
              { title: '工作室', dataIndex: ['studio', 'name'], width: 120, render: (v: string) => v || '-' },
              { title: '地址', dataIndex: 'address', ellipsis: true, render: (v: string) => v || '-' },
              { title: '合同', dataIndex: 'leaseContractUrl', width: 60, render: (v: string) => v ? <a href={v} target="_blank">查看</a> : '-' },
              { title: '申请时间', dataIndex: 'createdAt', width: 140, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
              {
                title: '操作', key: 'actions', width: 80,
                render: (_: unknown, r: any) => (
                  <Button type="primary" size="small" onClick={() => handleApprove(r.id)}>通过</Button>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Table
        columns={columns}
        dataSource={studios}
        rowKey="id"
        loading={loading}
        locale={{ emptyText: '暂无工作室数据' }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
      />

      {/* Edit Modal */}
      <Modal
        title="编辑工作室"
        open={modalOpen}
        onOk={handleEditSubmit}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        destroyOnClose
        width={480}
      >
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
            <Form.Item name="splitMode" label="分账模式">
              <Radio.Group>
                <Radio.Button value="TIERED">阶梯分成</Radio.Button>
                <Radio.Button value="FIXED">固定比例</Radio.Button>
              </Radio.Group>
            </Form.Item>
            <Form.Item name="address" label="工作室地址">
              <Input placeholder="请输入详细地址" />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
};

export default StudiosPage;
