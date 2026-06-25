import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Tag,
  Space,
  Popconfirm,
  Typography,
  message,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  DeleteOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import { employeesApi } from '../../api/employees';
import { studiosApi } from '../../api/studios';
import { useAuthStore } from '../../stores/authStore';
import { UserRole } from '@chunlv/shared';

const { Text } = Typography;
const { Option } = Select;

const roleLabels: Record<string, { label: string; color: string }> = {
  [UserRole.ADMIN]: { label: '管理员', color: 'blue' },
  [UserRole.CS]: { label: '客服', color: 'green' },
  [UserRole.COMPANION]: { label: '陪玩', color: 'orange' },
};

interface Employee {
  id: string;
  username: string;
  role: string;
  studioId: string;
  isAuthorized: boolean;
  createdAt: string;
  companion?: {
    id: string;
    status: string;
    monthlyRevenue: number;
    games: string[];
  } | null;
}

interface Studio {
  id: string;
  name: string;
}

const EmployeesPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [studios, setStudios] = useState<Studio[]>([]);
  const [selectedStudioId, setSelectedStudioId] = useState<string | undefined>(
    user?.studioId ?? undefined,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createForm] = Form.useForm();

  // Reset password modal
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resettingEmployee, setResettingEmployee] = useState<Employee | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetForm] = Form.useForm();

  const fetchStudios = useCallback(async () => {
    try {
      const { data } = await studiosApi.list();
      setStudios(data.data ?? []);
    } catch {
      // non-critical, studio names will fall back to ID
    }
  }, []);

  const fetchEmployees = useCallback(async () => {
    if (!selectedStudioId) {
      setEmployees([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data } = await employeesApi.list(selectedStudioId);
      setEmployees(data.data ?? []);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '加载员工列表失败';
      setError(msg);
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedStudioId]);

  useEffect(() => {
    fetchStudios();
  }, [fetchStudios]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const getStudioName = (studioId: string): string => {
    const found = studios.find((s) => s.id === studioId);
    return found?.name ?? studioId;
  };

  // --- Create employee ---
  const openCreateModal = () => {
    createForm.resetFields();
    createForm.setFieldsValue({
      studioId: selectedStudioId,
    });
    setCreateModalOpen(true);
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setSubmitting(true);
      await employeesApi.create(values);
      message.success('员工已创建');
      setCreateModalOpen(false);
      createForm.resetFields();
      fetchEmployees();
    } catch (err: any) {
      if (err?.errorFields) return;
      const msg = err?.response?.data?.message || err?.message || '创建失败';
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // --- Reset password ---
  const openResetModal = (record: Employee) => {
    setResettingEmployee(record);
    resetForm.resetFields();
    setResetModalOpen(true);
  };

  const handleResetPassword = async () => {
    try {
      const values = await resetForm.validateFields();
      if (!resettingEmployee) return;
      setResetting(true);
      await employeesApi.resetPassword(resettingEmployee.id, values.password);
      message.success(`已重置 ${resettingEmployee.username} 的密码`);
      setResetModalOpen(false);
      resetForm.resetFields();
    } catch (err: any) {
      if (err?.errorFields) return;
      const msg = err?.response?.data?.message || err?.message || '重置密码失败';
      message.error(msg);
    } finally {
      setResetting(false);
    }
  };

  // --- Delete employee ---
  const handleDelete = async (id: string) => {
    try {
      await employeesApi.delete(id);
      message.success('员工已删除');
      fetchEmployees();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '删除失败';
      message.error(msg);
    }
  };

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      width: 140,
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 100,
      render: (role: string) => {
        const cfg = roleLabels[role];
        return <Tag color={cfg?.color}>{cfg?.label ?? role}</Tag>;
      },
    },
    {
      title: '工作室',
      dataIndex: 'studioId',
      key: 'studioId',
      width: 160,
      render: (studioId: string) => getStudioName(studioId),
    },
    {
      title: '状态',
      dataIndex: 'isAuthorized',
      key: 'isAuthorized',
      width: 100,
      render: (isAuthorized: boolean) => (
        <Tag color={isAuthorized ? 'green' : 'default'}>
          {isAuthorized ? '已授权' : '待审核'}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (val: string) =>
        val ? new Date(val).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: Employee) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={React.createElement(KeyOutlined)}
            onClick={() => openResetModal(record)}
          >
            重置密码
          </Button>
          <Popconfirm
            title="确定删除该员工？"
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
          员工管理
        </Text>
        <Space>
          <Select
            placeholder="选择工作室"
            value={selectedStudioId}
            onChange={(val) => setSelectedStudioId(val)}
            style={{ width: 180 }}
            allowClear
            onClear={() => setSelectedStudioId(undefined)}
          >
            {studios.map((s) => (
              <Option key={s.id} value={s.id}>
                {s.name}
              </Option>
            ))}
          </Select>
          <Button
            icon={React.createElement(ReloadOutlined)}
            onClick={fetchEmployees}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={React.createElement(PlusOutlined)}
            onClick={openCreateModal}
            disabled={!selectedStudioId}
          >
            新建员工
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
        dataSource={employees}
        rowKey="id"
        loading={loading}
        locale={{ emptyText: '暂无员工数据' }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 名员工`,
        }}
      />

      {/* Create Employee Modal */}
      <Modal
        title="新建员工"
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={() => {
          setCreateModalOpen(false);
          createForm.resetFields();
        }}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select placeholder="请选择角色">
              <Option value={UserRole.ADMIN}>管理员</Option>
              <Option value={UserRole.CS}>客服</Option>
              <Option value={UserRole.COMPANION}>陪玩</Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="studioId"
            label="工作室"
            rules={[{ required: true, message: '请选择工作室' }]}
          >
            <Select placeholder="请选择工作室">
              {studios.map((s) => (
                <Option key={s.id} value={s.id}>
                  {s.name}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        title={`重置密码 — ${resettingEmployee?.username ?? ''}`}
        open={resetModalOpen}
        onOk={handleResetPassword}
        onCancel={() => {
          setResetModalOpen(false);
          resetForm.resetFields();
        }}
        confirmLoading={resetting}
        okText="确定"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={resetForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少6位' },
            ]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default EmployeesPage;
