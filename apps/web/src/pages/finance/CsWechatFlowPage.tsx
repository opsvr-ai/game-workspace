// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Typography, Row, Col, Statistic, Spin } from 'antd';
import { ordersApi } from '../../api/orders';
import PageHeader from '../../components/PageHeader';

const { Text } = Typography;

const CsWechatFlowPage: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: res } = await ordersApi.csWechatFlow();
      setData(res.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const columns = [
    { title: '订单号', dataIndex: 'orderCode', width: 80 },
    { title: '游戏', dataIndex: 'gameName', width: 110 },
    { title: '客户微信', dataIndex: 'customerWechat', render: (v: string) => v || '-' },
    { title: '客服', dataIndex: 'csName', render: (v: string) => v || '-' },
    { title: '陪玩', dataIndex: 'companionName', render: (v: string) => v || '-' },
    { title: '去向', dataIndex: 'destination', width: 100 },
    { title: '订单金额', dataIndex: 'expected', align: 'right' as const, render: (v: number) => `¥${v.toFixed(1)}` },
    {
      title: '客户转入',
      dataIndex: 'inTotal',
      align: 'right' as const,
      render: (v: number) => <Text style={{ color: v > 0 ? '#1677ff' : '#94A3B8' }}>¥{v.toFixed(1)}</Text>,
    },
    {
      title: '转出',
      dataIndex: 'outTotal',
      align: 'right' as const,
      render: (v: number) => <Text style={{ color: v > 0 ? '#16A34A' : '#94A3B8' }}>¥{v.toFixed(1)}</Text>,
    },
    {
      title: '问题',
      dataIndex: 'problems',
      render: (problems: string[]) =>
        problems.length === 0 ? (
          <Tag color="green">正常</Tag>
        ) : (
          problems.map((p) => (
            <Tag key={p} color="red" style={{ marginBottom: 2 }}>
              {p}
            </Tag>
          ))
        ),
    },
  ];

  return (
    <div>
      <PageHeader title="📱 客服微信收款明细" subtitle="按客服工作微信查看每一笔订单的资金流向，有问题自动标红" />
      <Spin spinning={loading}>
        {data.length === 0 && !loading ? (
          <Card size="small">
            <Text type="secondary">暂无客服工作微信</Text>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {data.map((w) => (
              <Card
                key={w.id}
                size="small"
                title={
                  <span>
                    📱 {w.wechatId}
                    {w.nickname ? <Text type="secondary" style={{ marginLeft: 8 }}>{w.nickname}</Text> : null}
                    {w.problemCount > 0 && <Tag color="red" style={{ marginLeft: 8 }}>{w.problemCount} 单异常</Tag>}
                  </span>
                }
              >
                <Row gutter={16} style={{ marginBottom: 12 }}>
                  <Col span={6}><Statistic title="客户转入合计" value={w.inTotal} prefix="¥" precision={1} /></Col>
                  <Col span={6}><Statistic title="转出合计" value={w.outTotal} prefix="¥" precision={1} /></Col>
                  <Col span={6}><Statistic title="店长转走" value={w.withdrawn} prefix="¥" precision={1} /></Col>
                  <Col span={6}>
                    <Statistic
                      title="当前余额"
                      value={w.balance}
                      prefix="¥"
                      precision={1}
                      valueStyle={{ color: w.balance < 0 ? '#cf1322' : '#3f8600' }}
                    />
                  </Col>
                </Row>
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={w.orders}
                  columns={columns}
                  pagination={false}
                />
              </Card>
            ))}
          </div>
        )}
      </Spin>
    </div>
  );
};

export default CsWechatFlowPage;
