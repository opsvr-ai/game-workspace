import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Space,
  Typography,
  message,
  Popconfirm,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { studiosApi } from '../../api/studios';

const { Text } = Typography;

interface Studio {
  id: string;
  name: string;
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
    form.resetFields();
    setModalOpen(true);
  };

  const openEditModal = (record: Studio) => {
    setEditingStudio(record);
    form.setFieldsValue({ name: record.name });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (editingStudio) {
        await studiosApi.update(editingStudio.id, values.name);
        message.success('工作室名称已更新');
      } else {
        await studiosApi.create(values.name);
        message.success('工作室已创建');
      }
      setModalOpen(false);
      form.resetFields();
      fetchStudios();
    } catch (err: any) {
      if (err?.errorFields) return;
      const msg = err?.response?.data?.message || err?.message || '操作失败';
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
          marginBottom: 16,
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
            marginBottom: 16,
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

      <Modal
        title={editingStudio ? '编辑工作室' : '新建工作室'}
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
            name="name"
            label="工作室名称"
            rules={[{ required: true, message: '请输入工作室名称' }]}
          >
            <Input placeholder="请输入工作室名称" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default StudiosPage;
