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
  Statistic,
} from 'antd';
import {
  PlusOutlined,
  UserOutlined,
  DollarOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { CompanionStatus, OrderType, DispatchType } from '@chunlv/shared';
import { companionsApi } from '../../api/companions';
import { ordersApi } from '../../api/orders';
import { customersApi } from '../../api/customers';
import http from '../../api/client';

const { Text } = Typography;
const { Option } = Select;

// Status color mapping per spec: ONLINE=red, IDLE=green, BUSY=gold, OFFLINE=default
const statusConfig: Record<CompanionStatus, { color: string; label: string }> = {
  [CompanionStatus.ONLINE]: { color: 'red', label: '在线' },
  [CompanionStatus.IDLE]: { color: 'green', label: '空闲' },
  [CompanionStatus.BUSY]: { color: 'gold', label: '忙碌' },
  [CompanionStatus.OFFLINE]: { color: 'default', label: '离线' },
};

const STATUS_SORT: Record<string, number> = { IDLE: 0, ONLINE: 1, BUSY: 2, OFFLINE: 3 };

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
  orderType: OrderType;
  customer?: {
    wechatId: string;
  };
}

const DispatchPage: React.FC = () => {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [poolOrders, setPoolOrders] = useState<PoolOrder[]>([]);
  const [loadingCompanions, setLoadingCompanions] = useState(false);
  const [loadingPool, setLoadingPool] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [customers, setCustomers] = useState<{ id: string; wechatId: string }[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [companionSearch, setCompanionSearch] = useState('');
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
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
      const { data } = await ordersApi.pool();
      setPoolOrders(data.data ?? []);
    } catch {
      // silent fail on auto-refresh
    } finally {
      setLoadingPool(false);
    }
  }, []);

  const fetchCustomers = useCallback(async (search: string) => {
    try {
      const { data } = await customersApi.list({ wechatId: search, pageSize: 20 });
      const items = data.data?.items ?? data.data ?? [];
      setCustomers(items);
    } catch {
      // silent
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchCompanions();
    fetchPool();
    fetchCustomers('');
    http.get('/settings').then(({ data }) => {
      const games = (data.data?.games ?? []);
      setGameOptions(['三角洲行动', ...games.filter((g: string) => g !== '三角洲行动')]);
    }).catch(() => {});
  }, [fetchCompanions, fetchPool, fetchCustomers]);

  // Auto-refresh pool every 10 seconds
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchPool();
      fetchCompanions();
    }, 10000);
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

  const handleAssignConfirm = async () => {
    if (!selectedOrderId) return;
    try {
      await ordersApi.assign(selectedOrderId, companionSearch || '');
      message.success('派单成功');
      setAssignModalOpen(false);
      setSelectedOrderId(null);
      setCompanionSearch('');
      fetchPool();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '派单失败';
      message.error(msg);
    } finally {
      setAssigningId(null);
    }
  };

  const openAssignModal = (orderId: string) => {
    setSelectedOrderId(orderId);
    setCompanionSearch('');
    setAssignModalOpen(true);
  };

  const handleCustomerSearch = (val: string) => {
    setCustomerSearch(val);
    fetchCustomers(val);
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
        <Text strong style={{ fontSize: 16 }}>
          派单工作台
        </Text>
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

      <Row gutter={16}>
        {/* Left: Companion Status Panel (6/24) */}
        <Col span={6}>
          <Card
            title="陪玩状态"
            size="small"
            style={{ marginBottom: 16 }}
            extra={
              <Button
                type="text"
                size="small"
                onClick={fetchCompanions}
                loading={loadingCompanions}
              >
                刷新
              </Button>
            }
          >
            {loadingCompanions && companions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
            ) : companions.length === 0 ? (
              <Text type="secondary">暂无陪玩</Text>
            ) : (
              <List size="small" dataSource={sortedCompanions}
                renderItem={(c) => (
                  <List.Item style={{ padding: '8px 0', display: 'block' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                      <Space size="small">
                        <span style={{
                          width: 10, height: 10, borderRadius: '50%', display: 'inline-block',
                          background:
                            c.status === CompanionStatus.BUSY ? '#FF4757' :
                            c.status === CompanionStatus.IDLE ? '#00E676' :
                            c.status === CompanionStatus.ONLINE ? '#FFD600' : '#94A3B8',
                          boxShadow: c.status !== CompanionStatus.OFFLINE
                            ? `0 0 6px ${c.status === CompanionStatus.BUSY ? '#FF4757' : c.status === CompanionStatus.IDLE ? '#00E676' : '#FFD600'}`
                            : 'none',
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

        {/* Center: Order Pool (12/24) */}
        <Col span={12}>
          <Card
            title="订单池"
            size="small"
            extra={
              <Space>
                <Text type="secondary">{poolCount} 单待派</Text>
                <Button
                  type="text"
                  size="small"
                  onClick={fetchPool}
                  loading={loadingPool}
                >
                  刷新
                </Button>
              </Space>
            }
          >
            {loadingPool && poolOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <Spin />
              </div>
            ) : poolOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <Text type="secondary">暂无待派订单</Text>
              </div>
            ) : (
              <List
                grid={{ gutter: 12, column: 1 }}
                dataSource={poolOrders}
                renderItem={(order) => (
                  <List.Item style={{ marginBottom: 0 }}>
                    <Card
                      size="small"
                      hoverable
                      style={{ marginBottom: 8 }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <Space size="small" style={{ marginBottom: 4 }}>
                            <Text strong>{order.gameName}</Text>
                            <Tag color={orderTypeConfig[order.orderType]?.color}>
                              {orderTypeConfig[order.orderType]?.label ?? order.orderType}
                            </Tag>
                          </Space>
                          <div>
                            <Space size="middle">
                              <Text type="secondary">
                                {React.createElement(UserOutlined)} {order.customer?.wechatId ?? '未知客户'}
                              </Text>
                              <Text type="danger">
                                {React.createElement(DollarOutlined)} ¥{order.amount}
                              </Text>
                            </Space>
                          </div>
                        </div>
                        <Button
                          type="primary"
                          size="small"
                          loading={assigningId === order.id}
                          onClick={() => openAssignModal(order.id)}
                        >
                          指定陪玩
                        </Button>
                      </div>
                    </Card>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        {/* Right: Quick Stats (6/24) */}
        <Col span={6}>
          <Card title="快捷统计" size="small" style={{ marginBottom: 16 }}>
            <Row gutter={[0, 16]}>
              <Col span={24}>
                <Statistic
                  title="🟢 空闲"
                  value={idleCount}
                  prefix={React.createElement(UserOutlined)}
                  valueStyle={{ color: '#00E676' }}
                />
              </Col>
              <Col span={24}>
                <Statistic
                  title="🔴 接单中"
                  value={busyCount}
                  prefix={React.createElement(ClockCircleOutlined)}
                  valueStyle={{ color: '#FF4757' }}
                />
              </Col>
              <Col span={24}>
                <Statistic title="🟡 娱乐中" value={entertainCount} valueStyle={{ color: '#FFD600', fontSize: 22 }} />
              </Col>
              <Col span={24}>
                <Statistic title="⚪ 离线" value={offlineCount} valueStyle={{ color: '#94A3B8', fontSize: 22 }} />
              </Col>
              <Col span={24}>
                <Statistic
                  title="待派订单"
                  value={poolCount}
                  prefix={React.createElement(DollarOutlined)}
                  valueStyle={{ color: '#1677ff' }}
                />
              </Col>
            </Row>
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

      {/* Assign Companion Modal */}
      <Modal
        title="指定陪玩"
        open={assignModalOpen}
        onOk={handleAssignConfirm}
        onCancel={() => {
          setAssignModalOpen(false);
          setSelectedOrderId(null);
          setCompanionSearch('');
          setAssigningId(null);
        }}
        confirmLoading={!!assigningId}
        okText="确认派单"
        cancelText="取消"
      >
        <Form layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="选择陪玩">
            <Select
              showSearch
              placeholder="请搜索陪玩姓名"
              value={companionSearch || undefined}
              onChange={(val) => setCompanionSearch(val)}
              style={{ width: '100%' }}
              filterOption={(input, option) => {
                const label = option?.label ?? option?.children;
                return String(label ?? '').toLowerCase().includes(input.toLowerCase());
              }}
            >
              {companions
                .filter(
                  (c) =>
                    c.status === CompanionStatus.IDLE ||
                    c.status === CompanionStatus.ONLINE
                )
                .map((c) => (
                  <Option key={c.id} value={c.id}>
                    {c.user?.username ?? c.id} ({statusConfig[c.status]?.label})
                  </Option>
                ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default DispatchPage;
