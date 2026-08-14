// craftsman-ignore: TS001,TS002,TS003
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Space, Typography, message, DatePicker, Tag, Statistic, Row, Col, Modal } from 'antd';
import { ReloadOutlined, CalculatorOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { financeApi } from '../../api/finance';
import PageHeader from '../../components/PageHeader';
import { useAuthStore } from '../../stores/authStore';
import { UserRole } from '@chunlv/shared';

const { Text } = Typography;

const SettlementPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const canWrite = user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [month, setMonth] = useState<Dayjs>(dayjs());

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await financeApi.settlement.list(month.format('YYYY-MM'));
      setRows((data as any)?.data || []);
    } catch {
      message.error('加载结算快照失败');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const run = () => {
    Modal.confirm({
      title: `确认结算 ${month.format('YYYY-MM')}？`,
      icon: React.createElement(ExclamationCircleOutlined),
      content: '结算将生成不可变快照，同月不可重复结算。请确认已完成当月业绩核对。',
      okText: '确认结算',
      cancelText: '取消',
      onOk: async () => {
        setRunning(true);
        try {
          const { data } = await financeApi.settlement.run(month.format('YYYY-MM'));
          const res = (data as any)?.data;
          if (res?.skipped) {
            message.info(res.message || '该月已结算，不可重复');
          } else {
            message.success(`结算完成，共生成 ${res?.created ?? 0} 条记录`);
          }
          await fetchList();
        } catch {
          message.error('结算失败');
        } finally {
          setRunning(false);
        }
      },
    });
  };

  const totalRevenue = rows.reduce((sum: number, r: any) => sum + (r.monthlyRevenueYuan || 0), 0);
  const totalCompanion = rows.reduce((sum: number, r: any) => sum + (r.companionShareYuan || 0), 0);
  const totalStudio = rows.reduce((sum: number, r: any) => sum + (r.studioShareYuan || 0), 0);

  return (
    <div>
      <PageHeader
        title="月度分成结算"
        subtitle="按 5200/10000 阶梯 + 满 6 个月工龄门槛生成不可变结算快照"
        extra={
          <Space>
            <DatePicker picker="month" value={month} onChange={(v) => v && setMonth(v)} allowClear={false} />
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchList} loading={loading}>刷新</Button>
            {canWrite && <Button type="primary" icon={React.createElement(CalculatorOutlined)} onClick={run} loading={running}>运行结算</Button>}
          </Space>
        }
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}><Card size="small"><Statistic title="总业绩" value={totalRevenue} precision={2} prefix="¥" /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="陪玩分成合计" value={totalCompanion} precision={2} prefix="¥" /></Card></Col>
        <Col span={8}><Card size="small"><Statistic title="工作室分成合计" value={totalStudio} precision={2} prefix="¥" /></Card></Col>
      </Row>

      <Card size="small" title={`${month.format('YYYY-MM')} 结算快照`}>
        <Table
          rowKey="companionId"
          size="small"
          loading={loading}
          pagination={false}
          dataSource={rows}
          locale={{ emptyText: '暂无结算记录，请点击「运行结算」' }}
        >
          <Table.Column title="陪玩" dataIndex="companionName" />
          <Table.Column title="业绩" dataIndex="monthlyRevenueYuan" render={(v: number) => `¥${Number(v || 0).toFixed(2)}`} />
          <Table.Column title="工龄（月）" dataIndex="tenureMonths" />
          <Table.Column title="分成比例" dataIndex="companionPct" render={(v: number) => <Tag color={v >= 70 ? 'red' : v >= 60 ? 'blue' : 'default'}>{v}%</Tag>} />
          <Table.Column title="陪玩分成" dataIndex="companionShareYuan" render={(v: number) => <Text strong>¥{Number(v || 0).toFixed(2)}</Text>} />
          <Table.Column title="工作室分成" dataIndex="studioShareYuan" render={(v: number) => `¥${Number(v || 0).toFixed(2)}`} />
          <Table.Column title="结算时间" dataIndex="createdAt" render={(v: string) => dayjs(v).format('YYYY-MM-DD HH:mm')} />
        </Table>
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          📌 阶梯：&lt;5200 五五；5200–10000 六四；≥10000 且入职满 6 个月七三（≥10000 但不满 6 个月仍六四）。
        </Text>
      </Card>
    </div>
  );
};

export default SettlementPage;
