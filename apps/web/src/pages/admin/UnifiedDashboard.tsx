import React, { useState, useEffect } from 'react';
import { Tabs, Card, Row, Col, Statistic, Spin, Typography, Modal } from 'antd';
import { BarChartOutlined, TrophyOutlined, DollarOutlined } from '@ant-design/icons';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, ReferenceLine } from 'recharts';
import PerformancePage from './PerformancePage';
import AdminRevenuePage from './RevenuePage';
import { dashboardApi } from '../../api/dashboard';

const { Text } = Typography;
const COLORS = ['#52c41a', '#faad14', '#1677ff', '#eb2f96'];
const TYPE_LABELS: Record<string, string> = { NEW: '新单', RENEW: '续单', REPURCHASE: '复购', TIP: '打赏' };

const RevenueDashboard: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [dailyRevenue, setDailyRevenue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      dashboardApi.getRevenueOverview(),
      dashboardApi.getDailyRevenue(31),
    ]).then(([{ data: d1 }, { data: d2 }]) => {
      setData(d1.data);
      setDailyRevenue(d2.data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const openDetail = async (companionId: string) => {
    const { data: res } = await dashboardApi.getCompanionRevenueDetail(companionId);
    setDetail(res.data);
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />;
  if (!data) return <Text type="secondary">加载失败</Text>;

  const pieData = Object.entries(data.typeBreakdown || {}).map(([k, v]) => ({ name: TYPE_LABELS[k] || k, value: v as number }));
  const barData = (data.companionRevenue || []).slice(0, 20);

  const detailBarData = detail ? Object.entries(detail.breakdown || {}).map(([k, v]) => ({ name: TYPE_LABELS[k] || k, value: v })) : [];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col span={12}>
          <Card size="small" style={{ background: 'linear-gradient(135deg, #134e4a 0%, #0f766e 100%)', border: 'none' }}>
            <Statistic title={<span style={{ color: 'rgba(255,255,255,0.8)' }}>昨日总流水</span>}
              value={data.yesterdayRevenue} prefix="¥" precision={2}
              valueStyle={{ color: '#fff', fontWeight: 700, fontSize: 32 }} />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" style={{ background: 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%)', border: 'none' }}>
            <Statistic title={<span style={{ color: 'rgba(255,255,255,0.8)' }}>全月总流水</span>}
              value={data.monthlyRevenue} prefix="¥" precision={2}
              valueStyle={{ color: '#fff', fontWeight: 700, fontSize: 32 }} />
          </Card>
        </Col>
      </Row>

      <Card title="📈 近31天每日流水" size="small" style={{ marginBottom: 16 }}>
        {dailyRevenue.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dailyRevenue}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval={2} />
              <YAxis tickFormatter={(v) => `¥${v}`} width={60} />
              <Tooltip formatter={(v: any) => `¥${Number(v).toLocaleString()}`} />
              <Bar dataKey="revenue" fill="#1677ff" radius={[2, 2, 0, 0]}>
                <LabelList dataKey="revenue" position="top" formatter={(v: any) => `¥${Number(v).toFixed(0)}`} style={{ fontSize: 10 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <Text type="secondary">暂无数据</Text>}
      </Card>

      <Row gutter={16}>
        <Col span={12}>
          <Card title="全月订单类型占比" size="small">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} dataKey="value"
                    label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}>
                    {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => `¥${v.toLocaleString()}`} />
                </PieChart>
              </ResponsiveContainer>
            ) : <Text type="secondary">暂无数据</Text>}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="陪玩收入排行" size="small">
            {barData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barData} layout="vertical" margin={{ left: 50 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(v) => `¥${v}`} />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: any) => `¥${v.toLocaleString()}`} />
                  <Bar dataKey="revenue" fill="#1677ff" radius={[0, 4, 4, 0]} cursor="pointer"
                    onClick={(d: any) => openDetail(d.companionId)}>
                    <LabelList dataKey="revenue" position="right" formatter={(v: any) => `¥${Number(v).toFixed(0)}`} style={{ fontSize: 10 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <Text type="secondary">暂无数据</Text>}
            <Text type="secondary" style={{ fontSize: 12 }}>💡 点击陪玩查看订单类型明细</Text>
          </Card>
        </Col>
      </Row>

      <Modal title="订单类型明细" open={!!detail} onCancel={() => setDetail(null)} footer={null} width={580}>
        {detail && (
          <div>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={12}><Statistic title="月流水" value={detail.totalRevenue} prefix="¥" precision={2} /></Col>
              <Col span={12}><Statistic title="订单数" value={detail.orderCount} suffix="单" /></Col>
            </Row>
            {detailBarData.length > 0 && (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={detailBarData.map((d: any) => ({ ...d, pct: detail.totalRevenue > 0 ? Math.round((d.value / detail.totalRevenue) * 100) : 0 }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(v) => `¥${v}`} />
                  <Tooltip formatter={(v: any, _: string, item: any) => [`¥${Number(v).toLocaleString()} (${item.payload.pct}%)`, '金额']} />
                  <ReferenceLine y={detail.totalRevenue * 0.3} stroke="#ff4d4f" strokeWidth={1} strokeDasharray="3 3" />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    <LabelList position="top" formatter={(v: any) => `${Number(v).toFixed(0)}`} style={{ fontSize: 10 }} />
                    {detailBarData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
            <div style={{ marginTop: 12, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {detailBarData.map((d: any, i: number) => {
                const pct = detail.totalRevenue > 0 ? Math.round((d.value / detail.totalRevenue) * 100) : 0;
                return (
                  <div key={d.name} style={{ flex: 1, minWidth: 100, background: '#f5f5f5', borderRadius: 8, padding: '10px 12px', textAlign: 'center', position: 'relative' }}>
                    <div style={{ fontSize: 11, color: '#666' }}>{d.name}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: COLORS[i % COLORS.length] }}>¥{Number(d.value).toFixed(0)}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: pct >= 30 ? '#52c41a' : '#ff4d4f' }}>占比 {pct}%</div>
                    <div style={{ position: 'absolute', top: '30%', left: 0, right: 0, borderTop: '1px dashed #ff4d4f', opacity: 0.5 }} />
                  </div>
                );
              })}
            </div>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>🔴 红线=30%基准 ｜ 绿色达标，红色未达标</Text>
          </div>
        )}
      </Modal>
    </div>
  );
};

const UnifiedDashboard: React.FC = () => {
  const [tab, setTab] = useState('dashboard');

  return (
    <div>
      <Tabs activeKey={tab} onChange={setTab} size="large" items={[
        { key: 'dashboard', label: <span>{React.createElement(BarChartOutlined)} 数据看板</span>, children: <RevenueDashboard /> },
        { key: 'performance', label: <span>{React.createElement(TrophyOutlined)} 绩效看板</span>, children: <PerformancePage /> },
        { key: 'revenue', label: <span>{React.createElement(DollarOutlined)} 收入流水</span>, children: <AdminRevenuePage /> },
      ]} />
    </div>
  );
};

export default UnifiedDashboard;
