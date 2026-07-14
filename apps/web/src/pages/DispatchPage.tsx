import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Row,
  Col,
  Card,
  Button,
  Modal,
  Form,
  Select,
  Tag,
  Typography,
  Space,
  message,
  List,
  Spin,
  Badge,
  Statistic,
  Table,
  Popconfirm,
  Input,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  UserOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import { CompanionStatus, OrderType, OrderStatus, DispatchType, UserRole } from '@chunlv/shared';
import { companionsApi } from '../api/companions';
import { ordersApi } from '../api/orders';
import { useAuthStore } from '../stores/authStore';
import { useSocket } from '../hooks/useSocket';
import ChatModal from '../components/ChatModal';
import CreateOrderModal from '../components/CreateOrderModal';
import {
  orderTypeConfig,
  orderStatusConfig,
  companionStatusConfig,
  dispatchTypeConfig,
  STATUS_SORT,
  serviceTypeConfig,
} from '../constants';

const { Text } = Typography;
const { Option } = Select;

// ──────────────────────────────────── Types ────────────────────────────────────

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

interface AdminOrder {
  id: string;
  gameName: string;
  amount: number;
  orderType: OrderType;
  status: OrderStatus;
  dispatchType: DispatchType;
  createdAt: string;
  customer?: { wechatId: string };
  companion?: { id: string; username: string };
}

interface AdminCompanion {
  id: string;
  username: string;
  status: CompanionStatus;
}

// ──────────────────────────────────── CS View ────────────────────────────────────

