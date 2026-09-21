// craftsman-ignore: TS001,TS002,TS003
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Space, Typography, message, Table, Tag, Statistic, Row, Col } from 'antd';
import { ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { financeApi } from '../../api/finance';
import PageHeader from '../../components/PageHeader';

const { Text } = Typography;

const CsCommissionTodayPage: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await financeApi.commission.today();
      setData((res as any)?.data || null);
    } catch (err: any) {
      message.error(err?.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const s = data?.summary || null;
  const csList: any[] = data?.csList || [];

  return (
    <div>
      <PageHeader
        title="客服提成 · 今日看板"
        subtitle={`今日（营业日 ${data?.date || dayjs().format('YYYY-MM-DD')}，12:00 起算）。规则：每客服每日桥接单数达标，未达标则提成、底薪按比例下调。`}
        extra={
          <Space>
            <Button icon={<SettingOutlined />} onClick={() => navigate('/admin/cs-settings')}>去设置</Button>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
          </Space>
        }
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}><Card size="small"><Statistic title="今日完成单数" value={s?.totalOrders ?? 0} suffix="单" /></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Statistic title="今日总流水" value={s?.totalFlow ?? 0} precision={1} prefix="¥" /></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Statistic title="今日总提成（应发）" value={s?.totalCommission ?? 0} precision={1} prefix="¥" valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Statistic title="客服底薪（月/人）" value={s?.baseSalaryYuan ?? 0} precision={1} prefix="¥" /></Card></Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}><Card size="small"><Text type="secondary">线下单数</Text><div><Text strong style={{ fontSize: 22 }}>{s?.offlineOrders ?? 0}</Text> <Text type="secondary">单</Text></div><Text style={{ color: '#cf1322' }}>流水 ¥{(s?.offlineFlow ?? 0).toFixed(1)}</Text><br /><Text style={{ color: '#cf1322' }}>提成 ¥{(s?.offlineCommission ?? 0).toFixed(1)}</Text></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Text type="secondary">桥接单数</Text><div><Text strong style={{ fontSize: 22 }}>{s?.bridgeOrders ?? 0}</Text> <Text type="secondary">单</Text></div><Text style={{ color: '#cf1322' }}>提成 ¥{(s?.bridgeCommission ?? 0).toFixed(1)}</Text></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Text type="secondary">线上单数</Text><div><Text strong style={{ fontSize: 22 }}>{s?.onlineOrders ?? 0}</Text> <Text type="secondary">单</Text></div><Text style={{ color: '#cf1322' }}>提成 ¥{(s?.onlineCommission ?? 0).toFixed(1)}</Text></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Text type="secondary">桥接达标</Text><div><Text strong style={{ fontSize: 22, color: (s?.bridgeMetCount ?? 0) === (s?.csCount ?? 0) && (s?.csCount ?? 0) > 0 ? '#52c41a' : '#cf1322' }}>{s?.bridgeMetCount ?? 0}</Text> <Text type="secondary">/ {s?.csCount ?? 0} 人</Text></div><Text type="secondary" style={{ fontSize: 12 }}>目标：每人 {s?.bridgeTarget ?? 10} 单/日</Text></Card></Col>
      </Row>

      <Card size="small" title={`客服明细（${csList.length}人）`}>
        <Table
          rowKey="userId"
          size="small"
          loading={loading}
          pagination={false}
          dataSource={csList}
          locale={{ emptyText: '今日暂无客服提成数据' }}
          scroll={{ x: 900 }}
        >
          <Table.Column title="客服" dataIndex="displayName" render={(v: string, r: any) => v || r.username || '-'} />
          <Table.Column title="今日单数" dataIndex="totalOrders" width={80} />
          <Table.Column title="桥接单/目标" width={110} render={(_: unknown, r: any) => (
            <Text type={r.bridgeOrders >= r.bridgeTarget ? 'success' : 'danger'} strong>{r.bridgeOrders} / {r.bridgeTarget}</Text>
          )} />
          <Table.Column title="达标" width={80} render={(_: unknown, r: any) => (
            r.bridgeMet ? <Tag color="green">达标</Tag> : <Tag color="red">未达标</Tag>
          )} />
          <Table.Column title="应发提成" dataIndex="totalCommission" render={(v: number) => `¥${Number(v || 0).toFixed(1)}`} />
          <Table.Column title="罚后提成" dataIndex="commissionAfter" render={(v: number, r: any) => (
            <Text strong style={{ color: r.bridgeMet ? '#cf1322' : '#fa541c' }}>¥{Number(v || 0).toFixed(1)}</Text>
          )} />
          <Table.Column title="底薪（月）" dataIndex="baseSalaryYuan" render={() => `¥${Number(s?.baseSalaryYuan ?? 0).toFixed(1)}`} />
          <Table.Column title="罚后底薪" dataIndex="salaryAfter" render={(v: number, r: any) => (
            <Text strong style={{ color: r.bridgeMet ? undefined : '#fa541c' }}>¥{Number(v || 0).toFixed(1)}</Text>
          )} />
        </Table>
      </Card>
    </div>
  );
};

export default CsCommissionTodayPage;
