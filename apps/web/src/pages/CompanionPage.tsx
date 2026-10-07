// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Typography,
  Tag,
  Spin,
  Space,
  Modal,
  Input,
  Table,
  Tooltip,
} from 'antd';
import { message } from '../utils/feedback';
import {
  PlayCircleOutlined,
  SearchOutlined,
  CoffeeOutlined,
  LockOutlined,
  ReloadOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { companionsApi } from '../api/companions';
import { customersApi } from '../api/customers';
import OrderNotifySettingsPanel from '../components/OrderNotifySettingsPanel';
import { useAuthStore } from '../stores/authStore';
import http from '../api/client';
import { companionStatusConfig } from '../constants';
import { ORDER_FIELD_LABELS } from '../constants/orderFields';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import ErrorBanner from '../components/ErrorBanner';
import PageHeader from '../components/PageHeader';
import MyWorkWechatCard from '../components/MyWorkWechatCard';
import CompanionHomeBoard from '../components/CompanionHomeBoard';
import ExcellenceRuleModal from '../components/ExcellenceRuleModal';
import { visibleInterval } from '../hooks/usePolling';
import { BRAND, SEMANTIC, BORDER } from '../styles/tokens';


const { Text, Title } = Typography;

const IconPlay = React.createElement(PlayCircleOutlined);
const IconSearch = React.createElement(SearchOutlined);
const IconCoffee = React.createElement(CoffeeOutlined);
const IconLock = React.createElement(LockOutlined);

const CompanionPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [ranking, setRanking] = useState<any[]>([]);
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);
  const [rankingLoading, setRankingLoading] = useState(true);
  const [showRule, setShowRule] = useState(false);
  // 陪玩自己的综合分 + 段位（老板 2026-10-04：让陪玩一眼看到自己的分、离下一级还差多少）。
  const [excellence, setExcellence] = useState<any>(null);
  // 首页看板（老板 2026-10-04）：今日名额、我的今日考勤、完整排行榜（原来只取前 5）。
  const [quota, setQuota] = useState<any>(null);
  const [myAttendance, setMyAttendance] = useState<any>(null);
  const [rankingAll, setRankingAll] = useState<any[]>([]);

  const fetchExcellence = useCallback(async () => {
    try {
      const { data: res } = await http.get('/companions/me/excellence');
      setExcellence(res.data || null);
    } catch {
      /* 拉不到就只显示「评分规则」入口，不打扰 */
    }
  }, []);

  const fetchRanking = useCallback(async () => {
    try {
      const { data: res } = await http.get('/companions/ranking?type=revenue');
      const all = res.data || [];
      setRankingAll(all);
      setRanking(all.slice(0, 5));
    } catch {
    } finally {
      setRankingLoading(false);
    }
  }, []);
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

  useEffect(() => {
    fetchData();
    fetchWallet();
    fetchMyCustomers();
    companionsApi
      .todaySessions()
      .then((r: any) => setTodaySessions(r.data?.data || []))
      .catch(() => {});
    companionsApi
      .dormantCustomers()
      .then((r: any) => setDormantCount(r.data?.data?.dormant || 0))
      .catch(() => {});
    fetchRanking();
    fetchExcellence();
    http
      .get('/orders/pool/status')
      .then((r: any) => setQuota(r.data?.data || null))
      .catch(() => {});
    http
      .get('/companions/me/attendance-today')
      .then((r: any) => setMyAttendance(r.data?.data || null))
      .catch(() => {});
    const t = visibleInterval(() => {
      fetchData();
      fetchWallet();
    }, 30_000);
    return () => clearInterval(t);
  }, [fetchData, fetchWallet, fetchMyCustomers, fetchExcellence]);

  // Auto-refresh when tab becomes visible (catches data changes from admin panel / Electron)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchData();
        fetchWallet();
        fetchMyCustomers();
        fetchRanking();
        fetchExcellence();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [fetchData, fetchWallet, fetchMyCustomers, fetchExcellence]);

  // Auto-set AVAILABLE on first load if currently OFFLINE
  useEffect(() => {
    if (data?.currentStatus === 'OFFLINE' && user?.companionId) {
      switchStatus('AVAILABLE');
    }
  }, [data?.currentStatus]);

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
      fetchData();
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || '申请失败');
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  // Boot guide modal (TASK-06)
  const [bootGuideVisible, setBootGuideVisible] = useState(false);
  // Customer follow-up tracking
  const [myCustomers, setMyCustomers] = useState<any[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [todaySessions, setTodaySessions] = useState<any[]>([]);
  const [dormantCount, setDormantCount] = useState(0);
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


  const switchStatus = async (status: string) => {
    try {
      const { data: res } = await companionsApi.updateStatus(user?.companionId ?? '', status);
      if (res.data?.alreadyInStatus) {
        const labels: Record<string, string> = { AVAILABLE: '空闲', BUSY: '接单', ENTERTAINMENT: '娱乐', RESTING: '休息' };
        message.info(`你已经是「${labels[status] || status}」状态，无需重复点击`);
        return;
      }
      (window as any).__showStatusBar?.(status);
      (window as any).electronAPI?.onStatusChanged?.(status);
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '切换失败');
    }
  };

  // 老板 2026-10-08：玩不起就别让他点进去 —— 进去也会被踢回空闲，娱乐/空闲两份名单来回套，
  // python 和三角洲左右都是被杀。口径跟服务端 checkEntertainmentEligibility 完全一致：
  // 免单线到了随便玩；否则看「余额 + 押金」够不够玩满 1 分钟（每分钟价 = 时价 / 60）。
  const entertainmentAffordable =
    !!data?.entertainmentFreeToday ||
    Number(data?.hourlyRate ?? 0) <= 0 ||
    Number(data?.availableFunds ?? 0) * 60 >= Number(data?.hourlyRate ?? 0);
  const entertainmentBlockReason = `余额 + 押金不够玩娱乐（现在 ¥${Number(
    data?.availableFunds ?? 0,
  )}，娱乐 ¥${Number(data?.hourlyRate ?? 0)}/小时，${
    Number(data?.entertainmentThreshold ?? 0) > 0
      ? `今天流水到 ¥${data.entertainmentThreshold} 就免单`
      : '今天流水免单线没开'
  }）—— 先充值或交押金，或者今天多打几单再进。`;

  if (loading) return <LoadingState size="large" minHeight={220} />;
  // 拉不到数据时原来只有一行灰字「加载失败」，既没说清也没法重试 —— 换成统一的报错条（带「重试」）。
  if (!data) {
    return (
      <div>
        <PageHeader title="我的首页" subtitle="今天的状态、待跟进客户和收入都在这一页" />
        <ErrorBanner message="首页数据加载失败" description="点「重试」再拉一次。" onRetry={fetchData} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="我的首页" subtitle="今天的状态、待跟进客户和收入都在这一页" />

      {/* ① Status Header — compact inline */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <a href="/uploads/agent-setup.exe" download style={{ float: 'right', fontSize: 12, color: BRAND.primary }}>
          ⬇ 下载最新版
        </a>
        <Row align="middle" gutter={16}>
          <Col flex="auto">
            <Space size="middle">
              <Text strong style={{ fontSize: 18 }}>
                👤 {user?.username || '陪玩'}{' '}
                <Tag color="cyan" style={{ fontSize: 10 }}>
                  NEW v2.0
                </Tag>
              </Text>
              <Tag
                color={companionStatusConfig[data.currentStatus]?.color || 'default'}
                style={{ fontSize: 16, padding: '4px 16px', borderRadius: 10 }}
              >
                {companionStatusConfig[data.currentStatus]?.label || data.currentStatus}
              </Tag>
              <Text type="secondary">
                今日¥{data.todayRevenue}
                {Number(data.todayDepositPlayed) > 0 ? ` · 存单已打¥${data.todayDepositPlayed}` : ''} · 娱乐
                {data.entertainmentMinutes}min · {data.statusDurations?.entertainment || '00:00'}
              </Text>
              {excellence ? (
                <Tooltip title="点开看完整加分规则 / 离下一级还差多少">
                  <Tag
                    color={excellence.tier === 'TOP' ? 'gold' : excellence.tier === 'LOW' ? 'orange' : 'default'}
                    style={{ cursor: 'pointer', fontSize: 12, margin: 0 }}
                    onClick={() => setShowRule(true)}
                  >
                    {excellence.tier === 'TOP' ? '👑🏇 上等马' : excellence.tier === 'LOW' ? '🐴 下等马' : '🐎 中等马'} · 段位分{' '}
                    {excellence.tierScore ?? excellence.rankScore ?? 0}
                    {excellence.scoreDelta?.hasBaseline && excellence.scoreDelta.delta !== 0 ? (
                      <span
                        style={{
                          marginLeft: 6,
                          fontWeight: 700,
                          color: excellence.scoreDelta.delta > 0 ? '#3f8600' : SEMANTIC.dangerDeep,
                        }}
                      >
                        {excellence.scoreDelta.delta > 0 ? '+' : ''}
                        {excellence.scoreDelta.delta}
                      </span>
                    ) : null}
                  </Tag>
                </Tooltip>
              ) : (
                <Button
                  size="small"
                  type="link"
                  icon={React.createElement(QuestionCircleOutlined)}
                  onClick={() => setShowRule(true)}
                  style={{ padding: 0, fontSize: 12 }}
                >
                  评分规则
                </Button>
              )}
            </Space>
            {dormantCount > 0 && (
              <Tag color="red" style={{ marginLeft: 8 }}>
                ⚠ {dormantCount}位客户超7天未联系
              </Tag>
            )}
          </Col>
          <Col>
            <Space>
              {/* 门槛口径（老板 2026-10-04）：今天到手的钱 = 订单流水 + 打掉的存单 */}
              <Tooltip
                title={
                  !entertainmentAffordable
                    ? entertainmentBlockReason
                    : data.entertainmentFreeToday
                      ? `娱乐随时可进：今天流水 ¥${data.todayRevenue} + 存单已打 ¥${data.todayDepositPlayed ?? 0} = ¥${data.entertainmentBasis ?? 0}，已到 ¥${data.entertainmentThreshold ?? 0} 门槛 → 今天免费`
                      : `娱乐随时可进：今天流水 ¥${data.todayRevenue} + 存单已打 ¥${data.todayDepositPlayed ?? 0} = ¥${data.entertainmentBasis ?? 0}，还没到 ¥${data.entertainmentThreshold ?? 0} → 按 ¥${data.hourlyRate ?? 0}/小时 计费`
                }
              >
                <Button
                  type={data.currentStatus === 'ENTERTAINMENT' ? 'primary' : 'default'}
                  icon={IconPlay}
                  disabled={!entertainmentAffordable}
                  onClick={() => switchStatus('ENTERTAINMENT')}
                >
                  娱乐
                </Button>
              </Tooltip>
              <Button
                type={data.currentStatus === 'AVAILABLE' ? 'primary' : 'default'}
                icon={IconSearch}
                onClick={() => switchStatus('AVAILABLE')}
              >
                空闲
              </Button>
              <Button
                type={data.currentStatus === 'RESTING' ? 'primary' : 'default'}
                icon={IconCoffee}
                onClick={() => switchStatus('RESTING')}
              >
                休息
              </Button>
              <Button
                size="small"
                onClick={() => {
                  fetchData();
                  fetchWallet();
                  fetchMyCustomers();
                }}
                icon={React.createElement(ReloadOutlined)}
              />
              {/* 老板 2026-10-08「他设置里没有关弹窗的地方」——以前只有一颗没字的 🔔，
                  连老板自己都找不到；现在写出「通知设置」，菜单里也挂了一份（设置 → 通知设置）。 */}
              <Tooltip title="订单通知设置（打单中 / 娱乐中弹不弹、全屏打游戏时弹不弹）">
                <Button size="small" onClick={() => setNotifModalOpen(true)}>
                  🔔 通知设置
                </Button>
              </Tooltip>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 📊 我的首页看板：进度条风格，一眼看完自己的流水 / KPI / 客户（老板 2026-10-04） */}
      <CompanionHomeBoard
        workbench={data}
        excellence={excellence}
        quota={quota}
        customers={myCustomers}
        attendance={myAttendance}
      />

      {/* 我的工作微信：陪玩自己填 / 换，管理端审核通过才生效（老板 2026-10-02） */}
      <MyWorkWechatCard />

      {data.tierInfo?.mode === 'TIERED' && (
        <Card size="small" style={{ marginBottom: 12, border: `1px solid ${BORDER.base}` }}>
          <Space size={12} wrap style={{ marginBottom: 8 }}>
            <Text strong>阶梯分成</Text>
            <Tag color="blue">
              本月流水 ¥{Number(data.tierInfo.monthlyRevenue || 0).toFixed(2)}（只算自己那份）
            </Tag>
            <Tag color="gold" style={{ fontSize: 14, fontWeight: 600 }}>
              当前分成 {data.tierInfo.companionPct}%
            </Tag>
            {data.tierInfo.tenureMonths != null && (
              <Tag>工龄 {data.tierInfo.tenureMonths} 个月</Tag>
            )}
            {data.tierInfo.topTierBlocked && (
              <Tag color="orange">未满6个月，最高档暂按 60%</Tag>
            )}
          </Space>
          <Space size={8} wrap>
            {(data.tierInfo.tiers || []).map((t: any, i: number) => {
              const active = Number(t.companion) === Number(data.tierInfo.companionPct);
              const label = t.max == null
                ? `≥${t.min} 元 → 你拿 ${t.companion}%`
                : `${t.min}~${t.max} 元 → 你拿 ${t.companion}%`;
              return (
                <Tag
                  key={i}
                  color={active ? 'gold' : 'default'}
                  style={{ marginInlineEnd: 0, fontWeight: active ? 600 : 400 }}
                >
                  {active ? '⭐ ' : ''}{label}
                </Tag>
              );
            })}
          </Space>
        </Card>
      )}

      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col span={13}>
          <Card size="small" title="订单占比">
            <Row gutter={8}>
              {[
                { title: '📅 今日', stats: data?.todayStats, revenue: data?.todayRevenue },
                { title: '📆 全月', stats: data?.orderStats, revenue: data?.monthRevenue },
              ].map(({ title, stats, revenue }) => {
                const pieData = [
                  { key: 'NEW', name: '首单', color: '#2563EB' },
                  { key: 'RENEW', name: '续单', color: SEMANTIC.success },
                  { key: 'REPURCHASE', name: '复购', color: '#722ed1' },
                  { key: 'TIP', name: '礼物', color: '#fa8c16' },
                ]
                  .map((t) => ({
                    name: t.name,
                    value: stats?.[t.key]?.count || 0,
                    amount: stats?.[t.key]?.amount || 0,
                    color: t.color,
                  }))
                  .filter((d) => d.value > 0);
                return (
                  <Col span={12} key={title} style={{ textAlign: 'center' }}>
                    <Text strong style={{ fontSize: 12 }}>
                      {title} ¥{(revenue || 0).toFixed(0)}
                    </Text>
                    {pieData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={50}
                            innerRadius={25}
                            label={({ name, value, percent, payload }) =>
                              `${name} ${value}单 ¥${payload.amount || 0} ${((percent ?? 0) * 100).toFixed(0)}%`
                            }
                          >
                            {pieData.map((d, i) => (
                              <Cell key={i} fill={d.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <EmptyState description="暂无" />
                    )}
                  </Col>
                );
              })}
            </Row>
            <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11 }}>
              {aiAdvice ? (
                <Text type="secondary">🤖 AI建议：{aiAdvice}</Text>
              ) : (
                <Text
                  type="secondary"
                  onClick={() =>
                    http
                      .post('/ai/advice')
                      .then(({ data }: any) => setAiAdvice(data.data?.advice))
                      .catch(() => {})
                  }
                  style={{ cursor: 'pointer' }}
                >
                  🤖 点击获取AI建议
                </Text>
              )}
            </div>
          </Card>
        </Col>
        <Col span={11}>
          <Card
            size="small"
            title={
              <span>
                🏆 实力排行
                <Text type="secondary" style={{ fontSize: 10, marginLeft: 8 }}>
                  续单×2+复购×3+礼物×2−首单×0.5
                </Text>
              </span>
            }
            loading={rankingLoading}
            style={{ height: '100%' }}
          >
            {ranking.length > 0 ? (
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: '#999', borderBottom: '1px solid #f0f0f0' }}>
                    <th style={{ textAlign: 'left', padding: 2 }}>陪玩</th>
                    <th style={{ padding: 2 }}>流水</th>
                    <th style={{ padding: 2 }}>首单</th>
                    <th style={{ padding: 2 }}>续单</th>
                    <th style={{ padding: 2 }}>复购</th>
                    <th style={{ padding: 2 }}>礼物</th>
                    <th style={{ textAlign: 'right', padding: 2 }}>评分</th>
                  </tr>
                </thead>
                <tbody>
                  {[...ranking]
                    .sort((a: any, b: any) => b.qualityScore - a.qualityScore)
                    .map((r: any, i: number) => (
                      <tr
                        key={r.companionId}
                        style={{ background: r.companionId === user?.companionId ? '#e6f7ff' : 'transparent' }}
                      >
                        <td style={{ padding: 3 }}>
                          {['🥇', '🥈', '🥉'][i] || `${i + 1}`} {r.name?.slice(0, 6)}
                        </td>
                        <td style={{ color: BRAND.primary, fontWeight: 500, textAlign: 'center' }}>
                          ¥{(r.totalAmount || 0).toFixed(0)}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <Tag
                            color={r.newRate > 50 ? 'red' : r.newRate > 30 ? 'orange' : 'default'}
                            style={{ fontSize: 10, margin: 0 }}
                          >
                            {r.newRate || 0}%
                          </Tag>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <Tag color={r.renewRate > 20 ? 'green' : 'default'} style={{ fontSize: 10, margin: 0 }}>
                            {r.renewRate || 0}%
                          </Tag>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <Tag color={r.repurchaseRate > 15 ? 'green' : 'default'} style={{ fontSize: 10, margin: 0 }}>
                            {r.repurchaseRate || 0}%
                          </Tag>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <Tag color={r.tipRatio > 10 ? 'gold' : 'default'} style={{ fontSize: 10, margin: 0 }}>
                            {r.tipRatio || 0}%
                          </Tag>
                        </td>
                        <td
                          style={{
                            textAlign: 'right',
                            fontWeight: 600,
                            color: r.qualityScore > 50 ? SEMANTIC.success : '#999',
                          }}
                        >
                          {r.qualityScore || 0}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <EmptyState description="暂无排行" />
            )}
            {(() => {
              const idx = rankingAll.findIndex((r: any) => r.companionId === user?.companionId);
              if (idx < 0) return null;
              return (
                <div style={{ textAlign: 'center', marginTop: 6 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    我排第 {idx + 1} 名 / 共 {rankingAll.length} 人
                  </Text>
                </div>
              );
            })()}
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <Button type="link" size="small" onClick={() => (window.location.href = '/companion/companions')}>
                查看完整排行 →
              </Button>
            </div>
          </Card>
        </Col>
      </Row>

      {/* ③ Pending Customers — prominent */}
      <Spin spinning={customersLoading}>
        <Title level={5} style={{ marginBottom: 8 }}>
          📋 待跟进客户
          {(() => {
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            const pending = myCustomers.filter((c: any) => {
              const spent = (c.totalSpent ?? 0) > 0;
              if (!spent) return true;
              const f = c.followUps?.[0];
              if (!f) return true;
              return new Date(f.createdAt) < sevenDaysAgo;
            });
            return (
              <Tag color={pending.length > 0 ? 'red' : 'default'} style={{ marginLeft: 8 }}>
                {pending.length}人
              </Tag>
            );
          })()}
          <Button
            type="link"
            size="small"
            style={{ float: 'right' }}
            onClick={() => (window.location.href = '/companion/customers')}
          >
            查看全部 →
          </Button>
        </Title>
        {(() => {
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          const pendingCustomers = myCustomers.filter((c: any) => {
            const spent = (c.totalSpent ?? 0) > 0;
            if (!spent) return true;
            const f = c.followUps?.[0];
            if (!f) return true;
            return new Date(f.createdAt) < sevenDaysAgo;
          });
          if (pendingCustomers.length === 0)
            return (
              <Card size="small">
                <EmptyState description="暂无待跟进客户" />
              </Card>
            );
          return (
            <Table
              size="small"
              dataSource={pendingCustomers.slice(0, 5)}
              rowKey="id"
              pagination={false}
              style={{ marginBottom: 12 }}
            >
              <Table.Column
                title="编号"
                dataIndex="customerCode"
                width={100}
                render={(v: string) => <Text code>{v}</Text>}
              />
              <Table.Column title="微信" dataIndex="wechatId" width={100} render={(v: string) => v || '-'} />
              <Table.Column
                title="来源"
                dataIndex="platform"
                width={70}
                render={(v: string) => (v ? <Tag>{v}</Tag> : '-')}
              />
              <Table.Column
                title="跟进"
                width={90}
                render={(_: any, c: any) => {
                  const f = c.followUps?.[0];
                  return f ? (
                    <Text style={{ fontSize: 11 }}>{new Date(f.createdAt).toLocaleDateString('zh-CN')}</Text>
                  ) : (
                    <Tag color="red">未跟进</Tag>
                  );
                }}
              />
              <Table.Column
                title="操作"
                width={60}
                render={(_: any, c: any) => (
                  <Button
                    type="link"
                    size="small"
                    onClick={() => (window.location.href = `/companion/customers/${c.id}`)}
                  >
                    跟进
                  </Button>
                )}
              />
            </Table>
          );
        })()}
      </Spin>

      {/* ④ Billing entry */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Text strong>💰 报账</Text>
        <br />
        <Text>
          总流水 ¥{(wallet?.totalRevenue ?? 0).toFixed(0)} · 可支取 ¥{(wallet?.withdrawable ?? 0).toFixed(0)} · 押金 ¥
          {(wallet?.deposit ?? 0).toFixed(0)}
        </Text>
        <br />
        <Button
          type="primary"
          size="small"
          style={{ marginTop: 8 }}
          onClick={() => (window.location.href = '/companion/billing')}
        >
          进入报账系统 →
        </Button>
      </Card>

      {/* Today sessions summary */}
      {todaySessions.length > 0 && (
        <Card size="small" style={{ marginBottom: 12 }} title="📋 今日服务明细">
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #eee' }}>
                <th style={{ padding: 4, textAlign: 'left' }}>#</th>
                <th style={{ padding: 4, textAlign: 'left' }}>游戏</th>
                <th style={{ padding: 4, textAlign: 'left' }}>搭档</th>
                <th style={{ padding: 4, textAlign: 'right' }}>我的</th>
                <th style={{ padding: 4, textAlign: 'right' }}>搭档</th>
                <th style={{ padding: 4 }}>时长</th>
                <th style={{ padding: 4 }}>状态</th>
              </tr>
            </thead>
            <tbody>
              {todaySessions.map((s: any) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td style={{ padding: 4 }}>{s.orderCode || '-'}</td>
                  <td style={{ padding: 4 }}>{s.gameName || '-'}</td>
                  <td style={{ padding: 4 }}>{s.coName || '-'}</td>
                  <td style={{ padding: 4, textAlign: 'right' }}>¥{s.amount}</td>
                  <td style={{ padding: 4, textAlign: 'right' }}>{s.coAmount ? `¥${s.coAmount}` : '-'}</td>
                  <td style={{ padding: 4 }}>{s.duration}h</td>
                  <td style={{ padding: 4 }}>{s.status === 'ACTIVE' ? '🔄' : '✅'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 'bold', borderTop: '2px solid #333' }}>
                <td colSpan={3} style={{ padding: 4 }}>
                  合计
                </td>
                <td style={{ padding: 4, textAlign: 'right' }}>
                  ¥{todaySessions.reduce((a: number, s: any) => a + (s.amount || 0), 0)}
                </td>
                <td style={{ padding: 4, textAlign: 'right' }}>
                  ¥{todaySessions.reduce((a: number, s: any) => a + (s.coAmount || 0), 0)}
                </td>
                <td colSpan={2} style={{ padding: 4 }}></td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      {/* Notification Settings Modal */}
      <Modal
        title="🔔 订单通知设置"
        open={notifModalOpen}
        onCancel={() => setNotifModalOpen(false)}
        footer={null}
        width={540}
      >
        <OrderNotifySettingsPanel />
      </Modal>

      {/* TASK-06: Boot Guide Modal */}
      <Modal title="📋 开工提醒" open={bootGuideVisible} onCancel={() => setBootGuideVisible(false)} footer={null}>
        <div style={{ lineHeight: 2.2 }}>
          <p>请优先联系你的私域客户，提高成单率！</p>
          <div style={{ background: '#f6ffed', borderRadius: 8, padding: 12, marginTop: 8 }}>
            <p>
              💡 <Text strong>建议流程：</Text>
            </p>
            <p>① 打开客户管理 → 查看待跟进客户</p>
            <p>② 主动联系客户 → 了解游戏需求</p>
            <p>③ 促成下单 → 抢到单记得点「开始首单」开始计时</p>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <Button
              type="primary"
              onClick={() => {
                setBootGuideVisible(false);
                window.location.href = '/companion/customers';
              }}
            >
              去客户管理
            </Button>
            <Button onClick={() => setBootGuideVisible(false)}>稍后提醒</Button>
          </div>
        </div>
      </Modal>

      <ExcellenceRuleModal open={showRule} onClose={() => setShowRule(false)} initial={excellence} />
    </div>
  );
};

export default CompanionPage;
