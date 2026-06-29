import React, { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Table, Tag, Typography, Spin, Alert } from 'antd';
import { RiseOutlined, TeamOutlined, DollarOutlined } from '@ant-design/icons';
import { dashboardApi } from '../../api/dashboard';
import { useAuthStore } from '../../stores/authStore';
// Chart temporarily disabled for debugging

const { Text, Title } = Typography;

// Use React.createElement to bypass @ant-design/icons + @types/react 18.3.x JSX type conflict
const IconDollar = React.createElement(DollarOutlined);
const IconRise = React.createElement(RiseOutlined);
const IconTeam = React.createElement(TeamOutlined);

const StatCard: React.FC<{
  title: string; value: string | number; icon: React.ReactNode; color: string;
}> = ({ title, value, icon, color }) => (
  <Card size="small" style={{ borderTop: `3px solid ${color}` }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <Text type="secondary" style={{ fontSize: 13 }}>{title}</Text>
        <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
      </div>
      <div style={{ fontSize: 32, color, opacity: 0.3 }}>{icon}</div>
    </div>
  </Card>
);

const DashboardPage: React.FC = () => {
  const user = useAuthStore(s => s.user);
  const [data, setData] = useState<any>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [companions, setCompanions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, trendRes, compRes] = await Promise.all([
        dashboardApi.get(),
        dashboardApi.trend(7),
        dashboardApi.companions(),
      ]);
      setData(dashRes.data.data);
      setTrend(trendRes.data.data ?? []);
      setCompanions(compRes.data.data ?? []);
    } catch (e) {
      console.error('Dashboard fetch error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;

  const today = data?.today ?? {};
  const ranking = data?.ranking ?? [];
  const alerts = data?.alerts ?? [];

  const statusColor: Record<string, string> = {
    ONLINE: 'green', BUSY: 'red', IDLE: 'orange', OFFLINE: 'default',
  };
  const statusLabel: Record<string, string> = {
    ONLINE: '\u{1F7E2}等单中', BUSY: '\u{1F534}接单中', IDLE: '\u{26AA}娱乐中', OFFLINE: '\u{26AB}离线',
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>{'\u{1F4CA} 数据看板'}</Title>
          {user?.username && <Text type="secondary">店长：{user.username}</Text>}
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col span={4}>
          <StatCard title="今日总流水" value={`¥${today.totalRevenue?.toLocaleString() ?? 0}`}
            icon={IconDollar} color="#1677ff" />
        </Col>
        <Col span={4}>
          <StatCard title="今日订单" value={`${today.orderCount ?? 0}单`}
            icon={IconRise} color="#52c41a" />
        </Col>
        <Col span={4}>
          <StatCard title="在线陪玩" value={`${today.onlineCount ?? 0}/${today.totalCount ?? 0}人`}
            icon={IconTeam} color="#722ed1" />
        </Col>
        <Col span={4}>
          <StatCard title="全店接单率" value={`${today.acceptRate ?? 0}%`}
            icon={IconRise} color="#fa8c16" />
        </Col>
        <Col span={4}>
          <StatCard title="娱乐费收入" value={`¥${today.entertainmentFee ?? 0}`}
            icon={IconDollar} color="#eb2f96" />
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={14}>
          <Card title={'\u{1F4C8} 近7天业绩趋势'} size="small">
            <div style={{ padding: '8px 0' }}>
            {trend.length > 0 ? trend.map((t: any) => (
              <Tag key={t.date} style={{ margin: 4 }}>{t.date}: ¥{t.revenue?.toLocaleString()}</Tag>
            )) : <Text type="secondary">暂无数据</Text>}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 16 }}>
              <Text type="secondary">趋势数据显示</Text>
            </div>
          </Card>
        </Col>
        <Col span={10}>
          <Card title={'\u{1F3C6} 陪玩业绩排行'} size="small">
            <Table dataSource={ranking} pagination={false} size="small" rowKey="companionId"
              locale={{ emptyText: '暂无数据' }}>
              <Table.Column title="排名" dataIndex="rank" width={50}
                render={(r: number) => r <= 3 ? ['\u{1F947}', '\u{1F948}', '\u{1F949}'][r - 1] : r} />
              <Table.Column title="陪玩" dataIndex="companionName" />
              <Table.Column title="本月流水" dataIndex="monthlyRevenue"
                render={(v: number) => `¥${v.toLocaleString()}`} />
            </Table>
          </Card>
        </Col>
      </Row>

      <Card title={'\u{1F465} 在线陪玩状态'} size="small" style={{ marginTop: 16 }}>
        <Table dataSource={companions} pagination={false} size="small" rowKey="id"
          locale={{ emptyText: '暂无陪玩' }}>
          <Table.Column title="昵称" dataIndex={['user', 'username']} />
          <Table.Column title="状态" dataIndex="status"
            render={(s: string) => <Tag color={statusColor[s]}>{statusLabel[s] ?? s}</Tag>} />
          <Table.Column title="本月流水" dataIndex="monthlyRevenue"
            render={(v: number) => `¥${(v ?? 0).toLocaleString()}`} />
        </Table>
      </Card>

      {alerts.length > 0 && (
        <Card title={'⚠️ 异常预警'} size="small" style={{ marginTop: 16 }}>
          {alerts.map((a: any, i: number) => (
            <Alert key={i} message={a.message} type="warning" showIcon style={{ marginBottom: 8 }} />
          ))}
        </Card>
      )}
    </div>
  );
};

export default DashboardPage;
