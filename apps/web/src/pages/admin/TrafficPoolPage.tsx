import React, { useEffect, useState, useCallback } from 'react';
import { Card, Tag, Typography, Space, Button, Spin, Row, Col } from 'antd';
import { ReloadOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { customersApi } from '../../api/customers';

const { Text, Title } = Typography;

const PLATFORM_TABS = [
  { key: '', label: '全部' },
  { key: '小红书', label: '小红书' },
  { key: '抖音', label: '抖音' },
  { key: '快手', label: '快手' },
  { key: '转介绍', label: '转介绍' },
];

const platformColor: Record<string, string> = {
  小红书: 'volcano', 抖音: 'blue', 快手: 'orange', 转介绍: 'green',
};

const TrafficPoolPage: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
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
    } catch { /* silent */ } finally { setLoading(false); }
  }, [activePlatform]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const statsText = Object.entries(stats)
    .map(([k, v]) => `${k || '未知'}${v}人`)
    .join(' ｜ ');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>📊 订单池</Title>
          <Text type="secondary">各渠道客户来源统计</Text>
        </div>
        <Button icon={React.createElement(ReloadOutlined)} onClick={fetchData} loading={loading}>刷新</Button>
      </div>

      {/* Channel Stats */}
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', borderRadius: 8, padding: '12px 20px', marginBottom: 16 }}>
        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>📡 渠道统计</Text>
        <div style={{ color: '#fff', fontSize: 16, fontWeight: 600, marginTop: 4 }}>{statsText || '暂无数据'}</div>
      </div>

      {/* Platform Filter Tabs */}
      <Space size="small" style={{ marginBottom: 16 }}>
        {PLATFORM_TABS.map((tab) => (
          <Tag.CheckableTag key={tab.key} checked={activePlatform === tab.key}
            onChange={() => setActivePlatform(tab.key)} style={{ padding: '4px 16px', fontSize: 14 }}>
            {tab.label}
          </Tag.CheckableTag>
        ))}
      </Space>

      {/* Horizontal row cards — same template as pool */}
      {loading ? (
        <Spin size="large" style={{ display: 'block', margin: '40px auto' }} />
      ) : data.length === 0 ? (
        <Card size="small" style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📭</div>
          <Text type="secondary">暂无客户数据</Text>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.map((item: any, idx: number) => (
            <Card key={item.id} size="small" style={{ borderLeft: `3px solid ${platformColor[item.platform] || '#1677ff'}` }}>
              <Row align="middle" gutter={12} wrap={false}>
                <Col>
                  <Tag style={{ background: '#f0f0f0', color: '#666', fontWeight: 700, minWidth: 28, textAlign: 'center', margin: 0 }}>
                    {idx + 1}
                  </Tag>
                </Col>
                <Col>
                  <Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>{item.customerCode}</Text>
                </Col>
                {item.platform && (
                  <Col>
                    <Tag color={platformColor[item.platform] || 'default'} style={{ margin: 0 }}>
                      📡 {item.platform}
                    </Tag>
                  </Col>
                )}
                {item.platformAccount && (
                  <Col>
                    <Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                      🆔 {item.platformAccount}
                    </Text>
                  </Col>
                )}
                <Col flex="auto" />
                <Col>
                  <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                    {React.createElement(ClockCircleOutlined)} {new Date(item.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </Col>
              </Row>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default TrafficPoolPage;
