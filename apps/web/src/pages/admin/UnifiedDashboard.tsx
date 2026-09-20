// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Statistic, Typography, Modal, DatePicker, Button, Result } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import dayjs, { Dayjs } from 'dayjs';
import { dashboardApi } from '../../api/dashboard';
import http from '../../api/client';
import ErrorBanner from '../../components/ErrorBanner';
import CardSkeleton from '../../components/CardSkeleton';
import EmptyState from '../../components/EmptyState';

const { Text } = Typography;
const { RangePicker } = DatePicker;
const COLORS = ['#52c41a', '#faad14', '#1677ff', '#eb2f96'];
const TYPE_LABELS: Record<string, string> = { NEW: '首单', RENEW: '续单', REPURCHASE: '复购', TIP: '打赏' };
const IconDownload = React.createElement(DownloadOutlined);
const IconReload = React.createElement(ReloadOutlined);

const CsvExport: React.FC<{ dailyRevenue: any[] }> = ({ dailyRevenue }) => {
  const exportCsv = () => {
    const header = '日期,流水(元)';
    const rows = dailyRevenue.map((d: any) => `${d.date},${d.revenue}`);
    const csv = [header, ...rows].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `营收日报_${dayjs().format('YYYY-MM-DD')}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };
  return <Button icon={IconDownload} onClick={exportCsv} size="small">导出CSV</Button>;
};

const RevenueDashboard: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [dailyRevenue, setDailyRevenue] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(31, 'day'), dayjs()]);
  const [onlineCount, setOnlineCount] = useState<number>(0);
  const [pendingReview, setPendingReview] = useState<number>(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const days = dateRange[0] && dateRange[1]
        ? dateRange[1].diff(dateRange[0], 'day') + 1
        : 31;
      const [d1, d2] = await Promise.all([
        dashboardApi.getRevenueOverview(),
        dashboardApi.getDailyRevenue(days),
      ]);
      setData(d1.data.data);
      setDailyRevenue(d2.data.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.message || '加载营收数据失败');
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  const fetchStats = useCallback(async () => {
    try {
      const [{ data: comps }, { data: reviews }] = await Promise.all([
        http.get('/companions'),
        http.get('/companions/pending-review'),
      ]);
      const list = comps.data || comps || [];
      setOnlineCount(Array.isArray(list) ? list.filter((c: any) => c.status && c.status !== 'OFFLINE').length : 0);
      setPendingReview((reviews.data || []).length);
    } catch { /* non-critical stats */ }
  }, []);

  useEffect(() => { fetchData(); fetchStats(); }, [fetchData, fetchStats]);

  const openDetail = async (companionId: string) => {
    const { data: res } = await dashboardApi.getCompanionRevenueDetail(companionId);
    setDetail(res.data);
  };

  if (loading) return (
    <div>
      <Row gutter={16} style={{ marginBottom: 20 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Col xs={12} sm={6} key={i}>
            <CardSkeleton lines={1} />
          </Col>
        ))}
      </Row>
      <CardSkeleton lines={6} />
      <CardSkeleton lines={3} />
    </div>
  );

  if (error && !data) {
    return <Result status="error" title="数据加载失败" subTitle={error}
      extra={<Button type="primary" onClick={fetchData} icon={IconReload}>重试</Button>} />;
  }

  const pieData = Object.entries(data?.typeBreakdown || {}).map(([k, v]) => ({ name: TYPE_LABELS[k] || k, value: v as number }));
  const barData = (data?.companionRevenue || []).slice(0, 20);
  const detailBarData = detail ? Object.entries(detail.breakdown || {}).map(([k, v]) => ({ name: TYPE_LABELS[k] || k, value: v })) : [];

  return (
    <div>
      {error && <ErrorBanner message={error} onRetry={fetchData} />}

      {/* KPI Cards */}
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6}>
          <KpiCard label="昨日总流水" value={yuan(data?.yesterdayRevenue)} tint="#10B981" />
        </Col>
        <Col xs={12} sm={6}>
          <KpiCard label="全月总流水" value={yuan(data?.monthlyRevenue)} tint="#7C4DFF" />
        </Col>
        <Col xs={12} sm={6}>
          <KpiCard label="在线陪玩" value={`${onlineCount} 人`} tint="#3B82F6" />
        </Col>
        <Col xs={12} sm={6}>
          <KpiCard
            label="待审核"
            value={`${pendingReview} 项`}
            tint={pendingReview > 0 ? '#F59E0B' : '#94A3B8'}
          />
        </Col>
      </Row>

      {/* DatePicker + Export */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <RangePicker value={dateRange} onChange={(v) => v && setDateRange([v[0]!, v[1]!])}
          style={{ width: 260 }} size="small" />
        <CsvExport dailyRevenue={dailyRevenue} />
      </div>

      <Card title="📈 每日流水" size="small" style={{ marginBottom: 12 }}>
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
        ) : <EmptyState description="暂无数据" />}
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
            ) : <EmptyState description="暂无数据" />}
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
            ) : <EmptyState description="暂无数据" />}
            <Text type="secondary" style={{ fontSize: 12 }}>💡 点击陪玩查看订单类型明细</Text>
          </Card>
        </Col>
      </Row>

      <Modal title="订单类型明细" open={!!detail} onCancel={() => setDetail(null)} footer={null} width={580}>
        {detail && (
          <div>
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={12}><Statistic title="月流水" value={detail.totalRevenue} prefix="¥" precision={1} /></Col>
              <Col span={12}><Statistic title="订单数" value={detail.orderCount} suffix="单" /></Col>
            </Row>
            {detailBarData.length > 0 && (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={detailBarData.map((d: any) => ({ ...d, pct: detail.totalRevenue > 0 ? Math.round((d.value / detail.totalRevenue) * 100) : 0 }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(v) => `¥${v}`} />
                  <Tooltip formatter={(v: any) => `¥${Number(v).toLocaleString()}`} />
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
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#666' }}>占比 {pct}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

/**
 * 首页 KPI 卡（老板 2026-09-21：「别全是黑白的，整齐、有层次感」）。
 * 之前是「深绿块 + 深红块 + 两个白块」，四张卡三种风格，红色还容易看成人看不懂的告警。
 * 现在统一成：白卡 + 左侧色条 + 小色点标题 + 同色数字 —— 四张卡一个模子，靠颜色区分指标。
 */
const KpiCard: React.FC<{ label: string; value: React.ReactNode; tint: string }> = ({
  label,
  value,
  tint,
}) => (
  <div
    className="ui-panel"
    style={{ position: 'relative', overflow: 'hidden', padding: '14px 16px', height: '100%' }}
  >
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 4,
        background: `linear-gradient(180deg, ${tint}, ${tint}66)`,
      }}
    />
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#64748B' }}>
      <span style={{ width: 6, height: 6, borderRadius: 2, background: tint }} />
      {label}
    </div>
    <div
      style={{
        marginTop: 6,
        fontSize: 26,
        fontWeight: 700,
        letterSpacing: '-0.5px',
        lineHeight: 1.25,
        color: tint,
      }}
    >
      {value}
    </div>
  </div>
);

const yuan = (v: unknown) => `¥${Number(v || 0).toFixed(1)}`;

const UnifiedDashboard: React.FC = () => {
  return <RevenueDashboard />;
};

export default UnifiedDashboard;
