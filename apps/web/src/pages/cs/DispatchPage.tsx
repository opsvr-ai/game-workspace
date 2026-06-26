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
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { CompanionStatus, OrderType, DispatchType } from '@chunlv/shared';
import { companionsApi } from '../../api/companions';
import { ordersApi } from '../../api/orders';
import http from '../../api/client';
import { useAuthStore } from '../../stores/authStore';

const { Text } = Typography;
const { Option } = Select;

const STATUS_SORT: Record<string, number> = { IDLE: 0, ONLINE: 1, BUSY: 2, OFFLINE: 9 };

const orderTypeConfig: Record<OrderType, { color: string; label: string }> = {
  [OrderType.NEW]: { color: 'blue', label: '新单' },
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
  const user = useAuthStore((s) => s.user);
  const isCS = user?.role === 'CS' || user?.role === 'ADMIN' || user?.role === 'OWNER';
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [poolOrders, setPoolOrders] = useState<PoolOrder[]>([]);
  const [todayNew, setTodayNew] = useState(0);
  const [todayGrabbed, setTodayGrabbed] = useState(0);
  const [loadingCompanions, setLoadingCompanions] = useState(false);
  const [loadingPool, setLoadingPool] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [grabbingId, setGrabbingId] = useState<string | null>(null);
  const [chatOrder, setChatOrder] = useState<PoolOrder | null>(null);
  const [chatMessages, setChatMessages] = useState<{ text: string; time: string; from: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);
  const [selectedCompanion, setSelectedCompanion] = useState<Companion | null>(null);
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

  // Auto-refresh pool every 10 seconds
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchPool();
      fetchCompanions();
    }, 60000);
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

  const handleGrab = async (orderId: string, e: React.MouseEvent) => {
    // 轨迹动画：给卡片加 grabbing class
    const card = (e.currentTarget as HTMLElement).closest('.pool-card') as HTMLElement;
    if (card) { card.classList.add('grabbing'); setTimeout(() => card.classList.remove('grabbing'), 600); }
    setGrabbingId(orderId);
    try {
      await ordersApi.grab(orderId);
      message.success('接单成功，已收录至客户系统');
      fetchPool();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '接单失败';
      message.error(msg);
    } finally {
      setGrabbingId(null);
    }
  };

  const handleChatSend = () => {
    const val = chatInput.trim();
    if (!val) return;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    setChatMessages(prev => [...prev, { text: val, time, from: 'me' }]);
    setChatInput('');
    setTimeout(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }, 50);
  };

  // Stats
  const sortedCompanions = useMemo(() =>
    [...companions].sort((a, b) => (STATUS_SORT[a.status] ?? 9) - (STATUS_SORT[b.status] ?? 9)),
    [companions]);

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
              billingMode: 'hour', duration: 1, deltaMode: '陪玩', deltaCount: '单陪',
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
                    onClick={() => setSelectedCompanion(c)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <Space size="small">
                        <span style={{
                          width: 10, height: 10, borderRadius: '50%', display: 'inline-block',
                          background:
                            c.status === CompanionStatus.BUSY ? '#FF4757' :
                            c.status === CompanionStatus.IDLE ? '#00E676' :
                            c.status === CompanionStatus.ONLINE ? '#FFD600' : '#94A3B8',
                          boxShadow: c.status !== CompanionStatus.OFFLINE
                            ? `0 0 8px ${c.status === CompanionStatus.BUSY ? '#FF4757' : c.status === CompanionStatus.IDLE ? '#00E676' : '#FFD600'}`
                            : 'none',
                          animation: c.status !== CompanionStatus.OFFLINE ? 'pulse-glow 2s ease-in-out infinite' : 'none',
                        }} />
                        <Text strong>{c.user?.username ?? c.id}</Text>
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
                <List grid={{ gutter: [12, 12], column: 1 }} dataSource={poolOrders}
                  renderItem={(order) => (
                    <List.Item style={{ marginBottom: 0 }}>
                      <div style={{
                        background: '#FFF', borderRadius: 10, padding: '8px 14px',
                        border: '1px solid #E8ECF1', transition: 'all 0.2s',
                        animation: 'fade-slide-in 0.3s ease',
                      }} className="pool-card">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', flex: 1 }}>
                            <span style={{ fontSize: 16, fontWeight: 700, color: '#1E293B' }}>{order.gameName}</span>
                            <Tag color={orderTypeConfig[order.type]?.color} style={{ fontSize: 13, padding: '2px 10px', borderRadius: 6 }}>{orderTypeConfig[order.type]?.label ?? order.type}</Tag>
                            {order.customFields?.deltaMode && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#F0F0FF', borderRadius: 8, padding: '4px 10px', fontSize: 13, color: '#7B61FF', fontWeight: 600 }}>
                                🎯 {order.customFields.deltaMode}
                              </span>
                            )}
                            {order.customFields?.deltaMission && (
                              <span style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>· {order.customFields.deltaMission}</span>
                            )}
                            {order.customFields?.deltaCount && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#FFF7ED', borderRadius: 8, padding: '4px 10px', fontSize: 13, color: '#FF9100', fontWeight: 600 }}>
                                👥 {order.customFields.deltaCount}
                              </span>
                            )}
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#F1F5F9', borderRadius: 8, padding: '4px 10px', fontSize: 13, color: '#475569', fontWeight: 500 }}>
                              ⏱ {order.duration || '-'}{order.customFields?.billingMode === 'round' ? '局' : 'h'}
                            </span>
                            <span style={{ fontSize: 13, color: '#1E293B' }}>
                              ¥{Number(order.amount).toFixed(2)}
                            </span>
                            {order.customFields?.deltaNote && (
                              <span style={{ fontSize: 14, fontWeight: 700, color: '#FF4757', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={order.customFields.deltaNote}>
                                📝 {order.customFields.deltaNote}
                              </span>
                            )}
                            {order.customFields?.customerWechat && (
                              <span style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>
                                💬 {isCS ? order.customFields.customerWechat : '✳️✳️✳️'}
                              </span>
                            )}
                            {order.customFields?.customerRoomCode && (
                              <span style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>
                                🏠 {isCS ? order.customFields.customerRoomCode : '✳️✳️✳️'}
                              </span>
                            )}
                          </div>
                          {order.csUser?.username && (
                            <span onClick={() => setChatOrder(order)}
                              style={{ fontSize: 12, color: '#00D4FF', cursor: 'pointer', fontWeight: 600, borderBottom: '1px dashed #00D4FF', whiteSpace: 'nowrap' }}>
                              💬 {order.csUser.username}
                            </span>
                          )}
                          <span style={{ fontSize: 12, color: '#94A3B8', whiteSpace: 'nowrap', flexShrink: 0, minWidth: 80, textAlign: 'right' }}>
                            {order.createdAt ? new Date(order.createdAt).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : ''}
                          </span>
                          <Button type="primary" size="middle" loading={grabbingId === order.id}
                            onClick={(e) => handleGrab(order.id, e)}
                            style={{ borderRadius: 8, fontWeight: 600, fontSize: 14, height: 36, paddingInline: 20, flexShrink: 0 }}
                            className="grab-btn">
                            接 单
                          </Button>
                        </div>
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

      {/* Create Order Modal */}
      <Modal
        title="创建订单"
        open={modalOpen}
        onOk={handleCreateOrder}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        confirmLoading={submitting}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="type"
            label="订单类型"
            initialValue="NEW"
            rules={[{ required: true, message: '请选择订单类型' }]}
          >
            <Select placeholder="请选择订单类型">
              {Object.entries(orderTypeConfig).map(([key, cfg]) => (
                <Option key={key} value={key}>
                  {cfg.label}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            name="gameName"
            label="游戏名称"
            rules={[{ required: true, message: '请选择游戏' }]}
          >
            <Select placeholder="请选择游戏" showSearch>
              {gameOptions.map((g) => (
                <Option key={g} value={g}>{g}</Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.gameName !== cur.gameName}>
            {({ getFieldValue }) =>
              getFieldValue('gameName') === '三角洲行动' ? (
                <>
                  <Form.Item initialValue="陪玩" name="deltaMode" label="模式" rules={[{ required: true, message: '请选择' }]}>
                    <Select placeholder="请选择模式">
                      <Option value="护航">护航</Option>
                      <Option value="陪玩">陪玩</Option>
                    </Select>
                  </Form.Item>
                  <Form.Item name="deltaMission" label="任务类型">
                    <Select placeholder="请选择任务（可选）" allowClear>
                      <Option value="机密">机密</Option>
                      <Option value="绝密">绝密</Option>
                      <Option value="陪做任务">陪做任务</Option>
                    </Select>
                  </Form.Item>
                  <Form.Item initialValue="单陪" name="deltaCount" label="陪陪数量">
                    <Select placeholder="请选择">
                      <Option value="单陪">单陪</Option>
                      <Option value="双陪">双陪</Option>
                    </Select>
                  </Form.Item>
                  <Form.Item name="deltaNote" label="备注">
                    <Input.TextArea rows={2} placeholder="补充说明（可选）" />
                  </Form.Item>
                </>
              ) : null
            }
          </Form.Item>
          <Form.Item
            name="amount"
            label="金额"
            rules={[{ required: true, message: '请输入金额' }]}
          >
            <InputNumber
              min={0}
              precision={2}
              style={{ width: '100%' }}
              placeholder="请输入金额"
              prefix="¥"
            />
          </Form.Item>
          <Form.Item
            initialValue={DispatchType.POOL} name="dispatchType"
            label="派单方式"
            rules={[{ required: true, message: '请选择派单方式' }]}
          >
            <Select placeholder="请选择派单方式">
              <Option value={DispatchType.POOL}>入池抢单</Option>
              <Option value={DispatchType.DIRECT}>指定派单</Option>
            </Select>
          </Form.Item>
          <Form.Item label="客户预留信息" style={{ marginBottom: 8 }}>
            <Input.Group compact>
              <Form.Item name="customerWechat" noStyle>
                <Input style={{ width: '50%' }} placeholder="微信" />
              </Form.Item>
              <Form.Item name="customerRoomCode" noStyle>
                <Input style={{ width: '50%' }} placeholder="房间码" />
              </Form.Item>
            </Input.Group>
          </Form.Item>
          <Form.Item name="billingMode" label="计费方式" initialValue="hour">
            <Select>
              <Option value="hour">按小时</Option>
              <Option value="round">按局数</Option>
            </Select>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.billingMode !== cur.billingMode}>
            {({ getFieldValue }) =>
              getFieldValue('billingMode') === 'round' ? (
                <Form.Item name="duration" label="局数">
                  <InputNumber min={1} step={1} style={{ width: '100%' }} placeholder="请输入局数" />
                </Form.Item>
              ) : (
                <Form.Item name="duration" label="时长（小时）" initialValue={1}>
                  <InputNumber min={0.5} step={0.5} style={{ width: '100%' }} placeholder="请输入时长" />
                </Form.Item>
              )
            }
          </Form.Item>
        </Form>
      </Modal>

      {/* 微信风格聊天弹窗 */}
      <Modal title={null} open={!!chatOrder} onCancel={() => { setChatOrder(null); setChatMessages([]); setChatInput(''); }} footer={null}
        width={440} style={{ top: 20 }} bodyStyle={{ padding: 0 }}>
        {chatOrder && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '70vh', maxHeight: 600 }}>
            {/* 顶部订单信息 */}
            <div style={{ background: '#EDEDED', padding: '10px 16px', borderBottom: '1px solid #D9D9D9' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#1E293B', textAlign: 'center' }}>
                💬 {chatOrder.csUser?.username}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: 11, color: '#8E8E93', marginTop: 4, justifyContent: 'center' }}>
                <span>📋 {chatOrder.gameName}</span>
                <span>· {orderTypeConfig[chatOrder.type]?.label}</span>
                <span>· ¥{Number(chatOrder.amount).toFixed(2)}</span>
                <span>· ⏱{chatOrder.duration||'-'}h</span>
                {chatOrder.customFields?.billingMode && <span>· {chatOrder.customFields.billingMode === 'round' ? '按局' : '按小时'}</span>}
                {chatOrder.customFields?.deltaMode && <span>· 🎯{chatOrder.customFields.deltaMode}</span>}
                {chatOrder.customFields?.deltaMission && <span>· {chatOrder.customFields.deltaMission}</span>}
                {chatOrder.customFields?.deltaCount && <span>· 👥{chatOrder.customFields.deltaCount}</span>}
                {chatOrder.customFields?.deltaNote && <span>· 📝{chatOrder.customFields.deltaNote}</span>}
              </div>
            </div>
            {/* 聊天记录区 */}
            <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', background: '#EDEDED' }}>
              {chatMessages.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#8E8E93', fontSize: 13, marginTop: 60 }}>
                  暂无消息，发送消息开始对话
                </div>
              ) : (
                chatMessages.map((msg, i) => {
                  const isMe = msg.from === 'me';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 16,
                      flexDirection: isMe ? 'row-reverse' : 'row' }}>
                      {/* 头像 */}
                      <div style={{
                        width: 36, height: 36, borderRadius: 4, flexShrink: 0,
                        background: isMe ? '#95EC69' : '#FFF',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 700, color: isMe ? '#FFF' : '#07C160',
                        marginLeft: isMe ? 10 : 0, marginRight: isMe ? 0 : 10,
                      }}>
                        {(isMe ? (user?.username||'我') : (chatOrder.csUser?.username||'?')).charAt(0).toUpperCase()}
                      </div>
                      {/* 气泡+时间 */}
                      <div style={{ maxWidth: '65%', position: 'relative' }}>
                        <div style={{ fontSize: 10, color: '#B0B0B0', marginBottom: 3, textAlign: isMe ? 'right' : 'left' }}>
                          {msg.time}
                        </div>
                        <div style={{
                          padding: '9px 12px', borderRadius: 4, fontSize: 15, lineHeight: 1.4, wordBreak: 'break-word',
                          background: isMe ? '#95EC69' : '#FFF',
                          color: '#1E293B',
                          position: 'relative',
                        }}>
                          {/* 小三角 */}
                          <div style={{
                            position: 'absolute', top: 10,
                            [isMe ? 'right' : 'left']: -5,
                            width: 0, height: 0,
                            borderTop: '5px solid transparent',
                            borderBottom: '5px solid transparent',
                            [isMe ? 'borderLeft' : 'borderRight']: `5px solid ${isMe ? '#95EC69' : '#FFF'}`,
                          }} />
                          {msg.text}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {/* 底部输入栏 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              background: '#F7F7F7', borderTop: '1px solid #D9D9D9' }}>
              <Input style={{ flex: 1, borderRadius: 6, background: '#FFF', border: '1px solid #E5E5E5' }}
                placeholder="输入消息..." value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onPressEnter={() => handleChatSend()}
              />
              <Button type="primary" size="small" style={{ borderRadius: 6, background: '#07C160', borderColor: '#07C160' }}
                onClick={handleChatSend}>
                发送
              </Button>
            </div>
          </div>
        )}
      </Modal>

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
