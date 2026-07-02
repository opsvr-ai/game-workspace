import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Row,
  Col,
  Card,
  Button,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Tag,
  Typography,
  Space,
  message,
  List,
  Spin,
  Badge,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { CompanionStatus, OrderType, DispatchType } from '@chunlv/shared';
import { companionsApi } from '../../api/companions';
import { ordersApi } from '../../api/orders';
import http from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { useSocket } from '../../hooks/useSocket';
import ChatModal from '../../components/ChatModal';
import CreateOrderModal from '../../components/CreateOrderModal';

const { Text } = Typography;
const { Option } = Select;

const STATUS_SORT: Record<string, number> = { IDLE: 0, ONLINE: 1, BUSY: 2, OFFLINE: 9 };

const orderTypeConfig: Record<OrderType, { color: string; label: string }> = {
  [OrderType.NEW]: { color: 'blue', label: '首单' },
  [OrderType.RENEW]: { color: 'cyan', label: '续费' },
  [OrderType.REPURCHASE]: { color: 'purple', label: '复购' },
  [OrderType.TIP]: { color: 'orange', label: '打赏' },
};

interface Companion {
  id: string;
  user?: { username: string };
  status: CompanionStatus;
  games?: any[];
}

interface PoolOrder {
  id: string;
  gameName: string;
  amount: number;
  type: OrderType;
  dispatchType: string;
  duration?: number;
  status: string;
  createdAt: string;
  customFields?: any;
  customer?: { wechatId: string; customerCode?: string };
  csUser?: { username: string };
}

