// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Tabs,
  Tag,
  Typography,
  Space,
  message,
  Row,
  Col,
  Statistic,
  Card,
} from 'antd';
import { expenseReportsApi } from '../../api/expenses';

const { Text } = Typography;

const reviewStatusConfig: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'orange', label: '待审核' },
  APPROVED: { color: 'green', label: '已通过' },
  REJECTED: { color: 'red', label: '已驳回' },
};

const formatDateShort = (iso: string): string => {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('zh-CN');
};

const ExpenseApproval: React.FC = () => {
  const [reports, setReports] = useState<any[]>([]);
  const [reportFilter, setReportFilter] = useState<string>('');
  const [summary, setSummary] = useState<any>(null);
  const [reportsLoading, setReportsLoading] = useState(false);

  const fetchReports = useCallback(async () => {
    setReportsLoading(true);
    try {
      const { data } = await expenseReportsApi.list({
        status: reportFilter || undefined,
      });
      setReports(data.data ?? []);
    } catch {
      message.error('加载报账记录失败');
    } finally {
      setReportsLoading(false);
    }
  }, [reportFilter]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    expenseReportsApi
      .monthlySummary()
      .then(({ data }) => setSummary(data.data))
      .catch(() => {});
  }, []);

  const handleReview = async (id: string, status: string) => {
    try {
      await expenseReportsApi.review(id, status);
      message.success(status === 'APPROVED' ? '已通过' : '已驳回');
      fetchReports();
    } catch {
      message.error('操作失败');
    }
  };

  return (
    <Card title="报账与财务" style={{ marginTop: 16 }}>
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}>
          <Statistic title="本月报账" value={`¥${(summary?.totalExpense ?? 0).toFixed(2)}`} />
        </Col>
        <Col span={6}>
          <Statistic
            title="已通过"
            value={`¥${((summary?.totalExpense ?? 0) + (summary?.totalWithdraw ?? 0)).toFixed(2)}`}
            valueStyle={{ color: '#3f8600' }}
          />
        </Col>
        <Col span={6}>
          <Statistic title="待审核" value={`${summary?.pendingCount ?? 0}笔`} valueStyle={{ color: '#faad14' }} />
        </Col>
        <Col span={6}>
          <Statistic
            title="已驳回"
            value={`${summary?.rejectedCount ?? 0}笔`}
            valueStyle={{ color: '#cf1322' }}
          />
        </Col>
      </Row>

      <Tabs
        activeKey={reportFilter}
        onChange={setReportFilter}
        items={[
          { key: '', label: '全部' },
          { key: 'PENDING', label: '待审核' },
          { key: 'APPROVED', label: '已通过' },
          { key: 'REJECTED', label: '已驳回' },
        ]}
      />
      <Table
        dataSource={reports}
        rowKey="id"
        size="small"
        loading={reportsLoading}
        locale={{ emptyText: '暂无报账申请' }}
        pagination={{
          pageSize: 10,
          showTotal: (total) => `共 ${total} 条`,
        }}
      >
        <Table.Column title="报账人" dataIndex={['companion', 'user', 'username']} />
        <Table.Column title="类型" dataIndex="type" render={(t: string) => (t === 'EXPENSE' ? '报账' : '支取')} />
        <Table.Column title="金额" dataIndex="amount" render={(v: number) => `¥${v.toFixed(2)}`} />
        <Table.Column title="备注" dataIndex="description" ellipsis render={(v: string) => v || '-'} />
        <Table.Column
          title="状态"
          dataIndex="status"
          render={(s: string) => {
            const cfg = reviewStatusConfig[s];
            return <Tag color={cfg?.color}>{cfg?.label ?? s}</Tag>;
          }}
        />
        <Table.Column title="日期" dataIndex="createdAt" render={(d: string) => formatDateShort(d)} />
        <Table.Column
          title="操作"
          render={(_: any, r: any) =>
            r.status === 'PENDING' ? (
              <Space>
                <Button size="small" type="primary" onClick={() => handleReview(r.id, 'APPROVED')}>
                  通过
                </Button>
                <Button size="small" danger onClick={() => handleReview(r.id, 'REJECTED')}>
                  驳回
                </Button>
              </Space>
            ) : (
              <Text type="secondary">-</Text>
            )
          }
        />
      </Table>
    </Card>
  );
};

export default ExpenseApproval;
