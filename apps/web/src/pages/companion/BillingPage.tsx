import React, { useState, useEffect, useCallback } from 'react';
import { Table, Tag, Typography, Button, Space, message, Statistic, Row, Col, Card } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import http from '../../api/client';
import { useAuthStore } from '../../stores/authStore';

const { Text } = Typography;

const BillingPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  const fetchTransactions = useCallback(async () => {
    if (!user?.companionId) return;
    setLoading(true);
    try {
      const { data } = await http.get(`/companions/${user.companionId}/revenue`);
      setTransactions(data.data?.transactions ?? []);
      setTotal(data.data?.total ?? 0);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, [user?.companionId]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div><Text strong style={{ fontSize: 16 }}>报账系统</Text><br /><Text type="secondary">查看已提交的报账记录和审核状态</Text></div>
        <Button icon={React.createElement(ReloadOutlined)} onClick={fetchTransactions} loading={loading}>刷新</Button>
      </div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}><Card size="small"><Statistic title="报账总数" value={transactions.length} valueStyle={{ color: '#007AFF' }} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="已通过" value={transactions.filter((t: any) => t.status === 'APPROVED').length} valueStyle={{ color: '#34C759' }} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="总收入" value={`¥${total.toFixed(2)}`} valueStyle={{ color: '#FF4757' }} /></Card></Col>
      </Row>
      <Table size="small" dataSource={transactions} rowKey="id" loading={loading}
        columns={[
          { title: '订单号', dataIndex: ['order', 'id'], width: 100, render: (v: string) => v?.slice(0, 8) },
          { title: '金额', dataIndex: 'amount', width: 100, render: (v: number) => <span style={{ color: '#FF4757', fontWeight: 600 }}>¥{v?.toFixed(2)}</span> },
          { title: '支付方式', dataIndex: 'paymentMethod', width: 100 },
          { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => <Tag color={s === 'APPROVED' ? 'green' : s === 'REJECTED' ? 'red' : 'gold'}>{s === 'APPROVED' ? '已通过' : s === 'REJECTED' ? '已拒绝' : '待审核'}</Tag> },
          { title: '提交时间', dataIndex: 'createdAt', render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
        ]}
      />
    </div>
  );
};

export default BillingPage;
