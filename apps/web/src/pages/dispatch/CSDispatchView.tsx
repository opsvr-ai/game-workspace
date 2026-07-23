// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Row, Col, Card, Button, Modal, Select, Tag, Typography, Space, message, List, Spin, Input } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { CompanionStatus, OrderType } from '@chunlv/shared';
import { companionsApi } from '../../api/companions';
import { ordersApi } from '../../api/orders';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useSocket } from '../../hooks/useSocket';
import { EmbeddedChatPanel } from '../../components/chat';
import CreateOrderModal from '../../components/CreateOrderModal';
import EmptyState from '../../components/EmptyState';
import { orderTypeConfig, companionStatusConfig, STATUS_SORT, serviceTypeConfig } from '../../constants';

const { Text } = Typography;

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

const CSDispatchView: React.FC = () => {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [poolOrders, setPoolOrders] = useState<PoolOrder[]>([]);
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [todayNew, setTodayNew] = useState(0);
  const [todayGrabbed, setTodayGrabbed] = useState(0);
  const [loadingCompanions, setLoadingCompanions] = useState(false);
  const [loadingPool, setLoadingPool] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCompanion, setSelectedCompanion] = useState<Companion | null>(null);
  const [urgencyFilter, setUrgencyFilter] = useState<string | undefined>();
  const [gameSearch, setGameSearch] = useState('');
  const [companionSearch, setCompanionSearch] = useState('');
  const [selectedCompanionId, setSelectedCompanionId] = useState<string | null>(null);
  const [chatPanelWidth, setChatPanelWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('chat-panel-width');
      return saved ? parseInt(saved, 10) : 320;
    } catch { return 380; }
  });
  // Persist panel width on change (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      localStorage.setItem('chat-panel-width', String(chatPanelWidth));
    }, 500);
    return () => clearTimeout(t);
  }, [chatPanelWidth]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

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
      const [poolRes, allRes] = await Promise.all([ordersApi.pool(), ordersApi.list()]);
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
    onChatNotify: () => {},
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
  const conversations = useChatStore((s) => s.conversations);

  // Stats — sort: messages first, then by status
  const sortedCompanions = useMemo(
    () =>
      [...companions].sort((a, b) => {
        const aMsg = conversations[a.id]?.unreadCount > 0 ? 1 : 0;
        const bMsg = conversations[b.id]?.unreadCount > 0 ? 1 : 0;
        if (aMsg !== bMsg) return bMsg - aMsg;
        return (STATUS_SORT[a.status] ?? 9) - (STATUS_SORT[b.status] ?? 9);
      }),
    [companions, conversations],
  );

  // Filter companions by name search
  const filteredCompanions = useMemo(
    () =>
      companionSearch
        ? sortedCompanions.filter((c) => {
            const name = (c.user as any)?.displayName || c.user?.username || '';
            return name.toLowerCase().includes(companionSearch.toLowerCase());
          })
        : sortedCompanions,
    [sortedCompanions, companionSearch],
  );

  const idleCount = companions.filter((c) => c.status === CompanionStatus.AVAILABLE).length;
  const busyCount = companions.filter((c) => c.status === CompanionStatus.BUSY).length;
  const entertainCount = companions.filter((c) => c.status === CompanionStatus.ENTERTAINMENT).length;
  const restingCount = companions.filter((c) => c.status === CompanionStatus.RESTING).length;
  const offlineCount = companions.filter((c) => c.status === CompanionStatus.OFFLINE).length;
  const poolCount = poolOrders.length;

  // Apply filters
  const filteredOrders = useMemo(() => {
    let result = poolOrders;
    if (gameSearch) result = result.filter((o) => o.gameName?.toLowerCase().includes(gameSearch.toLowerCase()));
    if (urgencyFilter) result = result.filter((o) => (o as any).customFields?.urgency === urgencyFilter);
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
        <Button type="primary" icon={React.createElement(PlusOutlined)} onClick={() => setModalOpen(true)}>
          发布订单
        </Button>
      </div>

      <Row gutter={12}>
        {/* Left: Companion sidebar */}
        <Col span={3}>
          <Card
            title="陪玩管理"
            size="small"
            style={{ marginBottom: 12 }}
            bodyStyle={{ padding: '8px 6px', maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}
          >
            {/* Companion search filter */}
            <Input
              size="small"
              placeholder="搜索陪玩..."
              value={companionSearch}
              onChange={(e) => setCompanionSearch(e.target.value)}
              allowClear
              style={{ marginBottom: 8 }}
            />
            {loadingCompanions && companions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <Spin />
              </div>
            ) : filteredCompanions.length === 0 && companionSearch ? (
              <Text type="secondary">未找到匹配的陪玩</Text>
            ) : companions.length === 0 ? (
              <Text type="secondary">暂无陪玩</Text>
            ) : (
              <List
                size="small"
                dataSource={filteredCompanions}
                renderItem={(c) => {
                  const isSelected = selectedCompanionId === c.id;
                  const companionConvUnread = useChatStore.getState().conversations[c.id]?.unreadCount || 0;
                  const hasUnread = companionConvUnread > 0;
                  return (
                    <List.Item
                      style={{
                        padding: '8px 6px',
                        display: 'block',
                        cursor: 'pointer',
                        borderLeft: isSelected ? '3px solid #2563EB' : '3px solid transparent',
                        paddingLeft: isSelected ? 10 : 10,
                        borderRadius: '0 6px 6px 0',
                        transition: 'transform 0.15s ease, background 0.15s ease',
                        background: isSelected ? '#EFF6FF' : 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'translateX(2px)';
                        e.currentTarget.style.background = 'rgba(0,212,255,0.04)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'translateX(0)';
                        if (!isSelected) e.currentTarget.style.background = 'transparent';
                      }}
                      onClick={() => {
                        setSelectedCompanionId(c.id);
                        // Mark read via chatStore instead of localStorage
                        const store = useChatStore.getState();
                        if (store.conversations[c.id]) {
                          store.markRead(c.id);
                        }
                        const u = c.user as any;
                        // Find matching order for this companion (check both pool and assigned)
                        const order = [...poolOrders, ...allOrders].find((o: any) => o.companionId === c.id);
                        const orderInfo = order
                          ? `${order.gameName} · ¥${Number(order.amount || 0).toFixed(0)}${order.duration ? ' · ' + order.duration + 'h' : ''}${order.customer?.customerCode ? ' · 客户' + order.customer.customerCode : ''}`
                          : undefined;
                        // Open conversation via new store
                        useChatStore.getState().openConversation(
                          c.id,
                          {
                            userId: u?.id || c.id,
                            username: u?.username || c.id,
                            displayName: u?.displayName,
                            avatar: u?.avatar,
                            role: 'COMPANION',
                          },
                          orderInfo,
                        );
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          width: '100%',
                        }}
                      >
                        <Space size="small">
                          {(() => {
                            const u = c.user as any;
                            const avatarUrl = u?.avatar ? `/uploads/avatars/${u.avatar}?v=${u.avatar}` : null;
                            const initial = (u?.displayName || u?.username || '?')[0].toUpperCase();
                            return (
                              <div
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: '50%',
                                  background: avatarUrl ? `url(${avatarUrl}) center/cover` : '#2563EB',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  boxShadow:
                                    c.status !== CompanionStatus.OFFLINE
                                      ? `0 0 6px ${c.status === CompanionStatus.BUSY ? '#FF4757' : c.status === CompanionStatus.ENTERTAINMENT ? '#00E676' : '#FFD600'}`
                                      : 'none',
                                  flexShrink: 0,
                                }}
                              >
                                {!avatarUrl && (
                                  <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>{initial}</span>
                                )}
                              </div>
                            );
                          })()}
                          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {/* Unread dot */}
                            {hasUnread && (
                              <span
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: '50%',
                                  background: '#FF4757',
                                  flexShrink: 0,
                                  boxShadow: '0 0 4px #FF4757',
                                }}
                              />
                            )}
                            <Text strong>
                              {c.user?.username ?? c.id}
                            </Text>
                            {(c as any).processStatus === 'BLOCKED' && (
                              <Tag color="red" style={{ fontSize: 11, padding: '1px 6px', lineHeight: '20px' }}>
                                已限制
                              </Tag>
                            )}
                            {(c as any).processStatus === 'WARNING' && (
                              <Tag color="orange" style={{ fontSize: 11, padding: '1px 6px', lineHeight: '20px' }}>
                                ⚠️ 进程异常
                              </Tag>
                            )}
                          </span>
                        </Space>
                        <Tag color={companionStatusConfig[c.status]?.color || 'default'}>
                          {companionStatusConfig[c.status]?.label || c.status}
                        </Tag>
                      </div>
                      {/* Game profile */}
                      {c.games && c.games.length > 0 && typeof c.games[0] === 'object' && (
                        <div style={{ marginTop: 4, marginLeft: 22, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {c.games.map((g: any, i: number) => (
                            <Tag
                              key={i}
                              style={{ fontSize: 11, padding: '1px 6px', lineHeight: '18px', opacity: 0.85 }}
                            >
                              {g.game} <span style={{ color: '#7C3AED' }}>{g.rank || '?'}</span>
                            </Tag>
                          ))}
                        </div>
                      )}
                    </List.Item>
                  );
                }}
              />
            )}
          </Card>
        </Col>

        {/* Center: Order Pool */}
        <Col span={16} style={{ maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' }}>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            {/* Order pool header */}
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: '8px 8px 0 0',
                padding: '16px 24px',
                borderBottom: '1px solid #E2E8F0',
              }}
            >
              <Space>
                <Text strong style={{ color: '#1E293B', fontSize: 16 }}>
                  订单池
                </Text>
                <Tag
                  color="white"
                  style={{ color: '#7C3AED', fontWeight: 700, borderRadius: 10, padding: '2px 12px', border: 'none' }}
                >
                  {poolCount} 单待派
                </Tag>
                <span style={{ color: '#64748B', fontSize: 12, marginLeft: 8 }}>
                  今日新增 <b style={{ color: '#2563EB' }}>{todayNew}</b> · 已接{' '}
                  <b style={{ color: '#16A34A' }}>{todayGrabbed}</b> · 剩余{' '}
                  <b style={{ color: '#F59E0B' }}>{poolCount}</b>
                </span>
              </Space>
            </div>
            {/* Pool body */}
            <div
              style={{
                background: '#FFF',
                borderRadius: '0 0 16px 16px',
                padding: '16px 20px',
                minHeight: 400,
                boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
              }}
            >
              {/* Filter bar */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <Input.Search
                  placeholder="搜索游戏名"
                  value={gameSearch}
                  onChange={(e) => setGameSearch(e.target.value)}
                  allowClear
                  style={{ width: 200 }}
                  size="small"
                />
                <Select
                  placeholder="紧急程度"
                  value={urgencyFilter}
                  onChange={setUrgencyFilter}
                  allowClear
                  style={{ width: 120 }}
                  size="small"
                >
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
                <div style={{ textAlign: 'center', padding: 48 }}>
                  <Spin size="large" />
                </div>
              ) : poolOrders.length === 0 ? (
                <EmptyState description="暂无待派订单" />
              ) : (
                <List
                  grid={{ gutter: [0, 8], column: 1 }}
                  dataSource={filteredOrders}
                  renderItem={(order, idx) => (
                    <List.Item style={{ marginBottom: 0 }}>
                      <div
                        style={{
                          background: '#FFF',
                          borderRadius: 10,
                          padding: '8px 14px',
                          border: '1px solid #F1F5F9',
                          transition: 'all 0.2s',
                          animation: 'fade-slide-in 0.3s ease',
                        }}
                      >
                        <Row align="middle" gutter={8} wrap={false}>
                          <Col>
                            <Tag
                              style={{
                                background: '#f0f0f0',
                                color: '#666',
                                fontWeight: 700,
                                minWidth: 24,
                                textAlign: 'center',
                                margin: 0,
                              }}
                            >
                              {idx + 1}
                            </Tag>
                          </Col>
                          <Col>
                            <Tag color={orderTypeConfig[order.type]?.color || 'blue'} style={{ margin: 0 }}>
                              {orderTypeConfig[order.type]?.label || order.type}
                            </Tag>
                          </Col>
                          <Col>
                            <Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
                              {order.gameName}
                            </Text>
                          </Col>
                          <Col>
                            <Text style={{ fontSize: 14, fontWeight: 700, color: '#2563EB', whiteSpace: 'nowrap' }}>
                              ¥{Number(order.amount).toFixed(0)}
                            </Text>
                          </Col>
                          {order.customFields?.deltaMission && (
                            <Col>
                              <Tag style={{ margin: 0 }}>{order.customFields.deltaMission}</Tag>
                            </Col>
                          )}
                          {order.customFields?.deltaCount && (
                            <Col>
                              <Tag style={{ margin: 0 }}>{order.customFields.deltaCount}</Tag>
                            </Col>
                          )}
                          {order.customFields?.serviceType && (
                            <Col>
                              <Tag
                                color={serviceTypeConfig[order.customFields.serviceType]?.color}
                                style={{ margin: 0 }}
                              >
                                {serviceTypeConfig[order.customFields.serviceType]?.label ||
                                  order.customFields.serviceType}
                              </Tag>
                            </Col>
                          )}
                          {order.customFields?.gameMode && (
                            <Col>
                              <Tag color="geekblue" style={{ margin: 0 }}>
                                {order.customFields.gameMode}
                              </Tag>
                            </Col>
                          )}
                          {order.customFields?.customerSource && (
                            <Col>
                              <Tag color="orange" style={{ margin: 0 }}>
                                📡{order.customFields.customerSource}
                              </Tag>
                            </Col>
                          )}
                          {order.customFields?.customerWechat && (
                            <Col>
                              <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                                💬{order.customFields.customerWechat}
                              </Text>
                            </Col>
                          )}
                          {order.customFields?.customerRoomCode && (
                            <Col>
                              <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                                🏠{order.customFields.customerRoomCode}
                              </Text>
                            </Col>
                          )}
                          {order.customFields?.urgency === 'later' && (
                            <Col>
                              <Tag color="purple" style={{ margin: 0 }}>
                                📅预约
                              </Tag>
                            </Col>
                          )}
                          {order.customFields?.urgency !== 'later' && (
                            <Col>
                              <Tag color="green" style={{ margin: 0 }}>
                                ⚡立即打
                              </Tag>
                            </Col>
                          )}
                          <Col>
                            <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                              发布:{order.csUser?.username || order.customFields?.createdBy || '未知'}
                            </Text>
                          </Col>
                          {order.customFields?.deltaNote && (
                            <Col>
                              <Text type="warning" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                                📝{order.customFields.deltaNote}
                              </Text>
                            </Col>
                          )}
                          {order.customFields?.billingMode === 'round' ? (
                            <Col>
                              <Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                                🎯{order.duration || order.customFields?.deltaCount || '?'}局
                              </Text>
                            </Col>
                          ) : (
                            order.duration && (
                              <Col>
                                <Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                                  ⏱{order.duration}h
                                </Text>
                              </Col>
                            )
                          )}
                          <Col flex="auto" />
                          <Col>
                            <Space size={6}>
                              <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                                {order.createdAt
                                  ? new Date(order.createdAt).toLocaleString('zh-CN', {
                                      month: '2-digit',
                                      day: '2-digit',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : ''}
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

        {/* Right: Stats + Chat panel */}
        <Col span={5}>
          <Card title="统计" size="small" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>🟢 空闲</span>
                <b style={{ color: '#00E676' }}>{idleCount}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>🔴 接单</span>
                <b style={{ color: '#FF4757' }}>{busyCount}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>🟡 娱乐</span>
                <b style={{ color: '#FFD600' }}>{entertainCount}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>🟠 休息</span>
                <b style={{ color: '#FF9500' }}>{restingCount}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>⚪ 离线</span>
                <b style={{ color: '#94A3B8' }}>{offlineCount}</b>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 13,
                  borderTop: '1px solid #E2E8F0',
                  paddingTop: 8,
                }}
              >
                <span>📦 待派</span>
                <b style={{ color: '#1677ff' }}>{poolCount}</b>
              </div>
            </div>
          </Card>
        {/* Chat panel below stats */}
        {selectedCompanionId && (
          <div style={{ marginTop: 8 }}>
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                resizeRef.current = { startX: e.clientX, startW: chatPanelWidth };
                const onMove = (ev: MouseEvent) => {
                  if (!resizeRef.current) return;
                  const delta = resizeRef.current.startX - ev.clientX;
                  setChatPanelWidth(Math.min(600, Math.max(300, resizeRef.current.startW + delta)));
                };
                const onUp = () => {
                  resizeRef.current = null;
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
              style={{
                width: 4, cursor: 'col-resize', flexShrink: 0,
                background: 'transparent', transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#E0E2E5'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'transparent'; }}
            />
            <div style={{
              background: '#FFF', borderRadius: 10,
              boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              width: chatPanelWidth, minWidth: 300, maxWidth: 600,
              height: 500, minHeight: 360, maxHeight: 'calc(100vh - 140px)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
            <EmbeddedChatPanel
              onClose={() => {
                useChatStore.getState().closeConversation();
                setSelectedCompanionId(null);
              }}
            />
            </div>
          </div>
        )}
        </Col>
      </Row>

      <CreateOrderModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={fetchPool}
        userId={useAuthStore.getState().user?.id}
      />

      {/* Companion detail modal */}
      <Modal
        title={null}
        open={!!selectedCompanion}
        onCancel={() => setSelectedCompanion(null)}
        footer={null}
        width={420}
        style={{ top: 60 }}
      >
        {selectedCompanion && (
          <div style={{ textAlign: 'center' }}>
            <span
              style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                display: 'inline-block',
                marginBottom: 8,
                background:
                  selectedCompanion.status === CompanionStatus.BUSY
                    ? '#FF4757'
                    : selectedCompanion.status === CompanionStatus.ENTERTAINMENT
                      ? '#00E676'
                      : selectedCompanion.status === CompanionStatus.AVAILABLE
                        ? '#FFD600'
                        : '#94A3B8',
                boxShadow:
                  selectedCompanion.status !== CompanionStatus.OFFLINE
                    ? `0 0 16px ${selectedCompanion.status === CompanionStatus.BUSY ? '#FF4757' : selectedCompanion.status === CompanionStatus.ENTERTAINMENT ? '#00E676' : '#FFD600'}`
                    : 'none',
                animation:
                  selectedCompanion.status !== CompanionStatus.OFFLINE ? 'pulse-glow 2s ease-in-out infinite' : 'none',
              }}
            />
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
              {selectedCompanion.user?.username ?? selectedCompanion.id}
            </div>
            <Tag color={companionStatusConfig[selectedCompanion.status]?.color || 'default'}>
              {companionStatusConfig[selectedCompanion.status]?.label || selectedCompanion.status}
            </Tag>
            <div style={{ marginTop: 16, textAlign: 'left', background: '#F8FAFC', borderRadius: 10, padding: 14 }}>
              {selectedCompanion.games &&
              selectedCompanion.games.length > 0 &&
              typeof selectedCompanion.games[0] === 'object' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedCompanion.games.map((g: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span>🎮 {g.game}</span>
                      <span style={{ color: '#7C3AED', fontWeight: 600 }}>{g.rank || '?'}</span>
                      <span style={{ color: g.hasAccount ? '#34C759' : '#94A3B8' }}>
                        {g.hasAccount ? '有号' : '无号'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Text type="secondary">未设置游戏资料</Text>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default CSDispatchView;
