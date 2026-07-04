import React, { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Button, Tag, Typography, Modal, InputNumber, Table, message, Spin, Statistic } from 'antd';
import {
  WalletOutlined,
  BankOutlined,
  SwapOutlined,
  LockOutlined,
} from '@ant-design/icons';

const { Text, Title } = Typography;

const WalletPage: React.FC = () => {
  const [wallet, setWallet] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [withdrawVisible, setWithdrawVisible] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState<number>(0);
  const [withdrawing, setWithdrawing] = useState(false);

  const fetchWallet = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.electronAPI.apiRequest({ method: 'GET', url: '/companions/me/wallet' });
      if (res.code === 200) setWallet(res.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchWallet(); }, [fetchWallet]);

  const handleWithdraw = async () => {
    if (withdrawAmount <= 0) { message.warning('请输入有效金额'); return; }
    setWithdrawing(true);
    try {
      const res = await window.electronAPI.apiRequest({
        method: 'POST',
        url: '/companions/me/withdraw',
        body: { amount: withdrawAmount },
      });
      if (res.code === 200) {
        message.success('支取申请已提交');
        setWithdrawVisible(false);
        setWithdrawAmount(0);
        fetchWallet();
      } else {
        message.error(res.message || '申请失败');
      }
    } catch { message.error('网络错误'); }
    finally { setWithdrawing(false); }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#64748B' }}>加载中...</div>;
  }

  return (
    <div>
      <Title level={4} style={{ color: '#E2E8F0' }}>💰 我的钱包</Title>

      <Row gutter={[12, 12]}>
        <Col span={6}>
          <Card size="small" style={{ borderLeft: '3px solid #1677ff', textAlign: 'center', background: '#1E293B' }}>
            <Statistic
              title={<span style={{ color: '#E2E8F0' }}>总账户</span>}
              value={`¥${((wallet?.balance ?? 0) + (wallet?.deposit ?? 0)).toFixed(2)}`}
              prefix={<WalletOutlined />}
              valueStyle={{ color: '#E2E8F0', fontSize: 20 }}
            />
            <Text style={{ color: '#94A3B8', fontSize: 11 }}>
              余额 ¥{wallet?.balance?.toFixed(2) ?? '0.00'} + 押金 ¥{wallet?.deposit?.toFixed(2) ?? '0.00'}
            </Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderLeft: '3px solid #52c41a', textAlign: 'center', background: '#1E293B' }}>
            <Statistic
              title={<span style={{ color: '#E2E8F0' }}>押金</span>}
              value={`¥${wallet?.deposit?.toFixed(2) ?? '0.00'}`}
              prefix={<BankOutlined />}
              valueStyle={{ color: '#E2E8F0', fontSize: 20 }}
            />
            <Text style={{ color: '#94A3B8', fontSize: 11 }}>已缴纳押金</Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderLeft: '3px solid #faad14', textAlign: 'center', background: '#1E293B' }}>
            <Statistic
              title={<span style={{ color: '#E2E8F0' }}>可支取</span>}
              value={`¥${wallet?.withdrawable?.toFixed(2) ?? '0.00'}`}
              prefix={<SwapOutlined />}
              valueStyle={{ color: wallet?.withdrawable > 0 ? '#faad14' : '#94A3B8', fontSize: 20 }}
            />
            <Text style={{ color: '#94A3B8', fontSize: 11 }}>
              月流水 ¥{wallet?.monthlyRevenue?.toFixed(2) ?? '0.00'}
            </Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderLeft: '3px solid #ff4d4f', textAlign: 'center', background: '#1E293B' }}>
            <Statistic
              title={<span style={{ color: '#E2E8F0' }}>冻结中</span>}
              value={`¥${wallet?.frozen?.toFixed(2) ?? '0.00'}`}
              prefix={<LockOutlined />}
              valueStyle={{ color: '#E2E8F0', fontSize: 20 }}
            />
            <Text style={{ color: '#94A3B8', fontSize: 11 }}>暂不可用</Text>
          </Card>
        </Col>
      </Row>

      <div style={{ marginTop: 12, textAlign: 'right' }}>
        <Button type="primary" icon={<SwapOutlined />} onClick={() => setWithdrawVisible(true)}>
          申请支取
        </Button>
      </div>

      <Text style={{ display: 'block', marginTop: 8, color: '#94A3B8', fontSize: 11 }}>
        冻结说明：存单未打部分对应提成暂冻结
      </Text>

      {/* Transaction history */}
      <Card title="交易明细" size="small" style={{ marginTop: 16, background: '#1E293B' }}>
        <Table
          dataSource={wallet?.transactions ?? []}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: '暂无交易记录' }}
        >
          <Table.Column title="类型" dataIndex="type" width={80}
            render={(t: string) => {
              const labels: Record<string, { color: string; text: string }> = {
                DEPOSIT: { color: 'blue', text: '充值' },
                WITHDRAW: { color: 'orange', text: '支取' },
                FREEZE: { color: 'red', text: '冻结' },
                UNFREEZE: { color: 'green', text: '解冻' },
                SETTLEMENT: { color: 'purple', text: '结算' },
              };
              return <Tag color={labels[t]?.color}>{labels[t]?.text ?? t}</Tag>;
            }} />
          <Table.Column title="金额" dataIndex="amount" width={90}
            render={(v: number) => <Text strong style={{ color: '#FF6B9D' }}>¥{v.toFixed(2)}</Text>} />
          <Table.Column title="状态" dataIndex="status" width={80}
            render={(s: string) => {
              const m: Record<string, { color: string; label: string }> = {
                PENDING: { color: 'orange', label: '待审核' },
                APPROVED: { color: 'green', label: '已通过' },
                REJECTED: { color: 'red', label: '已驳回' },
              };
              return <Tag color={m[s]?.color}>{m[s]?.label ?? s}</Tag>;
            }} />
          <Table.Column title="时间" dataIndex="createdAt" width={150}
            render={(d: string) => new Date(d).toLocaleString('zh-CN')} />
          <Table.Column title="备注" dataIndex="note" ellipsis
            render={(v: string) => v || '-'} />
        </Table>
      </Card>

      {/* Withdraw Modal */}
      <Modal
        title="申请支取"
        open={withdrawVisible}
        onOk={handleWithdraw}
        onCancel={() => { setWithdrawVisible(false); setWithdrawAmount(0); }}
        confirmLoading={withdrawing}
        okText="提交申请"
        cancelText="取消"
      >
        <div style={{ marginBottom: 16 }}>
          <Text style={{ color: '#E2E8F0' }}>可支取金额：</Text>
          <Text strong style={{ color: '#faad14', fontSize: 18 }}>
            ¥{wallet?.withdrawable?.toFixed(2) ?? '0.00'}
          </Text>
        </div>
        <div>
          <Text style={{ color: '#E2E8F0' }}>支取金额：</Text>
          <InputNumber
            style={{ width: '100%', marginTop: 8 }}
            min={0}
            max={wallet?.withdrawable ?? 0}
            value={withdrawAmount}
            onChange={(v) => setWithdrawAmount(v ?? 0)}
            placeholder="请输入支取金额"
            addonAfter="元"
          />
        </div>
      </Modal>
    </div>
  );
};

export default WalletPage;
