// craftsman-ignore: TS001,TS002,TS003
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Space, Typography, message, Tag, Statistic, Row, Col, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { financeApi } from '../../api/finance';
import PageHeader from '../../components/PageHeader';

const { Text, Paragraph } = Typography;

const riskLevelConfig: Record<string, { color: string; label: string }> = {
  HIGH: { color: 'red', label: '高风险' },
  MEDIUM: { color: 'orange', label: '中风险' },
  LOW: { color: 'green', label: '低风险' },
};

const RiskWorkbenchPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await financeApi.riskQueue.get();
      setRows((data as any)?.data || []);
    } catch {
      message.error('加载风险队列失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const highCount = rows.filter((r: any) => r.riskLevel === 'HIGH').length;
  const mediumCount = rows.filter((r: any) => r.riskLevel === 'MEDIUM').length;
  const totalFlagged = rows.reduce((sum: number, r: any) => sum + (r.flaggedCount || 0), 0);

  return (
    <div>
      <PageHeader
        title="客户画像与私单风险"
        subtitle="AI 汇总陪玩名下客户的单价、时长、消费异常，按私单风险评分排序，供管理者优先复核"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchData} loading={loading}>刷新</Button>
          </Space>
        }
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title="高风险陪玩" value={highCount} valueStyle={{ color: highCount ? '#cf1322' : undefined }} suffix="人" /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="中风险陪玩" value={mediumCount} valueStyle={{ color: mediumCount ? '#d46b08' : undefined }} suffix="人" /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="异常订单信号" value={totalFlagged} suffix="条" /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="纳入统计陪玩" value={rows.length} suffix="人" /></Card></Col>
      </Row>

      <Card size="small" title="重点查看队列">
        <Table
          rowKey="companionId"
          size="small"
          loading={loading}
          pagination={false}
          dataSource={rows}
          locale={{ emptyText: '暂无风险数据' }}
          expandable={{
            expandedRowRender: (record: any) => (
              <div style={{ padding: '4px 12px' }}>
                {record.customers?.length ? (
                  <Table
                    rowKey="customerId"
                    size="small"
                    pagination={false}
                    dataSource={record.customers}
                    columns={[
                      { title: '客户ID', dataIndex: 'customerId', width: 180, render: (v: string) => <Text code>{v.slice(0, 8)}</Text> },
                      { title: '订单数', dataIndex: 'orderCount', width: 80 },
                      { title: '历史均价（元）', dataIndex: 'avgAmount', width: 120, render: (v: number) => `¥${Number(v || 0).toFixed(0)}` },
                      { title: '低价次数', dataIndex: 'lowPriceCount', width: 90, render: (v: number) => (v ? <Tag color="red">{v}</Tag> : '-') },
                      { title: '周消费腰斩', dataIndex: 'consumptionDrop', width: 110, render: (v: boolean) => (v ? <Tag color="red">是</Tag> : '-') },
                      { title: '时长骤降', dataIndex: 'durationDrop', width: 100, render: (v: boolean) => (v ? <Tag color="orange">是</Tag> : '-') },
                      { title: '流失风险', dataIndex: 'churnRisk', width: 100, render: (v: boolean) => (v ? <Tag color="purple">是</Tag> : '-') },
                    ]}
                  />
                ) : (
                  <Text type="secondary">该陪玩名下暂无多单客户画像</Text>
                )}
              </div>
            ),
          }}
        >
          <Table.Column
            title="陪玩"
            dataIndex="companionName"
            render={(v: string, record: any) => (
              <Space>
                <Text strong>{v}</Text>
                <Tag color={riskLevelConfig[record.riskLevel]?.color}>{riskLevelConfig[record.riskLevel]?.label}</Tag>
              </Space>
            )}
          />
          <Table.Column
            title="风险评分"
            dataIndex="riskScore"
            sorter={(a: any, b: any) => a.riskScore - b.riskScore}
            render={(v: number) => <Text strong style={{ color: v >= 50 ? '#cf1322' : v >= 20 ? '#d46b08' : '#389e0d' }}>{v}</Text>}
          />
          <Table.Column title="90天订单" dataIndex="orderCount" />
          <Table.Column title="流水（元）" dataIndex="revenueYuan" render={(v: number) => `¥${Number(v || 0).toFixed(0)}`} />
          <Table.Column title="转账异常" dataIndex="flaggedCount" render={(v: number) => (v ? <Tag color="red">{v}</Tag> : '-')} />
          <Table.Column title="低价异常" dataIndex="lowPriceCount" render={(v: number) => (v ? <Tag color="orange">{v}</Tag> : '-')} />
          <Table.Column
            title="AI 分析"
            dataIndex="aiCopy"
            width={380}
            render={(v: string) => (
              <Tooltip title={v}>
                <Paragraph style={{ margin: 0, maxWidth: 360 }} ellipsis={{ rows: 2 }}>{v}</Paragraph>
              </Tooltip>
            )}
          />
        </Table>
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          📌 评分基于转账与上报差额、单价低于客户历史基线、周消费/时长腰斩、客户流失风险等信号综合计算，仅作抽查辅助，不自动判定责任。
        </Text>
      </Card>
    </div>
  );
};

export default RiskWorkbenchPage;
