// craftsman-ignore: TS001,TS002,TS003
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Space, Typography, message, DatePicker, Tag, Statistic, Row, Col } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { financeApi } from '../../api/finance';
import PageHeader from '../../components/PageHeader';

const { Text } = Typography;

const ReconciliationPage: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [day, setDay] = useState<Dayjs>(dayjs());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await financeApi.reconciliation.get(day.format('YYYY-MM-DD'));
      setRows((data as any)?.data?.rows || []);
    } catch {
      message.error('加载对账数据失败');
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const flaggedCount = rows.filter((r: any) => r.flagged).length;
  const totalDiff = rows.reduce((sum: number, r: any) => sum + (r.diffYuan || 0), 0);

  return (
    <div>
      <PageHeader
        title="每日到账对账"
        subtitle="按「陪玩 × 营业日」核对应收合计与员工收款码实际到账，差额标红"
        extra={
          <Space>
            <DatePicker value={day} onChange={(v) => v && setDay(v)} allowClear={false} />
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchData} loading={loading}>刷新</Button>
          </Space>
        }
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}><Card size="small"><Statistic title="对账人数" value={rows.length} suffix="人" /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="差额异常" value={flaggedCount} suffix="人" valueStyle={{ color: flaggedCount ? '#cf1322' : undefined }} /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="合计差额" value={totalDiff} precision={2} prefix="¥" valueStyle={{ color: totalDiff < 0 ? '#cf1322' : undefined }} /></Card></Col>
      </Row>

      <Card size="small" title={`${day.format('YYYY-MM-DD')} 营业日对账`}>
        <Table
          rowKey="companionId"
          size="small"
          loading={loading}
          pagination={false}
          dataSource={rows}
          locale={{ emptyText: '当日暂无需要核对的数据' }}
        >
          <Table.Column title="陪玩" dataIndex="companionName" />
          <Table.Column title="应收（订单）" dataIndex="expectedYuan" render={(v: number) => `¥${Number(v || 0).toFixed(2)}`} />
          <Table.Column title="到账（员工码）" dataIndex="actualYuan" render={(v: number) => `¥${Number(v || 0).toFixed(2)}`} />
          <Table.Column
            title="差额"
            dataIndex="diffYuan"
            render={(v: number) => {
              const val = Number(v || 0);
              return (
                <Text strong style={{ color: val < 0 ? '#cf1322' : val > 0 ? '#389e0d' : undefined }}>
                  {val > 0 ? '+' : ''}{val.toFixed(2)}
                </Text>
              );
            }}
          />
          <Table.Column
            title="状态"
            dataIndex="flagged"
            render={(v: boolean) => (v ? <Tag color="red">差额未补齐</Tag> : <Tag color="green">一致</Tag>)}
          />
        </Table>
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          📌 营业日以 12:00 为界：当日 12:00 至次日 12:00 计入当日；到账以扫入绑定员工收款码为准，未扫入不计业绩。
        </Text>
      </Card>
    </div>
  );
};

export default ReconciliationPage;