const DispatchPage: React.FC = () => {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [poolOrders, setPoolOrders] = useState<PoolOrder[]>([]);
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [todayNew, setTodayNew] = useState(0);
  const [todayGrabbed, setTodayGrabbed] = useState(0);
  const [loadingCompanions, setLoadingCompanions] = useState(false);
  const [loadingPool, setLoadingPool] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [chatPartner, setChatPartner] = useState<{ name: string; avatar?: string; orderId: string; orderInfo?: string } | null>(null);
  const [selectedCompanion, setSelectedCompanion] = useState<Companion | null>(null);
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});

  // Poll localStorage for unread badges every 2s
  useEffect(() => {
    const read = () => {
      const map: Record<string, number> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('unread-')) map[k.replace('unread-', '')] = parseInt(localStorage.getItem(k) || '0', 10);
      }
      setUnreadMap(map);
    };
    read();
    const t = setInterval(read, 2000);
    return () => clearInterval(t);
  }, []);
  const [gameOptions, setGameOptions] = useState<string[]>([]);
  const [form] = Form.useForm();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCompanions = useCallback(async () => {
    setLoadingCompanions(true);
    try {
      const { data } = await companionsApi.list();
      setCompanions(data.data ?? []);
    } catch {
      // silent fail on auto-refresh
    } finally {
      setLoadingCompanions(false);
    }
  }, []);

  const fetchPool = useCallback(async () => {
    setLoadingPool(true);
    try {
      const [poolRes, allRes] = await Promise.all([
        ordersApi.pool(),
        ordersApi.list(),
      ]);
      setPoolOrders(poolRes.data.data ?? []);
      const all = allRes.data.data ?? [];
      setAllOrders(all);
      const today = new Date().toDateString();
      setTodayNew(all.filter((o: any) => new Date(o.createdAt).toDateString() === today).length);
      setTodayGrabbed(all.filter((o: any) => o.status === 'GRABBED' || o.status === 'CONFIRMED').length);
    } catch {
      // silent fail on auto-refresh
    } finally {
      setLoadingPool(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchCompanions();
    fetchPool();
    http.get('/settings').then(({ data }) => {
      const games = (data.data?.games ?? []);
      setGameOptions(['三角洲行动', ...games.filter((g: string) => g !== '三角洲行动')]);
    }).catch(() => {});
  }, [fetchCompanions, fetchPool]);

  // WebSocket real-time: refresh pool on order updates
  useSocket({
    onOrderPoolUpdated: () => fetchPool(),
    onOrderGrabbed: (data: any) => {
      message.info(data?.message || '有陪玩抢了订单');
      fetchPool();
    },
    onChatNotify: (data: any) => {
      if (data?.companionId) addChatCompanion(data.companionId);
    },
  });

  // Fallback polling every 120s
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchPool();
      fetchCompanions();
    }, 120000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchPool, fetchCompanions]);

  const handleCreateOrder = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await ordersApi.create(values);
      message.success('订单已创建');
      setModalOpen(false);
      form.resetFields();
      fetchPool();
    } catch (err: any) {
      if (err?.errorFields) return;
      const msg = err?.response?.data?.message || err?.message || '创建失败';
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Chat notification tracking
  const chatIds = useAuthStore((s) => s.chatCompanionIds);
  const addChatCompanion = useAuthStore((s) => s.addChatCompanion);
  const clearChatCompanions = useAuthStore((s) => s.clearChatCompanions);

  useEffect(() => { return () => { clearChatCompanions(); }; }, []);

  // Stats — sort: messages first, then by status
  const sortedCompanions = useMemo(() =>
    [...companions].sort((a, b) => {
      const aMsg = chatIds.includes(a.id) ? 1 : 0;
      const bMsg = chatIds.includes(b.id) ? 1 : 0;
      if (aMsg !== bMsg) return bMsg - aMsg;
      return (STATUS_SORT[a.status] ?? 9) - (STATUS_SORT[b.status] ?? 9);
    }), [companions, chatIds]);

  const idleCount = companions.filter((c) => c.status === CompanionStatus.IDLE).length;
  const busyCount = companions.filter((c) => c.status === CompanionStatus.BUSY).length;
  const entertainCount = companions.filter((c) => c.status === CompanionStatus.ONLINE).length;
  const offlineCount = companions.filter((c) => c.status === CompanionStatus.OFFLINE).length;
  const poolCount = poolOrders.length;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div />
        <Button
          type="primary"
          icon={React.createElement(PlusOutlined)}
          onClick={() => {
            form.setFieldsValue({
              type: 'NEW', gameName: '三角洲行动', dispatchType: DispatchType.POOL,
              billingMode: 'hour', duration: 1, deltaMode: '陪玩', deltaCount: '单',
            });
            setModalOpen(true);
          }}
        >
          创建订单
        </Button>
      </div>

      <Row gutter={12}>
        {/* Left */}
        <Col span={3}>
          <Card
            title="陪玩管理"
            size="small"
            style={{ marginBottom: 16 }}
          >
            {loadingCompanions && companions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
            ) : companions.length === 0 ? (
              <Text type="secondary">暂无陪玩</Text>
            ) : (
              <List size="small" dataSource={sortedCompanions}
                renderItem={(c) => (
                  <List.Item style={{ padding: '8px 0', display: 'block', cursor: 'pointer' }}
                    onClick={() => {
                      const hasMsg = chatIds.includes(c.id);
                      if (hasMsg) {
                        const cur = useAuthStore.getState().chatCompanionIds.filter((id: string) => id !== c.id);
                        useAuthStore.setState({ chatCompanionIds: cur });
                      }
                      // Clear badge
                      localStorage.removeItem(`unread-${c.id}`);
                      setUnreadMap(prev => { const { [c.id]: _, ...r } = prev; return r; });
                      // Open WeChat-style chat — use notification's orderId
                      const u = c.user as any;
                      const notifOrderId = localStorage.getItem(`last-orderId-${c.id}`);
                      const matchedOrder = [...poolOrders, ...allOrders].find((o: any) => o.id === notifOrderId || o.companionId === c.id);
                      const chatOrderId = notifOrderId || matchedOrder?.id;
                      setChatPartner({
                        name: u?.displayName || u?.username || c.id,
                        avatar: u?.avatar || null,
                        orderId: chatOrderId,
                        orderInfo: matchedOrder
                          ? [
                              matchedOrder.companionId === c.id ? '✅已抢' : '⏳待抢',
                              `📋 ${matchedOrder.gameName}`,
                              `${(orderTypeConfig as any)[matchedOrder.type]?.label || matchedOrder.type}`,
                              `¥${Number(matchedOrder.amount).toFixed(2)}`,
                              matchedOrder.duration ? `${matchedOrder.duration}h` : '',
                              matchedOrder.customFields?.billingMode === 'round' ? '按局' : '',
                              matchedOrder.customFields?.deltaMode ? `🎯${matchedOrder.customFields.deltaMode}` : '',
                              matchedOrder.customer?.customerCode ? `👤${matchedOrder.customer.customerCode}` : '',
                            ].filter(Boolean).join(' · ')
                          : (c.games?.length ? `🎮 ${c.games.map((g:any)=>g.game||g).join(',')}` : ''),
                      });
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <Space size="small">
                        {(() => {
                          const u = c.user as any;
                          const avatarUrl = u?.avatar ? `/uploads/avatars/${u.avatar}` : null;
                          const initial = (u?.displayName || u?.username || '?')[0].toUpperCase();
                          return (
                            <div style={{
                              width: 32, height: 32, borderRadius: '50%',
                              background: avatarUrl ? `url(${avatarUrl}) center/cover` : '#1677ff',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              boxShadow: c.status !== CompanionStatus.OFFLINE ? `0 0 6px ${c.status === CompanionStatus.BUSY ? '#FF4757' : c.status === CompanionStatus.IDLE ? '#00E676' : '#FFD600'}` : 'none',
                              flexShrink: 0,
                            }}>
                              {!avatarUrl && (
                                <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>{initial}</span>
                              )}
                            </div>
                          );
                        })()}
                        <Badge count={unreadMap[c.id] || 0} size="small" offset={[6, -2]}>
                          <Text strong className={(unreadMap[c.id] || 0) > 0 ? 'pulse-badge' : ''}>{c.user?.username ?? c.id}</Text>
                        </Badge>
                      </Space>
                      <Tag color={
                        c.status === CompanionStatus.BUSY ? 'red' :
                        c.status === CompanionStatus.IDLE ? 'green' :
                        c.status === CompanionStatus.ONLINE ? 'gold' : 'default'
                      }>
                        {c.status === CompanionStatus.BUSY ? '接单中' :
                         c.status === CompanionStatus.IDLE ? '空闲' :
                         c.status === CompanionStatus.ONLINE ? '娱乐中' : '离线'}
                      </Tag>
                    </div>
                    {/* 游戏资料 */}
                    {c.games && c.games.length > 0 && typeof c.games[0] === 'object' && (
                      <div style={{ marginTop: 4, marginLeft: 22, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {c.games.map((g: any, i: number) => (
                          <Tag key={i} style={{ fontSize: 11, padding: '1px 6px', lineHeight: '18px', opacity: 0.85 }}>
                            {g.game} <span style={{ color: '#7B61FF' }}>{g.rank||'?'}</span>
                          </Tag>
                        ))}
                      </div>
                    )}
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        {/* Center: Order Pool (17/24) */}
        <Col span={18}>
          <div style={{ position: 'relative', marginBottom: 16 }}>
            {/* Water wave header */}
            <div style={{
              background: 'linear-gradient(180deg, #00D4FF 0%, #7B61FF 100%)',
              borderRadius: '16px 16px 0 0', padding: '20px 24px', position: 'relative',
              overflow: 'hidden',
            }}>
              <div className="wave-container" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 40 }}>
                <div className="wave wave1" />
                <div className="wave wave2" />
              </div>
              <Space style={{ position: 'relative', zIndex: 1 }}>
                <span style={{ fontSize: 24 }}>🌊</span>
                <Text strong style={{ color: '#FFF', fontSize: 18 }}>订单池</Text>
                <Tag color="white" style={{ color: '#7B61FF', fontWeight: 700, borderRadius: 10, padding: '2px 12px', border: 'none' }}>
                  {poolCount} 单待派
                </Tag>
                <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, marginLeft: 8 }}>
                  今日新增 <b style={{ color: '#FFF' }}>{todayNew}</b> · 已接 <b style={{ color: '#FFF' }}>{todayGrabbed}</b> · 剩余 <b style={{ color: '#FFF' }}>{poolCount}</b>
                </span>
              </Space>
            </div>
            {/* Pool body */}
            <div style={{ background: '#FFF', borderRadius: '0 0 16px 16px', padding: '16px 20px',
              minHeight: 400, border: '1px solid #E2E8F0', borderTop: 'none',
              boxShadow: '0 4px 16px rgba(0,0,0,0.04)' }}>
              {loadingPool && poolOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>
              ) : poolOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>🏊</div>
                  <Text type="secondary" style={{ fontSize: 15 }}>暂无待派订单，水面平静</Text>
                </div>
              ) : (
                <List grid={{ gutter: [0, 8], column: 1 }} dataSource={poolOrders}
                  renderItem={(order, idx) => (
                    <List.Item style={{ marginBottom: 0 }}>
                      <div style={{ background: '#FFF', borderRadius: 10, padding: '8px 14px',
                        border: '1px solid #E8ECF1', transition: 'all 0.2s',
                        animation: 'fade-slide-in 0.3s ease',
                        borderLeft: `3px solid ${orderTypeConfig[order.type]?.color || '#1677ff'}` }}>
                        <Row align="middle" gutter={8} wrap={false}>
                          <Col><Tag style={{ background: '#f0f0f0', color: '#666', fontWeight: 700, minWidth: 24, textAlign: 'center', margin: 0 }}>{idx + 1}</Tag></Col>
                          <Col><Tag color={orderTypeConfig[order.type]?.color || 'blue'} style={{ margin: 0 }}>{orderTypeConfig[order.type]?.label || order.type}</Tag></Col>
                          <Col><Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>{order.gameName}</Text></Col>
                          <Col><Text style={{ fontSize: 14, fontWeight: 700, color: '#1677ff', whiteSpace: 'nowrap' }}>¥{Number(order.amount).toFixed(0)}</Text></Col>
                          {order.customFields?.deltaMode && <Col><Tag color="cyan" style={{ margin: 0 }}>{order.customFields.deltaMode}</Tag></Col>}
                          {order.customFields?.deltaMission && <Col><Tag style={{ margin: 0 }}>{order.customFields.deltaMission}</Tag></Col>}
                          {order.customFields?.deltaCount && <Col><Tag style={{ margin: 0 }}>{order.customFields.deltaCount}</Tag></Col>}
                          {order.customFields?.customerSource && <Col><Tag color="orange" style={{ margin: 0 }}>📡{order.customFields.customerSource}</Tag></Col>}
                          {order.customFields?.customerWechat && <Col><Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>💬{order.customFields.customerWechat}</Text></Col>}
                          {order.customFields?.customerRoomCode && <Col><Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>🏠{order.customFields.customerRoomCode}</Text></Col>}
                          {order.customFields?.urgency === 'later' && <Col><Tag color="purple" style={{ margin: 0 }}>📅预约</Tag></Col>}
                          {order.customFields?.urgency !== 'later' && <Col><Tag color="green" style={{ margin: 0 }}>⚡立即打</Tag></Col>}
                          <Col><Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>发布:{order.csUser?.username || order.customFields?.createdBy || '未知'}</Text></Col>
                          {order.customFields?.deltaNote && <Col><Text type="warning" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>📝{order.customFields.deltaNote}</Text></Col>}
                          {order.customFields?.billingMode === 'round'
                            ? <Col><Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>🎯{order.duration || order.customFields?.deltaCount || '?'}局</Text></Col>
                            : order.duration && <Col><Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>⏱{order.duration}h</Text></Col>
                          }
                          <Col flex="auto" />
                          <Col>
                            <Space size={6}>
                              <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                                {order.createdAt ? new Date(order.createdAt).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : ''}
                              </Text>
                            </Space>
                          </Col>
                        </Row>
                      </div>
                    </List.Item>
                )}
              />
            )}
            </div>
          </div>
        </Col>

        {/* Right: Quick Stats (3/24) */}
        <Col span={3}>
<Card title="统计" size="small" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>🟢 空闲</span><b style={{ color: '#00E676' }}>{idleCount}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>🔴 接单中</span><b style={{ color: '#FF4757' }}>{busyCount}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>🟡 娱乐中</span><b style={{ color: '#FFD600' }}>{entertainCount}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>⚪ 离线</span><b style={{ color: '#94A3B8' }}>{offlineCount}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderTop: '1px solid #E2E8F0', paddingTop: 8 }}><span>📦 待派</span><b style={{ color: '#1677ff' }}>{poolCount}</b></div>
            </div>
          </Card>
        </Col>
      </Row>

      <CreateOrderModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={fetchPool} userId={useAuthStore.getState().user?.id} />

      {/* Chat Modal */}
      <ChatModal open={!!chatPartner} partner={chatPartner} onClose={() => setChatPartner(null)} />

      {/* 陪玩详情弹窗 */}
      {/* 陪玩详情弹窗 */}
      <Modal title={null} open={!!selectedCompanion} onCancel={() => setSelectedCompanion(null)} footer={null} width={420} style={{ top: 60 }}>
        {selectedCompanion && (
          <div style={{ textAlign: 'center' }}>
            <span style={{ width: 40, height: 40, borderRadius: '50%', display: 'inline-block', marginBottom: 8,
              background: selectedCompanion.status === CompanionStatus.BUSY ? '#FF4757' :
                selectedCompanion.status === CompanionStatus.IDLE ? '#00E676' :
                selectedCompanion.status === CompanionStatus.ONLINE ? '#FFD600' : '#94A3B8',
              boxShadow: selectedCompanion.status !== CompanionStatus.OFFLINE
                ? `0 0 16px ${selectedCompanion.status === CompanionStatus.BUSY ? '#FF4757' : selectedCompanion.status === CompanionStatus.IDLE ? '#00E676' : '#FFD600'}`
                : 'none',
              animation: selectedCompanion.status !== CompanionStatus.OFFLINE ? 'pulse-glow 2s ease-in-out infinite' : 'none',
            }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{selectedCompanion.user?.username ?? selectedCompanion.id}</div>
            <Tag color={
              selectedCompanion.status === CompanionStatus.BUSY ? 'red' :
              selectedCompanion.status === CompanionStatus.IDLE ? 'green' :
              selectedCompanion.status === CompanionStatus.ONLINE ? 'gold' : 'default'
            }>
              {selectedCompanion.status === CompanionStatus.BUSY ? '接单中' :
               selectedCompanion.status === CompanionStatus.IDLE ? '空闲' :
               selectedCompanion.status === CompanionStatus.ONLINE ? '娱乐中' : '离线'}
            </Tag>
            <div style={{ marginTop: 16, textAlign: 'left', background: '#F8FAFC', borderRadius: 10, padding: 14 }}>
              {selectedCompanion.games && selectedCompanion.games.length > 0 && typeof selectedCompanion.games[0] === 'object' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedCompanion.games.map((g: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span>🎮 {g.game}</span>
                      <span style={{ color: '#7B61FF', fontWeight: 600 }}>{g.rank || '?'}</span>
                      <span style={{ color: g.hasAccount ? '#34C759' : '#94A3B8' }}>{g.hasAccount ? '有号' : '无号'}</span>
                    </div>
                  ))}
                </div>
              ) : <Text type="secondary">未设置游戏资料</Text>}
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
};

export default DispatchPage;
