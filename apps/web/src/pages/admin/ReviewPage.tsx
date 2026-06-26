import React, { useState, useEffect, useCallback } from 'react';
import { Table, Tag, Button, Space, Modal, Typography, Image, Input, Popconfirm, message } from 'antd';
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
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await http.get('/companions/pending-review');
      setCompanions(data.data ?? []);
    } catch (err: any) {
      message.error('加载失败');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  const handleReview = async (id: string, action: 'APPROVED' | 'REJECTED') => {
    try {
      await http.put(`/companions/${id}/review`, { action, note: reviewNote });
      message.success(action === 'APPROVED' ? '审核通过' : '已拒绝');
      setReviewNote('');
      fetchPending();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '操作失败');
    }
  };

  const columns = [
    { title: '用户名', dataIndex: ['user', 'username'], width: 120 },
    { title: '真实姓名', dataIndex: 'realName', width: 100 },
    { title: '身份证号', dataIndex: 'idNumber', width: 200 },
    { title: '手机号', dataIndex: 'phone', width: 130 },
    { title: '工作室', dataIndex: ['studio', 'name'], width: 120 },
    {
      title: '身份证', key: 'idcard', width: 120,
      render: (_: unknown, r: PendingCompanion) => (
        <Space>
          {r.idCardFront && <Button size="small" icon={React.createElement(EyeOutlined)} onClick={() => setPreviewImage(`/uploads/idcards/${r.idCardFront}`)}>正面</Button>}
          {r.idCardBack && <Button size="small" icon={React.createElement(EyeOutlined)} onClick={() => setPreviewImage(`/uploads/idcards/${r.idCardBack}`)}>反面</Button>}
        </Space>
      ),
    },
    { title: '注册时间', dataIndex: 'createdAt', width: 160, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
    {
      title: '操作', key: 'actions', width: 200,
      render: (_: unknown, r: PendingCompanion) => (
        <Space>
          <Popconfirm title="确认通过审核？" onConfirm={() => handleReview(r.id, 'APPROVED')} okText="通过" cancelText="取消">
            <Button size="small" type="primary" icon={React.createElement(CheckOutlined)}>通过</Button>
          </Popconfirm>
          <Popconfirm
            title={<TextArea rows={2} placeholder="拒绝原因（可选）" onChange={(e) => setReviewNote(e.target.value)} />}
            onConfirm={() => handleReview(r.id, 'REJECTED')} okText="拒绝" cancelText="取消"
          >
            <Button size="small" danger icon={React.createElement(CloseOutlined)}>拒绝</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text strong style={{ fontSize: 16 }}>实名审核</Text>
        <Button icon={React.createElement(ReloadOutlined)} onClick={fetchPending} loading={loading}>刷新</Button>
      </div>
      <Table columns={columns} dataSource={companions} rowKey="id" loading={loading}
        locale={{ emptyText: '暂无待审核陪玩' }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条待审核` }} />
      <Modal open={!!previewImage} footer={null} onCancel={() => setPreviewImage(null)} width={600}>
        {previewImage && <Image src={previewImage} style={{ width: '100%' }} />}
      </Modal>
    </div>
  );
};

export default ReviewPage;
