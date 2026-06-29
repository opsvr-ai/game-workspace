import React, { useEffect, useState, useCallback } from 'react';
import { Table, Tag, Typography, Space, Button, Spin } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { customersApi } from '../../api/customers';

const { Text, Title } = Typography;

const PLATFORM_TABS = [
  { key: '', label: '全部' },
  { key: 'XIAOHONGSHU', label: '小红书' },
  { key: 'DOUYIN', label: '抖音' },
  { key: 'KUAISHOU', label: '快手' },
  { key: 'REFERRAL', label: '转介绍' },
];

const platformLabels: Record<string, string> = {
  XIAOHONGSHU: '小红书',
  DOUYIN: '抖音',
  KUAISHOU: '快手',
  REFERRAL: '转介绍',
  未知: '未知',
};

interface TrafficEntry {
  id: string;
  customerCode: string;
  platform: string;
  platformAccount: string;
  createdAt: string;
}

const TrafficPoolPage: React.FC = () => {
  const [data, setData] = useState<TrafficEntry[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [activePlatform, setActivePlatform] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [poolRes, statsRes] = await Promise.all([
        customersApi.trafficPool(activePlatform || undefined),
        customersApi.trafficStats(),
      ]);
      setData(poolRes.data.data ?? []);
      setStats(statsRes.data.data ?? {});
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [activePlatform]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statsText = Object.entries(stats)
    .map(([k, v]) => `${platformLabels[k] ?? k}${v}人`)
    .join(' ｜ ');

  const columns = [
    {
      title: '客户编号',
      dataIndex: 'customerCode',
      key: 'customerCode',
      width: 140,
    },
    {
      title: '平台',
      dataIndex: 'platform',
      key: 'platform',
      width: 100,
      render: (v: string) => {
        const label = platformLabels[v];
        if (!label) return <Tag>{v || '-'}</Tag>;
        const colorMap: Record<string, string> = {
          小红书: 'volcano',
          抖音: 'blue',
          快手: 'orange',
          转介绍: 'green',
        };
        return <Tag color={colorMap[label] ?? 'default'}>{label}</Tag>;
      },
    },
    {
      title: '平台账号',
      dataIndex: 'platformAccount',
      key: 'platformAccount',
      render: (v: string) => v || <Text type="secondary">-</Text>,
    },
    {
      title: '添加时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>流量池</Title>
          <Text type="secondary">各渠道客户来源统计</Text>
        </div>
        <Button icon={React.createElement(ReloadOutlined)} onClick={fetchData} loading={loading}>刷新</Button>
      </div>

      {/* Channel Stats */}
      <div
        style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: 8,
          padding: '12px 20px',
          marginBottom: 16,
        }}
      >
        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>渠道统计</Text>
        <div style={{ color: '#fff', fontSize: 16, fontWeight: 600, marginTop: 4 }}>
          {statsText || '暂无数据'}
        </div>
      </div>

      {/* Platform Filter Tabs */}
      <Space size="small" style={{ marginBottom: 16 }}>
        {PLATFORM_TABS.map((tab) => (
          <Tag.CheckableTag
            key={tab.key}
            checked={activePlatform === tab.key}
            onChange={() => setActivePlatform(tab.key)}
            style={{ padding: '4px 16px', fontSize: 14 }}
          >
            {tab.label}
          </Tag.CheckableTag>
        ))}
      </Space>

      {/* Table */}
      {loading ? (
        <Spin size="large" style={{ display: 'block', margin: '40px auto' }} />
      ) : (
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          size="small"
          locale={{ emptyText: '暂无客户数据' }}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        />
      )}
    </div>
  );
};

export default TrafficPoolPage;
