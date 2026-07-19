// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { extractErrorMessage } from '../../utils/error-handler';
import {
  Table,
  Button,
  Typography,
  message,
  Row,
  Col,
  Card,
  DatePicker,
  Alert,
  Descriptions,
} from 'antd';
import { billingApi } from '../../api/billing';
import dayjs, { Dayjs } from 'dayjs';

const { Text } = Typography;

const SettlementPanel: React.FC = () => {
  const [settlementMonth, setSettlementMonth] = useState<Dayjs>(dayjs());
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [settlementResult, setSettlementResult] = useState<any>(null);
  const [pastSettlements, setPastSettlements] = useState<any[]>([]);
  const [pastSettlementsLoading, setPastSettlementsLoading] = useState(false);

  const handleRunSettlement = async () => {
    const monthStr = settlementMonth.format('YYYY-MM');
    setSettlementLoading(true);
    try {
      const { data } = await billingApi.runSettlement(monthStr);
      setSettlementResult(data.data);
      message.success(data.message || '月底结算完成');
      fetchPastSettlements();
    } catch (err: any) {
      message.error(extractErrorMessage(err, '结算失败'));
    } finally {
      setSettlementLoading(false);
    }
  };

  const fetchPastSettlements = useCallback(async () => {
    const monthStr = settlementMonth.format('YYYY-MM');
    setPastSettlementsLoading(true);
    try {
      const { data } = await billingApi.getSettlement(monthStr);
      setPastSettlements(data.data ?? []);
    } catch {
      // silently fail
    } finally {
      setPastSettlementsLoading(false);
    }
  }, [settlementMonth]);

  useEffect(() => {
    fetchPastSettlements();
  }, [fetchPastSettlements]);

  return (
    <Card title="月底结算" style={{ marginTop: 16 }}>
      <Alert
        message="结算后陪玩当月业绩将清零并计入可支取余额，请确认当月订单已全部审核完毕。"
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
      />

      <Row gutter={16} align="middle" style={{ marginBottom: 12 }}>
        <Col>
          <DatePicker
            picker="month"
            value={settlementMonth}
            onChange={(d) => {
              if (d) {
                setSettlementMonth(d);
                setSettlementResult(null);
              }
            }}
            style={{ width: 160 }}
            allowClear={false}
          />
        </Col>
        <Col>
          <Button type="primary" onClick={handleRunSettlement} loading={settlementLoading} danger>
            执行结算
          </Button>
        </Col>
      </Row>

      {/* Settlement result summary */}
      {settlementResult && (
        <Card
          size="small"
          style={{
            marginBottom: 12,
            background: '#f6ffed',
            border: '1px solid #b7eb8f',
          }}
        >
          <Descriptions column={3} size="small">
            <Descriptions.Item label="结算月份">{settlementResult.month}</Descriptions.Item>
            <Descriptions.Item label="结算人数">{settlementResult.results?.length ?? 0} 人</Descriptions.Item>
            <Descriptions.Item label="总计分配">
              <Text strong style={{ color: '#cf1322' }}>
                ¥{(settlementResult.totalDistributed ?? 0).toFixed(2)}
              </Text>
            </Descriptions.Item>
          </Descriptions>

          <Table
            dataSource={settlementResult.results ?? []}
            rowKey="companionId"
            size="small"
            pagination={false}
            style={{ marginTop: 8 }}
            locale={{ emptyText: '暂无结算结果' }}
          >
            <Table.Column title="陪玩" dataIndex="companionName" width={100} />
            <Table.Column
              title="当月业绩"
              dataIndex="monthlyRevenue"
              width={110}
              render={(v: number) => <Text strong>¥{v.toFixed(2)}</Text>}
            />
            <Table.Column
              title="分成比例"
              dataIndex="tierCompanionPct"
              width={90}
              render={(v: number) => `${v}%`}
            />
            <Table.Column
              title="陪玩分成"
              dataIndex="companionShare"
              width={110}
              render={(v: number) => <Text style={{ color: '#3f8600' }}>¥{v.toFixed(2)}</Text>}
            />
            <Table.Column
              title="工作室分成"
              dataIndex="studioShare"
              width={110}
              render={(v: number) => <Text style={{ color: '#1677ff' }}>¥{v.toFixed(2)}</Text>}
            />
          </Table>
        </Card>
      )}

      {/* Past settlements for selected month */}
      <Table
        dataSource={pastSettlements}
        rowKey="id"
        size="small"
        loading={pastSettlementsLoading}
        pagination={{
          pageSize: 10,
          showTotal: (total) => `共 ${total} 条`,
        }}
        locale={{ emptyText: '该月暂无结算记录' }}
      >
        <Table.Column title="陪玩" dataIndex={['companion', 'user', 'username']} width={100} />
        <Table.Column
          title="金额"
          dataIndex="amount"
          width={100}
          render={(v: number) => (
            <Text strong style={{ color: '#3f8600' }}>
              ¥{v.toFixed(2)}
            </Text>
          )}
        />
        <Table.Column title="备注" dataIndex="note" ellipsis render={(v: string) => v || '-'} />
        <Table.Column
          title="日期"
          dataIndex="createdAt"
          width={160}
          render={(d: string) => new Date(d).toLocaleString('zh-CN')}
        />
      </Table>
    </Card>
  );
};

export default SettlementPanel;
