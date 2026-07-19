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
  Card,
} from 'antd';
import { billingApi } from '../../api/billing';

const { Text } = Typography;

const reviewStatusConfig: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'orange', label: '待审核' },
  APPROVED: { color: 'green', label: '已通过' },
  REJECTED: { color: 'red', label: '已驳回' },
};

const OverviewPanel: React.FC = () => {
  const [walletTxns, setWalletTxns] = useState<any[]>([]);
  const [walletTxnsLoading, setWalletTxnsLoading] = useState(false);
  const [walletTxnsFilter, setWalletTxnsFilter] = useState<string>('');

  const fetchWalletTxns = useCallback(async () => {
    setWalletTxnsLoading(true);
    try {
      const { data } = await billingApi.walletTransactions({
        status: walletTxnsFilter || undefined,
      });
      setWalletTxns(data.data ?? []);
    } catch {
      message.error('加载钱包交易失败');
    } finally {
      setWalletTxnsLoading(false);
    }
  }, [walletTxnsFilter]);

  useEffect(() => {
    fetchWalletTxns();
  }, [fetchWalletTxns]);

  const handleWalletReview = async (id: string, status: string) => {
    try {
      await billingApi.reviewWalletTransaction(id, status);
      message.success(status === 'APPROVED' ? '已通过' : '已驳回');
      fetchWalletTxns();
    } catch {
      message.error('操作失败');
    }
  };

  return (
    <Card title="钱包审核" style={{ marginTop: 16 }}>
      <Tabs
        activeKey={walletTxnsFilter}
        onChange={setWalletTxnsFilter}
        items={[
          { key: '', label: '全部' },
          { key: 'PENDING', label: '待审核' },
          { key: 'APPROVED', label: '已通过' },
          { key: 'REJECTED', label: '已驳回' },
        ]}
      />
      <Table
        dataSource={walletTxns}
        rowKey="id"
        size="small"
        loading={walletTxnsLoading}
        locale={{ emptyText: '暂无钱包交易记录' }}
        pagination={{
          pageSize: 10,
          showTotal: (total) => `共 ${total} 条`,
        }}
      >
        <Table.Column title="陪玩" dataIndex={['companion', 'user', 'username']} width={100} />
        <Table.Column
          title="类型"
          dataIndex="type"
          width={90}
          render={(t: string) => {
            const labels: Record<string, { color: string; text: string }> = {
              DEPOSIT: { color: 'blue', text: '充值' },
              WITHDRAW: { color: 'orange', text: '支取' },
              FREEZE: { color: 'red', text: '冻结' },
              UNFREEZE: { color: 'green', text: '解冻' },
              SETTLEMENT: { color: 'purple', text: '结算' },
            };
            return <Tag color={labels[t]?.color}>{labels[t]?.text ?? t}</Tag>;
          }}
        />
        <Table.Column
          title="金额"
          dataIndex="amount"
          width={90}
          render={(v: number) => (
            <Text strong style={{ color: '#cf1322' }}>
              ¥{v.toFixed(2)}
            </Text>
          )}
        />
        <Table.Column
          title="状态"
          dataIndex="status"
          width={90}
          render={(s: string) => {
            const cfg = reviewStatusConfig[s];
            return <Tag color={cfg?.color}>{cfg?.label ?? s}</Tag>;
          }}
        />
        <Table.Column
          title="日期"
          dataIndex="createdAt"
          width={160}
          render={(d: string) => new Date(d).toLocaleString('zh-CN')}
        />
        <Table.Column title="备注" dataIndex="note" ellipsis render={(v: string) => v || '-'} />
        <Table.Column
          title="操作"
          render={(_: any, r: any) =>
            r.status === 'PENDING' ? (
              <Space>
                <Button size="small" type="primary" onClick={() => handleWalletReview(r.id, 'APPROVED')}>
                  通过
                </Button>
                <Button size="small" danger onClick={() => handleWalletReview(r.id, 'REJECTED')}>
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

export default OverviewPanel;
