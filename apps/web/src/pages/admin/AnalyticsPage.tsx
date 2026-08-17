import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Tabs, Typography, message } from 'antd';
import { analyticsApi } from '../../api/analytics';

const { Title, Text } = Typography;

const AnalyticsPage: React.FC = () => {
  const [customers, setCustomers] = useState<any[]>([]);
  const [companions, setCompanions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [c, p] = await Promise.all([analyticsApi.customers(), analyticsApi.companions()]);
      setCustomers(c.data.data || []);
      setCompanions(p.data.data || []);
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
  }, []);

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
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>动态分析中心</Title>
      <Text type="secondary">根据系统内订单、客户和陪玩数据自动生成，每 60 秒刷新一次。</Text>
      <Tabs
        style={{ marginTop: 16 }}
        items={[
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
