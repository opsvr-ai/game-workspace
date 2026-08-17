import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Tabs, Typography, message } from 'antd';
import { analyticsApi } from '../../api/analytics';
import { useAuthStore } from '../../stores/authStore';

const { Title, Text } = Typography;

const AnalyticsPage: React.FC = () => {
  const [customers, setCustomers] = useState<any[]>([]);
  const [companions, setCompanions] = useState<any[]>([]);
  const [csList, setCsList] = useState<any[]>([]);
  const [admins, setAdmins] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const role = useAuthStore((s) => s.user?.role);

  const load = async () => {
    setLoading(true);
    try {
      const jobs: any[] = [analyticsApi.customers(), analyticsApi.companions()];
      if (role === 'ADMIN' || role === 'OWNER') jobs.push(analyticsApi.cs());
      if (role === 'OWNER') jobs.push(analyticsApi.admins());
      const results = await Promise.all(jobs);
      const [c, p] = results;
      setCustomers(c.data.data || []);
      setCompanions(p.data.data || []);
      if (role === 'ADMIN' || role === 'OWNER') setCsList(results[2]?.data?.data || []);
      if (role === 'OWNER') setAdmins(results[3]?.data?.data || []);
    } catch {
      message.error('加载分析数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [role]);

  const customerColumns = [
    { title: '客户微信', dataIndex: 'wechatId' },
    { title: '所属陪玩', dataIndex: 'companionName' },
    { title: '总消费', dataIndex: 'totalSpent', render: (v: number) => `¥${v}` },
    { title: '订单数', dataIndex: 'orderCount' },
    { title: '平均时长', dataIndex: 'avgDuration', render: (v: number) => `${v}h` },
    { title: '常玩游戏', dataIndex: 'topGame' },
    { title: '常玩模式', dataIndex: 'topMode' },
    { title: '偏好时段', dataIndex: 'preferredTime' },
    {
      title: '标签',
      dataIndex: 'tags',
      render: (tags: string[]) => tags.map((t) => <Tag key={t} color="blue">{t}</Tag>),
    },
    {
      title: '建议',
      dataIndex: 'suggestions',
      render: (arr: string[]) => (arr || []).map((s) => <Text key={s} type="secondary">{s}<br /></Text>),
    },
  ];

  const companionColumns = [
    { title: '陪玩', dataIndex: 'name' },
    { title: '总流水', dataIndex: 'totalRevenue', render: (v: number) => `¥${v}` },
    { title: '完成单量', dataIndex: 'orderCount' },
    { title: '平均时长', dataIndex: 'avgDuration', render: (v: number) => `${v}h` },
    { title: '续单率', dataIndex: 'renewRate', render: (v: number) => `${v}%` },
    { title: '复购率', dataIndex: 'repurchaseRate', render: (v: number) => `${v}%` },
    { title: '常玩游戏', dataIndex: 'topGame' },
    { title: '工作微信数', dataIndex: 'workWechatCount' },
    {
      title: '标签',
      dataIndex: 'tags',
      render: (tags: string[]) => tags.map((t) => <Tag key={t} color="green">{t}</Tag>),
    },
    {
      title: '建议',
      dataIndex: 'suggestions',
      render: (arr: string[]) => (arr || []).map((s) => <Text key={s} type="secondary">{s}<br /></Text>),
    },
  ];

  const csColumns = [
    { title: '客服', dataIndex: 'name' },
    { title: '派单数', dataIndex: 'createdCount' },
    { title: '认领数', dataIndex: 'claimedCount' },
    { title: '完成数', dataIndex: 'completedCount' },
    { title: '完成流水', dataIndex: 'revenue', render: (v: number) => `¥${v}` },
    { title: '标签', dataIndex: 'tags', render: (tags: string[]) => tags.map((t) => <Tag key={t}>{t}</Tag>) },
    { title: '建议', dataIndex: 'suggestions', render: (arr: string[]) => (arr || []).join('；') },
  ];

  const adminColumns = [
    { title: '店长', dataIndex: 'name' },
    { title: '派单数', dataIndex: 'orderCount' },
    { title: '完成流水', dataIndex: 'revenue', render: (v: number) => `¥${v}` },
    { title: '标签', dataIndex: 'tags', render: (tags: string[]) => tags.map((t) => <Tag key={t}>{t}</Tag>) },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>动态分析中心</Title>
      <Text type="secondary">根据系统内订单、客户和陪玩数据自动生成，每 60 秒刷新一次。</Text>
      <Tabs
        style={{ marginTop: 16 }}
        items={[
          ...(role === 'ADMIN' || role === 'OWNER' ? [{
            key: 'cs',
            label: '客服分析',
            children: (
              <Card size="small"><Table rowKey="id" loading={loading} columns={csColumns} dataSource={csList} pagination={{ pageSize: 20 }} /></Card>
            ),
          }] : []),
          ...(role === 'OWNER' ? [{
            key: 'admins',
            label: '店长分析',
            children: (
              <Card size="small"><Table rowKey="id" loading={loading} columns={adminColumns} dataSource={admins} pagination={{ pageSize: 20 }} /></Card>
            ),
          }] : []),
          {
            key: 'customers',
            label: '客户分析',
            children: (
              <Card size="small">
                <Table rowKey="id" loading={loading} columns={customerColumns} dataSource={customers} pagination={{ pageSize: 20 }} />
              </Card>
            ),
          },
          {
            key: 'companions',
            label: '陪玩分析',
            children: (
              <Card size="small">
                <Table rowKey="id" loading={loading} columns={companionColumns} dataSource={companions} pagination={{ pageSize: 20 }} />
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
};

export default AnalyticsPage;
