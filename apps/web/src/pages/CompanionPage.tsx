import React, { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Button, Typography, Tag, Progress, Spin, Space, Modal, InputNumber, Table, message, Statistic } from 'antd';
import { DollarOutlined, ClockCircleOutlined, ThunderboltOutlined, PlayCircleOutlined, SearchOutlined, CoffeeOutlined, WalletOutlined, BankOutlined, SwapOutlined, LockOutlined } from '@ant-design/icons';
import { companionsApi } from '../api/companions';
import { useAuthStore } from '../stores/authStore';

const { Text, Title } = Typography;

const IconDollar = React.createElement(DollarOutlined);
const IconClock = React.createElement(ClockCircleOutlined);
const IconThunder = React.createElement(ThunderboltOutlined);
const IconPlay = React.createElement(PlayCircleOutlined);
const IconSearch = React.createElement(SearchOutlined);
const IconCoffee = React.createElement(CoffeeOutlined);
const IconWallet = React.createElement(WalletOutlined);
const IconBank = React.createElement(BankOutlined);
const IconSwap = React.createElement(SwapOutlined);
const IconLock = React.createElement(LockOutlined);

const StatBlock: React.FC<{ label: string; value: string | number; icon: React.ReactNode; color: string }> =
  ({ label, value, icon, color }) => (
    <Card size="small" style={{ borderLeft: `3px solid ${color}`, textAlign: 'center' }}>
      <div style={{ fontSize: 24, color, opacity: 0.5, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
    </Card>
  );

const CompanionPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Wallet state
  const [wallet, setWallet] = useState<any>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [withdrawVisible, setWithdrawVisible] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState<number>(0);
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await companionsApi.workbench();
      setData(res.data);
    } catch (e) {
      console.error('Workbench fetch error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWallet = useCallback(async () => {
    setWalletLoading(true);
    try {
      const { data: res } = await companionsApi.wallet();
      setWallet(res.data);
    } catch (e) {
      console.error('Wallet fetch error', e);
    } finally {
      setWalletLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); fetchWallet(); }, [fetchData, fetchWallet]);

  const handleWithdraw = async () => {
    if (withdrawAmount <= 0) {
      message.warning('请输入有效金额');
      return;
    }
    setWithdrawSubmitting(true);
    try {
      await companionsApi.requestWithdraw(withdrawAmount);
      message.success('支取申请已提交');
      setWithdrawVisible(false);
      setWithdrawAmount(0);
      fetchWallet();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '申请失败';
      message.error(msg);
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  const [blockedModal, setBlockedModal] = useState<any>(null);

  const switchStatus = async (status: string) => {
    try {
      const { data: res } = await companionsApi.updateStatus(user?.companionId ?? '', status);
      if (res.data?.blocked) { setBlockedModal(res.data); return; }
      fetchData();
    } catch { /* ignore */ }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!data) return <Text type="secondary">加载失败</Text>;

  const unlockPct = Math.min(Math.round((data.todayRevenue / data.unlockThreshold) * 100), 100);
  const freePct = Math.min(Math.round((data.todayRevenue / data.freeThreshold) * 100), 100);

  return (
    <div>
      <Title level={4}>👤 我的工作台</Title>

      <Row gutter={[16, 16]}>
        <Col span={6}>
          <StatBlock label="今日流水" value={`¥${data.todayRevenue}`} icon={IconDollar} color="#1677ff" />
        </Col>
        <Col span={6}>
          <StatBlock label="解锁门槛" value={data.isUnlocked ? '✅ 已解锁' : `¥${data.unlockThreshold}`}
            icon={IconThunder} color={data.isUnlocked ? '#52c41a' : '#faad14'} />
        </Col>
        <Col span={6}>
          <StatBlock label="娱乐计时" value={`${data.entertainmentMinutes}分钟`}
            icon={IconClock} color="#eb2f96" />
        </Col>
        <Col span={6}>
          <StatBlock label="暂扣费用" value={`¥${data.entertainmentFee}`}
            icon={IconDollar} color="#ff4d4f" />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={16}>
          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Card size="small">
                <Text>🎯 流水解锁进度：¥{data.todayRevenue} / ¥{data.unlockThreshold}</Text>
                <Progress percent={unlockPct} status={data.isUnlocked ? 'success' : 'active'} />
                <Text type="secondary">{data.isUnlocked ? '订单池已解锁 ✅' : `还差 ¥${data.unlockThreshold - data.todayRevenue} 解锁订单池`}</Text>
              </Card>
            </Col>
            <Col span={12}>
              <Card size="small">
                <Text>🎯 免单门槛：¥{data.freeThreshold}</Text>
                <Progress percent={freePct} status={data.todayRevenue >= data.freeThreshold ? 'success' : 'active'} strokeColor="#eb2f96" />
                <Text type="secondary">还差 ¥{Math.max(0, data.freeThreshold - data.todayRevenue)} 免娱乐费</Text>
              </Card>
            </Col>
          </Row>
          <Row gutter={16} style={{ marginTop: 16 }}>
            {(['entertainment', 'idle', 'work', 'rest'] as const).map(mode => {
              const labels = { entertainment: '🎮娱乐', idle: '💼空闲', work: '🔴接单', rest: '🛏️休息' };
              return (
                <Col span={6} key={mode}>
                  <Card size="small" style={{ textAlign: 'center' }}>
                    <Text type="secondary">{labels[mode]}</Text>
                    <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{data.statusDurations?.[mode] ?? '00:00'}</div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        </Col>
        <Col span={8}>
          <Card size="small" style={{ textAlign: 'center', marginBottom: 16 }}>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Button type="default" icon={IconPlay} size="large" onClick={() => switchStatus('IDLE')} block>娱乐中</Button>
              <Button type="primary" icon={IconSearch} size="large" onClick={() => switchStatus('ONLINE')} block>等单中</Button>
              <Button type="default" icon={IconCoffee} size="large" onClick={() => switchStatus('OFFLINE')} block>休息中</Button>
            </Space>
          </Card>
          <Card title="在线陪玩" size="small">
            {data.onlineCompanions?.map((c: any) => (
              <Tag key={c.id} color={c.status === 'BUSY' ? 'red' : 'green'} style={{ marginBottom: 8, padding: '4px 12px', fontSize: 14 }}>
                {c.user?.username} {c.status === 'BUSY' ? '接单中' : '等单中'}
              </Tag>
            ))}
            {(!data.onlineCompanions || data.onlineCompanions.length === 0) && <Text type="secondary">暂无在线陪玩</Text>}
          </Card>
        </Col>
      </Row>

      {/* Wallet */}
      <Title level={4} style={{ marginTop: 24 }}>💰 我的钱包</Title>
      <Spin spinning={walletLoading}>
        {wallet && (
          <>
            <Row gutter={[16, 16]}>
              <Col span={6}>
                <Card size="small" style={{ borderLeft: '3px solid #1677ff', textAlign: 'center' }}>
                  <Statistic
                    title="总账户"
                    value={`¥${((wallet.balance ?? 0) + (wallet.deposit ?? 0)).toFixed(2)}`}
                    prefix={IconWallet}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>余额 ¥{wallet.balance?.toFixed(2) ?? '0.00'} + 押金 ¥{wallet.deposit?.toFixed(2) ?? '0.00'}</Text>
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small" style={{ borderLeft: '3px solid #52c41a', textAlign: 'center' }}>
                  <Statistic
                    title="押金"
                    value={`¥${wallet.deposit?.toFixed(2) ?? '0.00'}`}
                    prefix={IconBank}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>已缴纳押金</Text>
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small" style={{ borderLeft: '3px solid #faad14', textAlign: 'center' }}>
                  <Statistic
                    title="可支取"
                    value={`¥${wallet.withdrawable?.toFixed(2) ?? '0.00'}`}
                    prefix={IconSwap}
                    valueStyle={{ color: wallet.withdrawable > 0 ? '#faad14' : '#999' }}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    月流水 ¥{wallet.monthlyRevenue?.toFixed(2) ?? '0.00'}
                  </Text>
                </Card>
              </Col>
              <Col span={6}>
                <Card size="small" style={{ borderLeft: '3px solid #ff4d4f', textAlign: 'center' }}>
                  <Statistic
                    title="冻结中"
                    value={`¥${wallet.frozen?.toFixed(2) ?? '0.00'}`}
                    prefix={IconLock}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>暂不可用</Text>
                </Card>
              </Col>
            </Row>

            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <Button type="primary" icon={IconSwap} onClick={() => setWithdrawVisible(true)}>
                申请支取
              </Button>
            </div>

            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              冻结说明：存单未打部分对应提成暂冻结
            </Text>

            {/* Wallet transaction history */}
            <Card title="钱包明细" size="small" style={{ marginTop: 16 }}>
              <Table
                dataSource={wallet.transactions ?? []}
                rowKey="id"
                size="small"
                pagination={{ pageSize: 10 }}
                locale={{ emptyText: '暂无交易记录' }}
              >
                <Table.Column title="类型" dataIndex="type" width={100}
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
                <Table.Column title="金额" dataIndex="amount" width={100}
                  render={(v: number) => <Text strong style={{ color: '#cf1322' }}>¥{v.toFixed(2)}</Text>} />
                <Table.Column title="变动前" dataIndex="balanceBefore" width={100}
                  render={(v: number) => `¥${v?.toFixed(2) ?? '0.00'}`} />
                <Table.Column title="变动后" dataIndex="balanceAfter" width={100}
                  render={(v: number) => `¥${v?.toFixed(2) ?? '0.00'}`} />
                <Table.Column title="状态" dataIndex="status" width={90}
                  render={(s: string) => {
                    const m: Record<string, { color: string; label: string }> = {
                      PENDING: { color: 'orange', label: '待审核' },
                      APPROVED: { color: 'green', label: '已通过' },
                      REJECTED: { color: 'red', label: '已驳回' },
                    };
                    return <Tag color={m[s]?.color}>{m[s]?.label ?? s}</Tag>;
                  }} />
                <Table.Column title="时间" dataIndex="createdAt" width={160}
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
              confirmLoading={withdrawSubmitting}
              okText="提交申请"
              cancelText="取消"
            >
              <div style={{ marginBottom: 16 }}>
                <Text>可支取金额：</Text>
                <Text strong style={{ color: '#faad14', fontSize: 18 }}>
                  ¥{wallet.withdrawable?.toFixed(2) ?? '0.00'}
                </Text>
              </div>
              <div>
                <Text>支取金额：</Text>
                <InputNumber
                  style={{ width: '100%', marginTop: 8 }}
                  min={0}
                  max={wallet.withdrawable ?? 0}
                  value={withdrawAmount}
                  onChange={(v) => setWithdrawAmount(v ?? 0)}
                  placeholder="请输入支取金额"
                  addonAfter="元"
                />
              </div>
            </Modal>
          </>
        )}
      </Spin>

      {/* Blocked — entertainment mode threshold check */}
      <Modal title="⚠️ 无法切换娱乐模式" open={!!blockedModal} onCancel={() => setBlockedModal(null)} footer={null}>
        <div style={{ lineHeight: 2.2 }}>
          <p>您当前不满足娱乐模式的开启条件：</p>
          <div style={{ background: '#fff7e6', borderRadius: 8, padding: 12, marginTop: 8 }}>
            <div>💰 押金：<Text strong style={{ color: blockedModal?.deposit >= (blockedModal?.depositThreshold||0) ? '#52c41a' : '#ff4d4f' }}>¥{blockedModal?.deposit?.toFixed(2)}</Text> / 需要 ¥{blockedModal?.depositThreshold}</div>
            <div>📊 月流水：<Text strong style={{ color: blockedModal?.revenue >= (blockedModal?.revenueThreshold||0) ? '#52c41a' : '#ff4d4f' }}>¥{blockedModal?.revenue?.toFixed(2)}</Text> / 需要 ¥{blockedModal?.revenueThreshold}</div>
          </div>
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Button type="primary" onClick={() => setBlockedModal(null)}>知道了</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default CompanionPage;
