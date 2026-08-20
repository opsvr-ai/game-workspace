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
import { useAuthStore } from '../../stores/authStore';

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
  displayName?: string;
  logoUrl?: string;
  createdAt: string;
  _count?: { users: number; companions: number };
  users?: Array<{ id: string; username: string; role: string; displayName?: string; realName?: string; phone?: string; idNumber?: string; createdAt: string }>;
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
  const [onlineClubs, setOnlineClubs] = useState<any[]>([]);
  const [clubName, setClubName] = useState('');
  const [addingClub, setAddingClub] = useState(false);

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

  const [rejectModal, setRejectModal] = useState<{ userId: string; username: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [detailUser, setDetailUser] = useState<any>(null);

  const handleApprove = async (userId: string) => {
    try {
      await http.put(`/auth/users/${userId}/authorize`, {});
      message.success('已通过审核');
      setPendingUsers((prev: any[]) => prev.filter((u: any) => u.id !== userId));
      setTimeout(() => { fetchPendingUsers(); fetchStudios(); }, 1000);
      useAuthStore.getState().fetchUser(); // refresh sidebar badge
    } catch (err: any) {
      message.error(err?.response?.data?.message || '操作失败');
    }
  };

  const handleReject = async () => {
    if (!rejectModal) return;
    setSubmitting(true);
    try {
      await http.put(`/auth/users/${rejectModal.userId}/reject`, { reason: rejectReason || '未填写原因' });
      message.success('已拒绝');
      setRejectModal(null);
      setRejectReason('');
      // Force immediate refetch — don't rely on local filter
      fetchPendingUsers();
      fetchStudios();
    } catch (err: any) {
      Modal.error({ title: '拒绝失败', content: err?.response?.data?.message || err?.message || '操作失败' });
    } finally {
      setSubmitting(false);
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
    // Refresh sidebar badge on page load
    useAuthStore.getState().fetchUser();
  }, [fetchStudios]);

  const fetchOnlineClubs = useCallback(async () => {
    try {
      const { data } = await studiosApi.listOnlineClubs();
      setOnlineClubs(data?.data ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchOnlineClubs();
  }, [fetchOnlineClubs]);

  const addOnlineClub = async () => {
    if (!clubName.trim()) {
      message.warning('请输入线上俱乐部名称');
      return;
    }
    setAddingClub(true);
    try {
      await studiosApi.createOnlineClub(clubName.trim());
      message.success('线上俱乐部已添加并自动桥接');
      setClubName('');
      fetchOnlineClubs();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '添加失败');
    } finally {
      setAddingClub(false);
    }
  };

  const openEditModal = (record: Studio) => {
    setEditingStudio(record);
    form.setFieldsValue({ name: record.name, type: record.type, splitMode: record.splitMode ?? 'TIERED', address: record.address || '', displayName: record.displayName || '', logoUrl: record.logoUrl || '' });
    setModalOpen(true);
  };

  const handleEditSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await studiosApi.update(editingStudio!.id, values.name, values.type, values.splitMode, values.address, values.displayName, values.logoUrl);
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

  return (
    <div>
      <div style={{ marginBottom: 16, padding: 12, background: '#fff', borderRadius: 10, border: '1px solid #E2E8F0' }}>
        <Text strong style={{ fontSize: 14 }}>🌐 线上俱乐部桥接</Text>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Input
            placeholder="线上俱乐部名称（自动创建并桥接为最后一级兜底）"
            value={clubName}
            onChange={(e) => setClubName(e.target.value)}
            onPressEnter={addOnlineClub}
            style={{ maxWidth: 360 }}
          />
          <Button type="primary" loading={addingClub} onClick={addOnlineClub}>添加线上俱乐部</Button>
        </div>
        {onlineClubs.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>已桥接：</Text>
            <Space size={6} wrap style={{ marginTop: 4 }}>
              {onlineClubs.map((c) => (
                <Tag key={c.id} color="green">{c.displayName || c.name}</Tag>
              ))}
            </Space>
          </div>
        )}
      </div>
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

      {/* Single unified table: pending applications + approved studios */}
      <Table
        dataSource={[
          ...pendingUsers.map((u: any) => ({ ...u, _type: 'pending' })),
          // Filter: don't show studios that have pending users (avoid duplicate)
          ...studios.filter((s) => !pendingUsers.some((u: any) => u.studio?.id === s.id)).map((s) => ({ ...s, _type: 'studio' })),
        ]}
        rowKey={(r: any) => r._type === 'pending' ? `p-${r.id}` : r.id}
        loading={loading || loadingPending}
        locale={{ emptyText: '暂无工作室数据' }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        columns={[
          {
            title: '状态',
            key: 'status',
            width: 80,
            render: (_: unknown, r: any) => r._type === 'pending'
              ? <Tag color="orange">待审核</Tag>
              : <Tag color="green">已通过</Tag>,
          },
          {
            title: '工作室名称',
            key: 'name',
            width: 140,
            render: (_: unknown, r: any) => r._type === 'pending' ? (
              <a onClick={() => setDetailUser(r)} style={{ cursor: 'pointer' }}>
                {r.studio?.name || '-'}
              </a>
            ) : r.name,
          },
          {
            title: '类型',
            key: 'type',
            width: 100,
            render: (_: unknown, r: any) => r._type === 'pending'
              ? <Tag>{ROLE_LABELS[r.role] || r.role}</Tag>
              : <Tag color={STUDIO_TYPE_COLORS[r.type] || 'default'}>{STUDIO_TYPE_LABELS[r.type] || r.type}</Tag>,
          },
          {
            title: '员工数',
            key: 'staff',
            width: 80,
            render: (_: unknown, r: any) => r._type === 'studio' ? ((r._count?.users ?? 0) + (r._count?.companions ?? 0)) : 1,
          },
          {
            title: '店长',
            key: 'manager',
            width: 90,
            render: (_: unknown, r: any) => {
              if (r._type === 'pending') return ROLE_LABELS[r.role] || r.role;
              const admin = (r.users || []).find((u: any) => u.role === 'ADMIN');
              return admin?.realName || admin?.displayName || admin?.username || '-';
            },
          },
          {
            title: '手机号',
            key: 'phone',
            width: 120,
            render: (_: unknown, r: any) => {
              if (r._type === 'pending') return r.phone || '-';
              const admin = (r.users || []).find((u: any) => u.role === 'ADMIN');
              return admin?.phone || '-';
            },
          },
          {
            title: '身份证号',
            key: 'idNumber',
            width: 180,
            render: (_: unknown, r: any) => {
              if (r._type === 'pending') return r.idNumber || r.companion?.idNumber || '-';
              const admin = (r.users || []).find((u: any) => u.role === 'ADMIN');
              return admin?.idNumber || '-';
            },
          },
          {
            title: '地址',
            dataIndex: 'address',
            width: 120,
            ellipsis: true,
            render: (v: string) => v || '-',
          },
          {
            title: '创建时间',
            key: 'createdAt',
            width: 130,
            render: (_: unknown, r: any) => r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : '-',
          },
          {
            title: '操作',
            key: 'actions',
            width: 140,
            render: (_: unknown, r: any) => r._type === 'pending' ? (
              <Space size={4}>
                <Button type="primary" size="small" onClick={() => handleApprove(r.id)}>通过</Button>
                <Button size="small" danger onClick={() => { setRejectModal({ userId: r.id, username: r.username }); setRejectReason(''); }}>拒绝</Button>
              </Space>
            ) : (
              <Space size="small">
                <Button type="link" size="small" icon={React.createElement(EditOutlined)} onClick={() => openEditModal(r)}>编辑</Button>
                <Popconfirm title="确定删除该工作室？此操作不可恢复！" onConfirm={async () => { try { await studiosApi.delete(r.id); message.success('工作室已删除'); fetchStudios(); } catch (err: any) { message.error(err?.response?.data?.message || '删除失败'); } }} okText="确定" cancelText="取消">
                  <Button type="link" size="small" danger icon={React.createElement(DeleteOutlined)}>删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
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
          <Form form={form} key={editingStudio.id} layout="vertical" style={{ marginTop: 16 }}>
            {/* Members info (read-only) */}
            {editingStudio.users && editingStudio.users.length > 0 && editingStudio.users.map((u: any) => (
              <div key={u.id} style={{ background: '#f6f8fa', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                <Text strong style={{ fontSize: 13 }}>👤 申请人信息</Text>
                <div style={{ marginTop: 8, lineHeight: 2 }}>
                  <div><Text type="secondary">角色：</Text><Tag>{u.role === 'ADMIN' ? '店长' : u.role === 'CS' ? '客服' : '陪玩'}</Tag></div>
                  <div><Text type="secondary">用户名：</Text>{u.username}</div>
                  <div><Text type="secondary">姓名：</Text>{u.displayName || u.realName || '-'}</div>
                  <div><Text type="secondary">手机号：</Text>{u.phone || '-'}</div>
                  <div><Text type="secondary">身份证号：</Text>{u.idNumber || '-'}</div>
                  {u.address && <div><Text type="secondary">地址：</Text>{u.address}</div>}
                  {u.leaseContractUrl && <div><Text type="secondary">合同：</Text><a href={u.leaseContractUrl} target="_blank">查看</a></div>}
                  <div><Text type="secondary">注册时间：</Text>{u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN') : '-'}</div>
                </div>
              </div>
            ))}
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
            <Form.Item name="displayName" label="品牌名称（对外展示）">
              <Input placeholder="如：光耀电竞" />
            </Form.Item>
            <Form.Item name="logoUrl" label="Logo 图片链接">
              <Input placeholder="如：/uploads/logo.png" />
            </Form.Item>
            <Form.Item name="address" label="工作室地址">
              <Input placeholder="请输入详细地址" />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* Detail Modal — show full registration info */}
      <Modal
        title="申请详情"
        open={!!detailUser}
        onCancel={() => setDetailUser(null)}
        footer={<Button onClick={() => setDetailUser(null)}>关闭</Button>}
        width={480}
      >
        {detailUser && (
          <div style={{ lineHeight: 2.2 }}>
            <p><Text strong>用户名：</Text>{detailUser.username}</p>
            <p><Text strong>角色：</Text><Tag>{ROLE_LABELS[detailUser.role] || detailUser.role}</Tag></p>
            <p><Text strong>姓名：</Text>{detailUser.displayName || detailUser.realName || detailUser.companion?.realName || '-'}</p>
            <p><Text strong>手机号：</Text>{detailUser.phone || detailUser.companion?.phone || '-'}</p>
            <p><Text strong>身份证号：</Text>{detailUser.idNumber || detailUser.companion?.idNumber || '-'}</p>
            <p><Text strong>工作室：</Text>{detailUser.studio?.name || '-'}</p>
            <p><Text strong>地址：</Text>{detailUser.address || '-'}</p>
            <p><Text strong>申请时间：</Text>{detailUser.createdAt ? new Date(detailUser.createdAt).toLocaleString('zh-CN') : '-'}</p>
            {detailUser.leaseContractUrl && (
              <p><Text strong>租赁合同：</Text><a href={detailUser.leaseContractUrl} target="_blank">查看合同照片</a></p>
            )}
          </div>
        )}
      </Modal>

      {/* Reject Modal */}
      <Modal
        title={`拒绝申请 — ${rejectModal?.username || ''}`}
        open={!!rejectModal}
        onOk={handleReject}
        onCancel={() => setRejectModal(null)}
        okText="确认拒绝"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <div style={{ marginTop: 16 }}>
          <Text type="secondary" style={{ marginBottom: 8, display: 'block' }}>拒绝原因：</Text>
          <Input.TextArea
            rows={3}
            placeholder="填写拒绝原因..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
};

export default StudiosPage;
