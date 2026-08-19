// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Typography, Row, Col, Statistic } from 'antd';
import { ordersApi } from '../../api/orders';
import PageHeader from '../../components/PageHeader';

const { Text } = Typography;

const MoneyReconciliationPage: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await ordersApi.moneyReconciliation();
      setData(data.data || { rows: [], totalIn: 0, totalOut: 0, totalBridgeReturn: 0, totalProfit: 0 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <PageHeader title="💰 资金对账" subtitle="客户转入、转出、桥接应返还、平台利润一览，钱对不上的单会标红" />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title="客户转入合计" value={data?.totalIn || 0} prefix="¥" precision={1} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="转出合计" value={data?.totalOut || 0} prefix="¥" precision={1} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="桥接应返还合计" value={data?.totalBridgeReturn || 0} prefix="¥" precision={1} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="平台利润" value={data?.totalProfit || 0} prefix="¥" precision={1} valueStyle={{ color: (data?.totalProfit || 0) >= 0 ? '#3f8600' : '#cf1322' }} /></Card></Col>
      </Row>

      <Table
        rowKey="orderId"
        loading={loading}
        dataSource={data?.rows || []}
        size="small"
        pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 单` }}
        columns={[
          { title: '游戏', dataIndex: 'gameName' },
          { title: '客户微信', dataIndex: 'customerWechat', render: (v: string) => v || '-' },
          { title: '工作微信', dataIndex: 'csWorkWechatName', render: (v: string) => v || '-' },
          { title: '机密/绝密', dataIndex: 'deltaMission', render: (v: string) => v || '-' },
          { title: '转入', dataIndex: 'inTotal', render: (v: number) => <Text>¥{v?.toFixed(1)}</Text> },
          { title: '转出', dataIndex: 'outTotal', render: (v: number) => <Text>¥{v?.toFixed(1)}</Text> },
          { title: '桥接应返还', dataIndex: 'bridgeReturn', render: (v: number) => <Text type="secondary">¥{v?.toFixed(1)}</Text> },
          { title: '利润', dataIndex: 'profit', render: (v: number) => <Text style={{ color: v < 0 ? '#cf1322' : '#3f8600' }}>¥{v?.toFixed(1)}</Text> },
          {
            title: '状态',
            key: 'flagged',
            render: (_: any, r: any) =>
              r.flagged ? <Tag color="red">钱对不上</Tag> : <Tag color="green">正常</Tag>,
          },
        ]}
      />
    </div>
  );
};

export default MoneyReconciliationPage;
