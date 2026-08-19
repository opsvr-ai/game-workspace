// craftsman-ignore: TS001,TS002,TS003
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Typography, Button, Row, Col, Space, DatePicker, Select, Input, Table, Tag } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { statsApi } from '../api/stats';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const orderStatusConfig: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'orange', label: '待抢单' },
  GRABBED: { color: 'blue', label: '已抢' },
  CONFIRMED: { color: 'cyan', label: '已确认' },
  DONE: { color: 'green', label: '已完成' },
  CANCELLED: { color: 'red', label: '已取消' },
  CLAIMED: { color: 'purple', label: '客服认领' },
};

const paidToConfig: Record<string, string> = {
  CS_WECHAT: '客服工作微信',
  COMPANION_WECHAT: '陪玩微信',
  STUDIO_ACCOUNT: '工作室账号',
  OTHER: '其他',
};

const StatsPage: React.FC = () => {
  const today = dayjs();
  const [range, setRange] = useState<[Dayjs, Dayjs]>([today, today]);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [feeStatus, setFeeStatus] = useState<string | undefined>(undefined);
  const [gameName, setGameName] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const doLoad = useCallback(async () => {
    setLoading(true);
    try {
      const res = await statsApi.getDaily({
        dateFrom: range[0].format('YYYY-MM-DD'),
        dateTo: range[1].format('YYYY-MM-DD'),
        status,
        feeStatus,
        gameName: gameName || undefined,
      });
      setData((res.data as any)?.data || null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range, status, feeStatus, gameName]);

  useEffect(() => {
    doLoad();
  }, [doLoad]);

  if (loading && !data) {
    return <Card><Text>加载中...</Text></Card>;
  }

  const s = data?.summary || {
    totalOrders: 0, totalAmount: 0, claimedCount: 0, claimedAmount: 0,
    unassignedCount: 0, feePaidCount: 0, feeUnpaidCount: 0,
    wechatCount: 0, alipayCount: 0,
  };
  const csList = data?.csList || [];
  const orders = data?.orders || [];

  const columns = [
    { title: '时间', dataIndex: 'createdAt', width: 120, render: (v: string) => dayjs(v).format('MM/DD HH:mm') },
    { title: '订单号', dataIndex: 'orderCode', width: 120, render: (v: string) => v || '-' },
    { title: '游戏', dataIndex: 'gameName', width: 90 },
    { title: '金额', dataIndex: 'amount', width: 90, render: (v: number) => <Text strong style={{ color: '#cf1322' }}>¥{v?.toFixed(1)}</Text> },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => {
      const cfg = orderStatusConfig[v] ?? { color: 'default', label: v };
      return <Tag color={cfg.color}>{cfg.label}</Tag>;
    } },
    { title: '发单客服', dataIndex: 'csName', width: 90, render: (v: string) => v || '-' },
    { title: '认领客服', dataIndex: 'claimedCsName', width: 90, render: (v: string) => v || '-' },
    { title: '工作微信', dataIndex: 'csWorkWechatName', width: 100, render: (v: string) => v || '-' },
    { title: '客户付款去向', dataIndex: 'customerPaidTo', width: 110, render: (v: string) => paidToConfig[v] || v || '-' },
    { title: '收款账号', dataIndex: 'customerPaymentAccountName', width: 100, render: (v: string) => v || '-' },
    { title: '陪玩', dataIndex: 'companionName', width: 90, render: (v: string) => v || '-' },
    { title: '陪玩工作室', dataIndex: 'companionStudio', width: 100, render: (v: string) => v || '-' },
    { title: '陪玩费', dataIndex: 'companionFeeAmount', width: 90, render: (v: number) => v != null ? `¥${v.toFixed(1)}` : '-' },
    { title: '费状态', dataIndex: 'companionFeeStatus', width: 80, render: (v: string) => <Tag color={v === 'PAID' ? 'green' : 'orange'}>{v === 'PAID' ? '已付' : '未付'}</Tag> },
    { title: '费方式', dataIndex: 'companionFeeMethod', width: 80, render: (v: string) => v === 'WECHAT' ? '微信' : v === 'ALIPAY' ? '支付宝' : '-' },
    { title: '费账号', dataIndex: 'companionFeeAccount', width: 100, render: (v: string) => v || '-' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>客服派单 / 提成核对</Title>
          <Text type="secondary">{data?.dateFrom || ''} ~ {data?.dateTo || ''}</Text>
        </div>
        <Space wrap>
          <RangePicker value={range} onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])} allowClear={false} />
          <Select placeholder="订单状态" allowClear style={{ width: 120 }} value={status} onChange={(v) => setStatus(v)}>
            {Object.entries(orderStatusConfig).map(([k, c]) => <Select.Option key={k} value={k}>{c.label}</Select.Option>)}
          </Select>
          <Select placeholder="陪玩费状态" allowClear style={{ width: 120 }} value={feeStatus} onChange={(v) => setFeeStatus(v)}>
            <Select.Option value="PAID">已付</Select.Option>
            <Select.Option value="PENDING">未付</Select.Option>
          </Select>
          <Input
            placeholder="游戏名称"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 140 }}
            value={gameName}
            onChange={(e) => setGameName(e.target.value)}
            onPressEnter={doLoad}
          />
          <Button type="primary" icon={<ReloadOutlined />} onClick={doLoad} loading={loading}>查询</Button>
        </Space>
      </div>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={4}><Card size="small"><Text type="secondary">发单总数</Text><div><Text strong style={{ fontSize: 22 }}>{s.totalOrders} 单</Text></div></Card></Col>
        <Col xs={12} sm={4}><Card size="small"><Text type="secondary">总金额</Text><div><Text strong style={{ fontSize: 22, color: '#cf1322' }}>¥{s.totalAmount.toFixed(0)}</Text></div></Card></Col>
        <Col xs={12} sm={4}><Card size="small"><Text type="secondary">客服认领</Text><div><Text strong style={{ fontSize: 22, color: '#722ed1' }}>{s.claimedCount || 0} 单 / ¥{(s.claimedAmount || 0).toFixed(0)}</Text></div></Card></Col>
        <Col xs={12} sm={4}><Card size="small"><Text type="secondary">未接单</Text><div><Text strong style={{ fontSize: 22, color: s.unassignedCount > 0 ? '#faad14' : '#8c8c8c' }}>{s.unassignedCount} 单</Text></div></Card></Col>
        <Col xs={12} sm={4}><Card size="small"><Text type="secondary">已付 / 未付</Text><div><Text strong style={{ fontSize: 20 }}>{s.feePaidCount} / {s.feeUnpaidCount}</Text></div></Card></Col>
        <Col xs={12} sm={4}><Card size="small"><Text type="secondary">微信 / 支付宝</Text><div><Text strong style={{ fontSize: 18 }}>{s.wechatCount} / {s.alipayCount}</Text></div></Card></Col>
      </Row>

      <Card title={`客服汇总（${csList.length}人）`} size="small" style={{ marginBottom: 16 }}>
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, overflow: 'hidden' }}>
          {csList.map((cs: any, i: number) => (
            <div key={cs.csUserId} style={{ padding: '8px 12px', borderBottom: i < csList.length - 1 ? '1px solid #f0f0f0' : 'none', background: i % 2 === 0 ? '#fafafa' : '#fff' }}>
              <Row gutter={[12, 4]} align="middle">
                <Col xs={24} sm={3}><Text strong>{cs.csDisplayName || cs.csName}</Text></Col>
                <Col xs={12} sm={2}><Text>发单 {cs.totalOrders}</Text></Col>
                <Col xs={12} sm={2}><Text style={{ color: '#722ed1' }}>认领 {cs.claimedCount || 0}</Text></Col>
                <Col xs={12} sm={2}><Text style={{ color: '#cf1322' }}>¥{cs.totalAmount.toFixed(0)}</Text></Col>
                <Col xs={24} sm={6}>
                  {(cs.studioBreakdown || []).map((b: any) => (
                    <Text key={b.studioName} style={{ display: 'inline-block', background: b.isOwn ? '#f6ffed' : b.studioType === 'RENTAL' ? '#f9f0ff' : '#e6f4ff', padding: '0 6px', borderRadius: 3, marginRight: 4, fontSize: 12, border: '1px solid ' + (b.isOwn ? '#b7eb8f' : b.studioType === 'RENTAL' ? '#d3adf7' : '#91caff') }}>{b.studioName} {b.count}单 ¥{b.amount.toFixed(0)}</Text>
                  ))}
                </Col>
                <Col xs={8} sm={2}><Text style={{ color: '#52c41a' }}>已付{cs.feePaidCount}</Text><Text style={{ color: '#faad14', marginLeft: 4 }}>未付{cs.feeUnpaidCount}</Text></Col>
                <Col xs={8} sm={2}><Text style={{ color: '#07c160', fontSize: 12 }}>微信{cs.wechatCount} ¥{cs.wechatAmount.toFixed(0)}</Text></Col>
                <Col xs={8} sm={2}><Text style={{ color: '#1677ff', fontSize: 12 }}>支付宝{cs.alipayCount} ¥{cs.alipayAmount.toFixed(0)}</Text></Col>
              </Row>
            </div>
          ))}
        </div>
      </Card>

      <Card title={`订单明细（${orders.length}单）`} size="small">
        <Table
          size="small"
          rowKey="id"
          columns={columns}
          dataSource={orders}
          loading={loading}
          scroll={{ x: 1600 }}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 单` }}
        />
      </Card>
    </div>
  );
};

export default StatsPage;