const CSView: React.FC = () => {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [poolOrders, setPoolOrders] = useState<PoolOrder[]>([]);
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [todayNew, setTodayNew] = useState(0);
  const [todayGrabbed, setTodayGrabbed] = useState(0);
  const [loadingCompanions, setLoadingCompanions] = useState(false);
  const [loadingPool, setLoadingPool] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [chatPartner, setChatPartner] = useState<{ name: string; avatar?: string; orderId: string; orderInfo?: string } | null>(null);
  const [selectedCompanion, setSelectedCompanion] = useState<Companion | null>(null);
  const [urgencyFilter, setUrgencyFilter] = useState<string | undefined>();
  const [gameSearch, setGameSearch] = useState('');
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

  const idleCount = companions.filter((c) => c.status === CompanionStatus.AVAILABLE).length;
  const busyCount = companions.filter((c) => c.status === CompanionStatus.BUSY).length;
  const entertainCount = companions.filter((c) => c.status === CompanionStatus.ENTERTAINMENT).length;
  const restingCount = companions.filter((c) => c.status === CompanionStatus.RESTING).length;
  const offlineCount = companions.filter((c) => c.status === CompanionStatus.OFFLINE).length;
  const poolCount = poolOrders.length;

  // Apply filters
  const filteredOrders = useMemo(() => {
    let result = poolOrders;
    if (gameSearch) result = result.filter(o => o.gameName?.toLowerCase().includes(gameSearch.toLowerCase()));
    if (urgencyFilter) result = result.filter(o => (o as any).customFields?.urgency === urgencyFilter);
    return result;
  }, [poolOrders, gameSearch, urgencyFilter]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div />
        <Button
          type="primary"
          icon={React.createElement(PlusOutlined)}
          onClick={() => setModalOpen(true)}
        >
          发布订单
        </Button>
      </div>

      <Row gutter={12}>
        {/* Left: Companion sidebar (3/24) */}
        <Col span={4}>
          <Card
            title="陪玩管理"
            size="small"
            style={{ marginBottom: 12 }}
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
                              boxShadow: c.status !== CompanionStatus.OFFLINE ? `0 0 6px ${c.status === CompanionStatus.BUSY ? '#FF4757' : c.status === CompanionStatus.ENTERTAINMENT ? '#00E676' : '#FFD600'}` : 'none',
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
                        {(c as any).processStatus === 'BLOCKED' && <Tag color="red" style={{ fontSize: 11, padding: '1px 6px', lineHeight: '20px' }}>已限制</Tag>}
                        {(c as any).processStatus === 'WARNING' && <Tag color="orange" style={{ fontSize: 11, padding: '1px 6px', lineHeight: '20px' }}>⚠️ 进程异常</Tag>}
                        </Badge>
                      </Space>
                      <Tag color={companionStatusConfig[c.status]?.color || 'default'}>
                        {companionStatusConfig[c.status]?.label || c.status}
                      </Tag>
                    </div>
                    {/* Game profile */}
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

        {/* Center: Order Pool (18/24) */}
        <Col span={18}>
          <div style={{ position: 'relative', marginBottom: 12 }}>
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
              {/* Filter bar */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <Input.Search placeholder="搜索游戏名" value={gameSearch}
                  onChange={e => setGameSearch(e.target.value)} allowClear style={{ width: 200 }} size="small" />
                <Select placeholder="紧急程度" value={urgencyFilter} onChange={setUrgencyFilter}
                  allowClear style={{ width: 120 }} size="small">
                  <Select.Option value="now">立即打</Select.Option>
                  <Select.Option value="later">预约</Select.Option>
                  <Select.Option value="urgent">急单</Select.Option>
                </Select>
                {(gameSearch || urgencyFilter) && (
                  <Text type="secondary" style={{ fontSize: 12, lineHeight: '24px' }}>
                    筛选结果: {filteredOrders.length}/{poolCount}
                  </Text>
                )}
              </div>
              {loadingPool && poolOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48 }}><Spin size="large" /></div>
              ) : poolOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 48, color: '#94A3B8' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>🏊</div>
                  <Text type="secondary" style={{ fontSize: 15 }}>暂无待派订单，水面平静</Text>
                </div>
              ) : (
                <List grid={{ gutter: [0, 8], column: 1 }} dataSource={filteredOrders}
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
                          {order.customFields?.deltaMission && <Col><Tag style={{ margin: 0 }}>{order.customFields.deltaMission}</Tag></Col>}
                          {order.customFields?.deltaCount && <Col><Tag style={{ margin: 0 }}>{order.customFields.deltaCount}</Tag></Col>}
                          {order.customFields?.serviceType && <Col><Tag color={serviceTypeConfig[order.customFields.serviceType]?.color} style={{ margin: 0 }}>{serviceTypeConfig[order.customFields.serviceType]?.label || order.customFields.serviceType}</Tag></Col>}
                          {order.customFields?.gameMode && <Col><Tag color="geekblue" style={{ margin: 0 }}>{order.customFields.gameMode}</Tag></Col>}
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
          <Card title="统计" size="small" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>🟢 空闲</span><b style={{ color: '#00E676' }}>{idleCount}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>🔴 接单</span><b style={{ color: '#FF4757' }}>{busyCount}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>🟡 娱乐</span><b style={{ color: '#FFD600' }}>{entertainCount}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>🟠 休息</span><b style={{ color: '#FF9500' }}>{restingCount}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>⚪ 离线</span><b style={{ color: '#94A3B8' }}>{offlineCount}</b></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderTop: '1px solid #E2E8F0', paddingTop: 8 }}><span>📦 待派</span><b style={{ color: '#1677ff' }}>{poolCount}</b></div>
            </div>
          </Card>
        </Col>
      </Row>

      <CreateOrderModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={fetchPool} userId={useAuthStore.getState().user?.id} />

      {/* Chat Modal */}
      <ChatModal open={!!chatPartner} partner={chatPartner} onClose={() => setChatPartner(null)} />

      {/* Companion detail modal */}
      <Modal title={null} open={!!selectedCompanion} onCancel={() => setSelectedCompanion(null)} footer={null} width={420} style={{ top: 60 }}>
        {selectedCompanion && (
          <div style={{ textAlign: 'center' }}>
            <span style={{ width: 40, height: 40, borderRadius: '50%', display: 'inline-block', marginBottom: 8,
              background: selectedCompanion.status === CompanionStatus.BUSY ? '#FF4757' :
                selectedCompanion.status === CompanionStatus.ENTERTAINMENT ? '#00E676' :
                selectedCompanion.status === CompanionStatus.AVAILABLE ? '#FFD600' : '#94A3B8',
              boxShadow: selectedCompanion.status !== CompanionStatus.OFFLINE
                ? `0 0 16px ${selectedCompanion.status === CompanionStatus.BUSY ? '#FF4757' : selectedCompanion.status === CompanionStatus.ENTERTAINMENT ? '#00E676' : '#FFD600'}`
                : 'none',
              animation: selectedCompanion.status !== CompanionStatus.OFFLINE ? 'pulse-glow 2s ease-in-out infinite' : 'none',
            }} />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{selectedCompanion.user?.username ?? selectedCompanion.id}</div>
            <Tag color={companionStatusConfig[selectedCompanion.status]?.color || 'default'}>
              {companionStatusConfig[selectedCompanion.status]?.label || selectedCompanion.status}
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

// ──────────────────────────────────── Admin View ────────────────────────────────────

const AdminView: React.FC = () => {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | undefined>();
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedCompanionId, setSelectedCompanionId] = useState<string>('');
  const [assigning, setAssigning] = useState(false);
  const [adminCompanions, setAdminCompanions] = useState<AdminCompanion[]>([]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      const { data } = await ordersApi.list(params);
      setOrders(data.data?.items ?? data.data ?? []);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '加载订单失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchAdminCompanions = useCallback(async () => {
    try {
      const { data } = await companionsApi.list();
      setAdminCompanions(data.data ?? []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const openAssignModal = (orderId: string) => {
    setSelectedOrderId(orderId);
    setSelectedCompanionId('');
    fetchAdminCompanions();
    setAssignModalOpen(true);
  };

  const handleAssign = async () => {
    if (!selectedOrderId || !selectedCompanionId) return;
    setAssigning(true);
    try {
      await ordersApi.assign(selectedOrderId, selectedCompanionId);
      message.success('派单成功');
      setAssignModalOpen(false);
      setSelectedOrderId(null);
      setSelectedCompanionId('');
      fetchOrders();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '派单失败';
      message.error(msg);
    } finally {
      setAssigning(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await ordersApi.cancel(id);
      message.success('订单已取消');
      fetchOrders();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '取消失败';
      message.error(msg);
    }
  };

  // Stats
  const pendingCount = orders.filter((o) => o.status === OrderStatus.PENDING).length;
  const activeCount = orders.filter(
    (o) => o.status === OrderStatus.GRABBED || o.status === OrderStatus.CONFIRMED
  ).length;
  const doneCount = orders.filter((o) => o.status === OrderStatus.DONE).length;
  const cancelledCount = orders.filter((o) => o.status === OrderStatus.CANCELLED).length;

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 160,
      ellipsis: true,
    },
    {
      title: '游戏',
      dataIndex: 'gameName',
      key: 'gameName',
      width: 120,
    },
    {
      title: '客户',
      key: 'customer',
      width: 140,
      render: (_: unknown, record: AdminOrder) => (
        <Text>{record.customer?.wechatId ?? '-'}</Text>
      ),
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 100,
      render: (val: number) => `¥${val.toFixed(2)}`,
    },
    {
      title: '类型',
      dataIndex: 'orderType',
      key: 'orderType',
      width: 80,
      render: (type: OrderType) => {
        const cfg = orderTypeConfig[type];
        return <Tag color={cfg?.color}>{cfg?.label ?? type}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: OrderStatus) => {
        const cfg = orderStatusConfig[status];
        return <Tag color={cfg?.color}>{cfg?.label ?? status}</Tag>;
      },
    },
    {
      title: '派单方式',
      dataIndex: 'dispatchType',
      key: 'dispatchType',
      width: 110,
      render: (type: DispatchType) => {
        const cfg = dispatchTypeConfig[type];
        return <Tag color={cfg?.color}>{cfg?.label ?? type}</Tag>;
      },
    },
    {
      title: '陪玩',
      key: 'companion',
      width: 100,
      render: (_: unknown, record: AdminOrder) => (
        <Text>{record.companion?.username ?? <Text type="secondary">未分配</Text>}</Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_: unknown, record: AdminOrder) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            onClick={() => openAssignModal(record.id)}
          >
            指定陪玩
          </Button>
          {record.status !== OrderStatus.CANCELLED && (
            <Popconfirm
              title="确定取消该订单？"
              onConfirm={() => handleCancel(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="link" size="small" danger>
                取消
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* Stats Cards */}
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="待派"
              value={pendingCount}
              prefix={React.createElement(ClockCircleOutlined)}
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="进行中"
              value={activeCount}
              prefix={React.createElement(UserOutlined)}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="已完成"
              value={doneCount}
              prefix={React.createElement(CheckCircleOutlined)}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="已取消"
              value={cancelledCount}
              prefix={React.createElement(CloseCircleOutlined)}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <div />
        <Space>
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 140 }}
            value={statusFilter}
            onChange={(val) => setStatusFilter(val)}
          >
            {Object.entries(orderStatusConfig).map(([key, cfg]) => (
              <Option key={key} value={key}>
                {cfg.label}
              </Option>
            ))}
          </Select>
          <Button
            icon={React.createElement(ReloadOutlined)}
            onClick={fetchOrders}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>

      {/* Orders Table */}
      <Table
        columns={columns}
        dataSource={orders}
        rowKey="id"
        loading={loading}
        locale={{ emptyText: '暂无订单数据' }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条订单`,
        }}
      />

      {/* Assign Companion Modal */}
      <Modal
        title="指定陪玩"
        open={assignModalOpen}
        onOk={handleAssign}
        onCancel={() => {
          setAssignModalOpen(false);
          setSelectedOrderId(null);
          setSelectedCompanionId('');
        }}
        confirmLoading={assigning}
        okText="确认派单"
        cancelText="取消"
        okButtonProps={{ disabled: !selectedCompanionId }}
        destroyOnClose
      >
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="选择陪玩">
            <Select
              showSearch
              placeholder="请搜索陪玩"
              value={selectedCompanionId || undefined}
              onChange={(val) => setSelectedCompanionId(val)}
              style={{ width: '100%' }}
              filterOption={(input, option) => {
                const label = option?.label ?? option?.children;
                return String(label ?? '').toLowerCase().includes(input.toLowerCase());
              }}
            >
              {adminCompanions
                .filter(
                  (c) =>
                    c.status === CompanionStatus.AVAILABLE
                )
                .map((c) => (
                  <Option key={c.id} value={c.id}>
                    {c.username} ({companionStatusConfig[c.status]?.label})
                  </Option>
                ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

// ──────────────────────────────────── Companion View ────────────────────────────────────

const CompanionView: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { all: 'true' };
      if (statusFilter) params.status = statusFilter;
      const { data } = await ordersApi.list(params);
      setOrders(data.data?.items ?? data.data ?? []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <Text strong style={{ fontSize: 16 }}>派单记录</Text>
          <br /><Text type="secondary">查看全部派单历史</Text>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select placeholder="全部状态" allowClear value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')} style={{ width: 120 }}>
            {Object.entries(orderStatusConfig).map(([k, v]) => <Option key={k} value={k}>{v.label}</Option>)}
          </Select>
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetch} loading={loading}>刷新</Button>
        </div>
      </div>
      <Table size="small" dataSource={orders} rowKey="id" loading={loading}
        columns={[
          { title: '游戏', dataIndex: 'gameName', width: 100 },
          { title: '客户', key: 'wx', width: 120, render: (_: any, r: any) => r.customFields?.customerWechat || r.customer?.wechatId || '-' },
          { title: '所用微信', key: 'workWechat', width: 110, render: (_: any, r: any) => {
            const wx = r.customFields?.workWechatName || r.customFields?.workWechatId;
            return wx ? <Tag color="cyan" style={{fontSize:11,margin:0}}>📱{wx}</Tag> : <Text type="secondary" style={{fontSize:11}}>-</Text>;
          }},
          { title: '状态', dataIndex: 'status', width: 80, render: (s: string) => <Tag color={orderStatusConfig[s]?.color} style={{fontSize:11}}>{orderStatusConfig[s]?.label || s}</Tag> },
          { title: '来源/时间', key: 'source', width: 130, render: (_: any, r: any) => {
            const cf = r.customFields;
            return <>{cf?.customerSource ? <Tag color="orange" style={{fontSize:10,margin:'0 0 2px 0'}}>{cf.customerSource}</Tag> : null}<br /><Text type="secondary" style={{fontSize:10}}>{r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-'}</Text></>;
          }},
        ]}
        pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 条` }}
      />
    </div>
  );
};

// ──────────────────────────────────── Unified DispatchPage ────────────────────────────────────

const DispatchPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;

  const getHeaderTitle = () => {
    switch (role) {
      case UserRole.COMPANION:
        return '派单记录';
      case UserRole.CS:
      case UserRole.ADMIN:
      case UserRole.OWNER:
      default:
        return '派单管理';
    }
  };

  const renderView = () => {
    switch (role) {
      case UserRole.COMPANION:
        return <CompanionView />;
      case UserRole.CS:
        return <CSView />;
      case UserRole.ADMIN:
      case UserRole.OWNER:
        return <AdminView />;
      default:
        return (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Text type="secondary">无法加载派单页面</Text>
          </div>
        );
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <Text strong style={{ fontSize: 16 }}>
          {getHeaderTitle()}
        </Text>
      </div>
      {renderView()}
    </div>
  );
};

export default DispatchPage;
