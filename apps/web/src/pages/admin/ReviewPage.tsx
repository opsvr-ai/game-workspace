import React, { useState, useEffect, useCallback } from 'react';
import { Table, Button, Space, Modal, Typography, Image, Input, Popconfirm, message, Tag } from 'antd';
import { ReloadOutlined, CheckOutlined, CloseOutlined, EyeOutlined } from '@ant-design/icons';
import http from '../../api/client';

const { Text } = Typography;
const { TextArea } = Input;

interface PendingCompanion {
  id: string;
  realName: string;
  idNumber: string;
  phone: string;
  idCardFront: string | null;
  idCardBack: string | null;
  reviewStatus: string;
  reviewNote: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  createdAt: string;
  user: { username: string };
  studio: { id: string; name: string };
}

const ReviewPage: React.FC = () => {
  const [companions, setCompanions] = useState<PendingCompanion[]>([]);
  const [loading, setLoading] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<any>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await http.get('/users/pending-review');
      setCompanions(data.data ?? []);
    } catch (err: any) {
      message.error('加载失败');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  const handleReview = async (user: any, action: 'APPROVED' | 'REJECTED') => {
    try {
      if (action === 'APPROVED') {
        await http.put(`/auth/users/${user.id}/authorize`);
      } else {
        await http.put(`/auth/users/${user.id}/reject`, { reason: reviewNote || '未填写原因' });
      }
      message.success(action === 'APPROVED' ? '审核通过' : '已拒绝');
      setReviewNote('');
      fetchPending();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '操作失败');
    }
  };

  const ROLE_MAP: Record<string, string> = { COMPANION: '陪玩', CS: '客服', ADMIN: '店长' };
  const columns = [
    { title: '用户名', dataIndex: 'username', width: 120 },
    { title: '角色', key: 'role', width: 80, render: (_: unknown, r: any) => <Tag>{ROLE_MAP[r.role] || r.role}</Tag> },
    { title: '真实姓名', dataIndex: 'realName', width: 100, render: (v: string, r: any) => v || r.companion?.realName || '-' },
    { title: '身份证号', dataIndex: 'idNumber', width: 200, render: (v: string, r: any) => v || r.companion?.idNumber || '-' },
    { title: '手机号', dataIndex: 'phone', width: 130, render: (v: string, r: any) => v || r.companion?.phone || '-' },
    { title: '工作室', key: 'studio', width: 120, render: (_: unknown, r: any) => r.studio?.name || '-' },
    {
      title: '身份证', key: 'idcard', width: 120,
      render: (_: unknown, r: any) => (
        <Space>
          {r.companion?.idCardFront && <Button size="small" icon={React.createElement(EyeOutlined)} onClick={() => setPreviewImage(`/uploads/idcards/${r.companion.idCardFront}`)}>正面</Button>}
          {r.companion?.idCardBack && <Button size="small" icon={React.createElement(EyeOutlined)} onClick={() => setPreviewImage(`/uploads/idcards/${r.companion.idCardBack}`)}>反面</Button>}
        </Space>
      ),
    },
    { title: '注册时间', dataIndex: 'createdAt', width: 160, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
    {
      title: '操作', key: 'actions', width: 200,
      render: (_: unknown, r: any) => (
        <Space>
          <Popconfirm title="确认通过审核？" onConfirm={() => handleReview(r, 'APPROVED')} okText="通过" cancelText="取消">
            <Button size="small" type="primary" icon={React.createElement(CheckOutlined)}>通过</Button>
          </Popconfirm>
          <Button size="small" danger icon={React.createElement(CloseOutlined)}
            onClick={() => { setRejectTarget(r); setRejectModalOpen(true); }}>拒绝</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text strong style={{ fontSize: 16 }}>实名审核</Text>
        <Button icon={React.createElement(ReloadOutlined)} onClick={fetchPending} loading={loading}>刷新</Button>
      </div>
      <Table size="small" columns={columns} dataSource={companions} rowKey="id" loading={loading}
        locale={{ emptyText: '暂无待审核申请' }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条待审核` }} />
      <Modal open={!!previewImage} footer={null} onCancel={() => setPreviewImage(null)} width={600}>
        {previewImage && <Image src={previewImage} style={{ width: '100%' }} />}
      </Modal>
          <Modal title="拒绝审核" open={rejectModalOpen} onOk={() => { if (rejectTarget) { handleReview(rejectTarget, 'REJECTED'); setRejectModalOpen(false); setRejectTarget(null); } }} onCancel={() => { setRejectModalOpen(false); setRejectTarget(null); }} okText="确认拒绝" cancelText="取消">
        <div style={{ marginTop: 16 }}>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 8, display: 'block' }}>拒绝原因（可选）</Text>
          <TextArea rows={3} placeholder="输入拒绝原因" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
        </div>
      </Modal>

    </div>
  );
};

export default ReviewPage;
