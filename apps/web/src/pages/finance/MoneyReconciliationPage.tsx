// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Typography, Row, Col, Statistic, Button, Modal, InputNumber, Input, Select, message } from 'antd';
import { ordersApi } from '../../api/orders';
import PageHeader from '../../components/PageHeader';

const { Text } = Typography;

const MoneyReconciliationPage: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [balances, setBalances] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [flowOrder, setFlowOrder] = useState<any>(null);
  const [flowForm, setFlowForm] = useState({ direction: 'IN', amount: 0, counterpart: '', note: '' });
  const [flowSaving, setFlowSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [recRes, balRes] = await Promise.all([
        ordersApi.moneyReconciliation(),
        ordersApi.csWechatBalances(),
      ]);
      setData(recRes.data.data || { rows: [], totalIn: 0, totalOut: 0, totalBridgeReturn: 0, totalProfit: 0 });
      setBalances(balRes.data.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addFlow = async () => {
    if (!flowOrder) return;
    if (!flowForm.amount || !flowForm.counterpart) {
      message.warning('请填写金额和对方');
      return;
    }
    setFlowSaving(true);
    try {
      await ordersApi.addMoneyFlow(flowOrder.orderId, { ...flowForm });
      message.success('已记录');
      setFlowOrder(null);
      setFlowForm({ direction: 'IN', amount: 0, counterpart: '', note: '' });
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '记录失败');
    } finally {
      setFlowSaving(false);
    }
  };

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
          {
            title: '操作',
            key: 'action',
            render: (_: any, r: any) => (
              <Button size="small" onClick={() => setFlowOrder(r)}>
                记流水
              </Button>
            ),
          },
        ]}
      />

      <Card size="small" title="📱 客服工作微信余额" style={{ marginTop: 16 }}>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={balances}
          size="small"
          pagination={false}
          columns={[
            { title: '工作微信', dataIndex: 'wechatId' },
            { title: '客户转入', dataIndex: 'inTotal', render: (v: number) => `¥${(v || 0).toFixed(1)}` },
            { title: '转出', dataIndex: 'outTotal', render: (v: number) => `¥${(v || 0).toFixed(1)}` },
            {
              title: '当前余额',
              dataIndex: 'balance',
              render: (v: number) => (
                <Text strong style={{ color: (v || 0) < 0 ? '#cf1322' : '#3f8600' }}>
                  ¥{(v || 0).toFixed(1)}
                </Text>
              ),
            },
          ]}
          locale={{ emptyText: '暂无客服工作微信' }}
        />
      </Card>

      <Modal
        title="记一笔资金流水"
        open={!!flowOrder}
        onOk={addFlow}
        onCancel={() => setFlowOrder(null)}
        confirmLoading={flowSaving}
        okText="记录"
        cancelText="取消"
        width={520}
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <Select
              value={flowForm.direction}
              onChange={(v) => setFlowForm((p) => ({ ...p, direction: v }))}
              style={{ width: 120 }}
            >
              <Select.Option value="IN">转入</Select.Option>
              <Select.Option value="OUT">转出</Select.Option>
            </Select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <InputNumber
              value={flowForm.amount}
              onChange={(v) => setFlowForm((p) => ({ ...p, amount: v || 0 }))}
              prefix="¥"
              style={{ width: '100%' }}
              placeholder="金额"
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <Input
              value={flowForm.counterpart}
              onChange={(e) => setFlowForm((p) => ({ ...p, counterpart: e.target.value }))}
              placeholder="对方（客户/陪玩/桥接工作室）"
            />
          </div>
          <div>
            <Input
              value={flowForm.note}
              onChange={(e) => setFlowForm((p) => ({ ...p, note: e.target.value }))}
              placeholder="备注（可选）"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default MoneyReconciliationPage;
