import React, { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Button, Typography, Tag, Progress, Spin, Space, Modal, InputNumber, Input, Table, message, Statistic, Tooltip, Empty } from 'antd';
import { DollarOutlined, ClockCircleOutlined, ThunderboltOutlined, PlayCircleOutlined, SearchOutlined, CoffeeOutlined, WalletOutlined, BankOutlined, SwapOutlined, LockOutlined, HourglassOutlined, InfoCircleOutlined, TeamOutlined, ReloadOutlined } from '@ant-design/icons';
import { companionsApi } from '../api/companions';
import { customersApi } from '../api/customers';
import { useAuthStore } from '../stores/authStore';
import { companionStatusConfig } from '../constants';

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
const IconHourglass = React.createElement(HourglassOutlined);
const IconInfo = React.createElement(InfoCircleOutlined);

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

  const fetchMyCustomers = useCallback(async () => {
    if (!user?.companionId) return;
    setCustomersLoading(true);
    try {
      const { data: res } = await customersApi.list();
      setMyCustomers(res.data || []);
    } catch (e) {
      console.error('Customers fetch error', e);
    } finally {
      setCustomersLoading(false);
    }
  }, [user?.companionId]);

  useEffect(() => { fetchData(); fetchWallet(); fetchMyCustomers(); const t = setInterval(() => { fetchData(); fetchWallet(); }, 30_000); return () => clearInterval(t); }, [fetchData, fetchWallet, fetchMyCustomers]);

  // Auto-refresh when tab becomes visible (catches data changes from admin panel / Electron)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') { fetchData(); fetchWallet(); fetchMyCustomers(); } };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [fetchData, fetchWallet, fetchMyCustomers]);

  // Auto-set AVAILABLE on first load if currently OFFLINE
  useEffect(() => {
    if (data?.currentStatus === 'OFFLINE' && user?.companionId) {
      switchStatus('AVAILABLE');
    }
  }, [data?.currentStatus]);

  const handleWithdraw = async () => {
    if (withdrawAmount <= 0) { message.warning('请输入有效金额'); return; }
    setWithdrawSubmitting(true);
    try {
      await companionsApi.requestWithdraw(withdrawAmount);
      message.success('支取申请已提交');
      setWithdrawVisible(false);
      setWithdrawAmount(0);
      fetchWallet();
      fetchData();
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || '申请失败');
    } finally { setWithdrawSubmitting(false); }
  };

  const [blockedModal, setBlockedModal] = useState<any>(null);
  // Boot guide modal (TASK-06)
  const [bootGuideVisible, setBootGuideVisible] = useState(false);
  // No-customer proof modal (TASK-08)
  const [proofVisible, setProofVisible] = useState(false);
  const [proofNote, setProofNote] = useState('');
  const [proofSubmitting, setProofSubmitting] = useState(false);
  // Customer follow-up tracking
  const [myCustomers, setMyCustomers] = useState<any[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const entertainmentThreshold = data?.entertainmentThreshold ?? 200;
  const belowEntertainment = data ? (data.todayRevenue < entertainmentThreshold) : true;

  // Listen for boot guide from Electron (TASK-06)
  useEffect(() => {
    const handler = () => {
      if (!sessionStorage.getItem('bootGuideShown')) {
        setBootGuideVisible(true);
        sessionStorage.setItem('bootGuideShown', '1');
      }
    };
    if ((window as any).electronAPI?.onBootGuide) {
      (window as any).electronAPI.onBootGuide(handler);
    }
    // Also listen for the raw IPC message
    const ipcHandler = (e: MessageEvent) => {
      if (e.data === 'nav:bootGuide') handler();
    };
    window.addEventListener('message', ipcHandler);
    return () => window.removeEventListener('message', ipcHandler);
  }, []);

  // TASK-11: Dual companion request
  const requestDual = async () => {
    try {
      await companionsApi.requestDualCompanion();
      message.success('已向工作室发送双陪请求，等待其他陪玩响应');
    } catch (err: any) {
      message.error(err?.response?.data?.message || '请求失败');
    }
  };

  const handleProofSubmit = async () => {
    if (!proofNote.trim()) { message.warning('请填写申请说明'); return; }
    setProofSubmitting(true);
    try {
      await companionsApi.requestProofNoCustomer(proofNote);
      message.success('解锁申请已提交，请等待管理员审核');
      setProofVisible(false);
      setProofNote('');
    } catch (err: any) {
      message.error(err?.response?.data?.message || '提交失败');
    } finally { setProofSubmitting(false); }
  };

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>👤 我的工作台</Title>
        <Button size="small" onClick={() => { fetchData(); fetchWallet(); fetchMyCustomers(); }} icon={React.createElement(ReloadOutlined)}>刷新数据</Button>
      </div>
      <Row gutter={[16, 16]}>
        <Col span={6}><StatBlock label="今日流水" value={`¥${data.todayRevenue}`} icon={IconDollar} color="#1677ff" /></Col>
        <Col span={6}><StatBlock label="解锁门槛" value={data.isUnlocked ? '✅ 已解锁' : `¥${data.unlockThreshold}`} icon={IconThunder} color={data.isUnlocked ? '#52c41a' : '#faad14'} /></Col>
        <Col span={6}><StatBlock label="娱乐计时" value={`${data.entertainmentMinutes}分钟`} icon={IconClock} color="#eb2f96" /></Col>
        <Col span={6}><StatBlock label="暂扣费用" value={`¥${data.entertainmentFee}`} icon={IconDollar} color="#ff4d4f" /></Col>
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
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>当前状态</Text>
              <div style={{ marginTop: 4 }}>
                <Tag color={companionStatusConfig[data.currentStatus]?.color || 'default'} style={{ fontSize: 18, padding: '4px 24px', borderRadius: 12 }}>
                  {companionStatusConfig[data.currentStatus]?.label || data.currentStatus}
                </Tag>
              </div>
            </div>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Tooltip title={belowEntertainment ? `今日流水 ¥${data.todayRevenue}，达标 ¥${entertainmentThreshold} 后可切换` : undefined}>
                <Button type="default" icon={IconPlay} size="large" onClick={() => switchStatus('ENTERTAINMENT')} block disabled={belowEntertainment}>切换为娱乐中{belowEntertainment ? ` (还差¥${entertainmentThreshold - data.todayRevenue})` : ''}</Button>
              </Tooltip>
              <Button type="primary" icon={IconSearch} size="large" onClick={() => switchStatus('AVAILABLE')} block>切换为空闲</Button>
              <Button type="default" icon={IconThunder} size="large" onClick={() => switchStatus('BUSY')} block>切换为接单中</Button>
              <Button type="default" icon={IconCoffee} size="large" onClick={() => switchStatus('RESTING')} block>切换为休息中</Button>
              <div style={{ borderTop: '1px dashed #d9d9d9', paddingTop: 8, marginTop: 4 }}>
                <Button type="dashed" icon={React.createElement(TeamOutlined)} size="middle" onClick={requestDual} block>🤝 请求双陪</Button>
              </div>
            </Space>
          </Card>
          <Card title="在线陪玩" size="small">
            {data.onlineCompanions?.map((c: any) => (
              <Tag key={c.id} color={companionStatusConfig[c.status]?.color || 'default'} style={{ marginBottom: 8, padding: '4px 12px', fontSize: 14 }}>
                {c.user?.username} {companionStatusConfig[c.status]?.label || c.status}
              </Tag>
            ))}
            {(!data.onlineCompanions || data.onlineCompanions.length === 0) && <Text type="secondary">暂无在线陪玩</Text>}
          </Card>
        </Col>
      </Row>

      <Title level={4} style={{ marginTop: 24 }}>📊 分账模式</Title>
      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Card size="small">
            {data.tierInfo?.mode === 'FIXED' ? (
              <Text>
                <Text strong>固定分成</Text>
                <Text type="secondary"> · </Text>
                <Text strong style={{ color: '#1677ff', fontSize: 16 }}>{data.tierInfo.companionPct}%</Text>
                <Text type="secondary" style={{ marginLeft: 8 }}>（每笔流水按此比例分账）</Text>
              </Text>
            ) : (
              <Text>
                <Text strong>阶梯分成</Text>
                <Text type="secondary"> · 档位 </Text>
                <Text strong style={{ color: '#1677ff', fontSize: 16 }}>{data.tierInfo?.companionPct ?? '—'}%</Text>
                {data.tierInfo?.monthlyRevenue != null && (
                  <Text type="secondary" style={{ marginLeft: 8 }}>（本月流水 ¥{data.tierInfo.monthlyRevenue}）</Text>
                )}
              </Text>
            )}
          </Card>
        </Col>
      </Row>

      <Title level={4} style={{ marginTop: 24 }}>💰 报账系统</Title>
      <Card size="small" style={{ textAlign: 'center' }}>
        <Row gutter={16}>
          <Col span={8}><Statistic title="总流水" value={`¥${(wallet?.totalRevenue ?? 0).toFixed(2)}`} prefix={IconDollar} /></Col>
          <Col span={8}><Statistic title="可支取" value={`¥${(wallet?.withdrawable ?? 0).toFixed(2)}`} prefix={IconSwap} valueStyle={{ color: (wallet?.withdrawable ?? 0) > 0 ? '#52c41a' : '#999' }} /></Col>
          <Col span={8}><Statistic title="押金" value={`¥${(wallet?.deposit ?? 0).toFixed(2)}`} prefix={IconBank} /></Col>
        </Row>
        <div style={{ marginTop: 16 }}>
          <Button type="primary" icon={IconSwap} onClick={() => { window.location.href = '/companion/billing'; }}>
            进入报账系统（支取记录 / 申请支取）
          </Button>
        </div>
      </Card>

      {/* TASK-10: 我的待跟进客户 */}
      <Spin spinning={customersLoading}>
        <Title level={4} style={{ marginTop: 24 }}>📋 我的待跟进客户</Title>
        {(() => {
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          const pendingCustomers = myCustomers.filter((c: any) => {
            const latestFollowUp = c.followUps?.[0];
            if (!latestFollowUp) return true; // No follow-up ever
            return new Date(latestFollowUp.createdAt) < sevenDaysAgo;
          });

          if (pendingCustomers.length === 0) {
            return (
              <Card size="small">
                <Empty description="暂无待跟进客户" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </Card>
            );
          }

          return (
            <Table
              dataSource={pendingCustomers}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 5 }}
              locale={{ emptyText: '暂无待跟进客户' }}
            >
              <Table.Column title="客户编号" dataIndex="customerCode" width={120} render={(v: string) => <Text code>{v}</Text>} />
              <Table.Column title="微信" dataIndex="wechatId" width={120} render={(v: string) => v || '-'} />
              <Table.Column title="来源" dataIndex="platform" width={80} render={(v: string) => v ? <Tag>{v}</Tag> : '-'} />
              <Table.Column title="最近跟进" width={140} render={(_: any, c: any) => {
                const latest = c.followUps?.[0];
                return latest
                  ? <Tooltip title={latest.content}><Text type="secondary" style={{ fontSize: 12 }}>{new Date(latest.createdAt).toLocaleString('zh-CN')}</Text></Tooltip>
                  : <Tag color="orange">从未跟进</Tag>;
              }} />
              <Table.Column title="状态" dataIndex="status" width={100} render={(s: string) => {
                const statusMap: Record<string, { color: string; label: string }> = {
                  PENDING_DEVELOPMENT: { color: 'blue', label: '待开发' },
                  FOLLOW_UP: { color: 'orange', label: '跟进中' },
                  ACTIVE: { color: 'green', label: '活跃' },
                  LOST: { color: 'default', label: '已流失' },
                };
                const info = statusMap[s] || { color: 'default', label: s };
                return <Tag color={info.color}>{info.label}</Tag>;
              }} />
              <Table.Column title="操作" width={100} render={(_: any, c: any) => (
                <Button type="link" size="small" icon={IconInfo} onClick={() => window.location.href = `/companion/customers/${c.id}`}>
                  跟进
                </Button>
              )} />
            </Table>
          );
        })()}
      </Spin>


      <Modal title="⚠️ 无法切换娱乐模式" open={!!blockedModal} onCancel={() => setBlockedModal(null)} footer={null}>
        <div style={{ lineHeight: 2.2 }}>
          <p>您当前没有未支取的余额，无法开启娱乐模式：</p>
          <div style={{ background: '#fff7e6', borderRadius: 8, padding: 12, marginTop: 8 }}>
            <div>📊 总流水：<Text strong>¥{blockedModal?.totalRevenue?.toFixed(2) ?? '0.00'}</Text></div>
            <div>🔢 可分账金额（{(blockedModal?.totalRevenue > 0 ? Math.round((blockedModal?.withdrawable / blockedModal.totalRevenue) * 100) : 50)}%）：<Text strong>¥{blockedModal?.withdrawable?.toFixed(2) ?? '0.00'}</Text></div>
            <div>💸 已支取：<Text strong>¥{blockedModal?.totalWithdrawn?.toFixed(2) ?? '0.00'}</Text></div>
            <div>🏦 剩余未支取：<Text strong style={{ color: '#ff4d4f' }}>¥{blockedModal?.remaining?.toFixed(2) ?? '0.00'}</Text></div>
            <div style={{ marginTop: 4 }}>💰 账户余额：¥{blockedModal?.totalBalance?.toFixed(2) ?? '0.00'}</div>
          </div>
          <p style={{ marginTop: 12 }}>请支取部分流水后，有剩余未支取余额即可开启娱乐模式。</p>
          <div style={{ marginTop: 16, textAlign: 'center' }}><Button type="primary" onClick={() => setBlockedModal(null)}>知道了</Button></div>
        </div>
      </Modal>

      {/* TASK-06: Boot Guide Modal */}
      <Modal title="📋 开工提醒" open={bootGuideVisible} onCancel={() => setBootGuideVisible(false)} footer={null}>
        <div style={{ lineHeight: 2.2 }}>
          <p>请优先联系你的私域客户，提高成单率！</p>
          <div style={{ background: '#f6ffed', borderRadius: 8, padding: 12, marginTop: 8 }}>
            <p>💡 <Text strong>建议流程：</Text></p>
            <p>① 打开客户管理 → 查看待跟进客户</p>
            <p>② 主动联系客户 → 了解游戏需求</p>
            <p>③ 促成下单 → 获取流水解锁订单池</p>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <Button type="primary" onClick={() => { setBootGuideVisible(false); window.location.href = '/companion/customers'; }}>去客户管理</Button>
            <Button onClick={() => setBootGuideVisible(false)}>稍后提醒</Button>
          </div>
        </div>
      </Modal>

      {/* TASK-08: No-Customer Proof Upload Modal */}
      <Modal title="📝 申请解锁订单池" open={proofVisible} onCancel={() => { setProofVisible(false); setProofNote(''); }} onOk={handleProofSubmit} confirmLoading={proofSubmitting} okText="提交申请" cancelText="取消">
        <div style={{ lineHeight: 2 }}>
          <p><Text type="secondary">如果您确实没有客户资源，可以申请临时解锁订单池权限。请说明情况并上传沟通证明截图（如有）。</Text></p>
          <div style={{ marginTop: 8 }}>
            <Text>申请说明：</Text>
            <Input.TextArea rows={4} value={proofNote} onChange={(e) => setProofNote(e.target.value)} placeholder="请说明您的情况，例如：已尝试联系XX位客户但均未回复..." style={{ marginTop: 4 }} />
          </div>
        </div>
      </Modal>

      {/* TASK-08: Apply unlock button - shown when below threshold */}
      {belowEntertainment && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button type="link" icon={IconLock} onClick={() => setProofVisible(true)}>
            没有客户？申请解锁订单池
          </Button>
        </div>
      )}
    </div>
  );
};

export default CompanionPage;
