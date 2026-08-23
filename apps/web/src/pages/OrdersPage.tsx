// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback } from 'react';
import {
  Typography,
  Button,
  Select,
  DatePicker,
  message,
  Badge,
  Tag,
  Image,
  Modal,
  Input,
  Tooltip,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { extractErrorMessage } from '../utils/error-handler';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import OrderRow from '../components/OrderRow';
import CreateOrderModal from '../components/CreateOrderModal';
import ChatModal from '../components/ChatModal';
import { orderStatusConfig } from '../constants';
import PageHeader from '../components/PageHeader';
import TableSkeleton from '../components/TableSkeleton';

const { Text } = Typography;
const { Option } = Select;

const OrdersPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isCompanion = user?.role === 'COMPANION';

  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [preFill, setPreFill] = useState<any>(null);
  const [dateFilter, setDateFilter] = useState<any>(null);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [gameSearch, setGameSearch] = useState('');
  const [companionFilter, setCompanionFilter] = useState<string>('');
  const [companions, setCompanions] = useState<any[]>([]);
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const [chatPartner, setChatPartner] = useState<any>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      const { data } = await http.get('/orders', { params });
      setOrders(data.data?.items ?? data.data ?? []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  // Companion-only action buttons
  const renderCompanionActions = (r: any) => {
    const hasWorkWechat = r.customFields?.workWechatName || r.customFields?.workWechatId;
    const contactDisabled = !hasWorkWechat;

    return (
      <>
        <Badge count={unreadMap[r.id] || 0} size="small">
          <Button
            size="small"
            onClick={() => {
              localStorage.removeItem(`unread-${r.id}`);
              setUnreadMap((prev) => {
                const { [r.id]: _, ...rest } = prev;
                return rest;
              });
              const csUser = r.csUser;
              if (csUser?.id) {
                const orderInfo = [
                  `📋 ${r.gameName}`,
                  `¥${Number(r.amount).toFixed(0)}`,
                  r.duration ? `${r.duration}h` : '',
                ]
                  .filter(Boolean)
                  .join(' · ');
                useChatStore.getState().openConversation(
                  csUser.id,
                  {
                    userId: csUser.id,
                    username: csUser.username || '未知',
                    displayName: csUser.displayName,
                    avatar: csUser.avatar,
                    role: csUser.role || 'CS',
                  },
                  orderInfo,
                );
                setChatPartner({
                  conversationId: csUser.id,
                  participant: {
                    userId: csUser.id,
                    username: csUser.username || '未知',
                    displayName: csUser.displayName,
                    avatar: csUser.avatar,
                    role: csUser.role || 'CS',
                  },
                  orderInfo,
                });
              }
            }}
          >
            沟通
          </Button>
        </Badge>
        {(r.status === 'GRABBED' || r.status === 'CONFIRMED') && !r.contactStatus && (
          <>
            <Tooltip title={contactDisabled ? '请先在"工作微信"列选择微信' : undefined}>
              <Button
                type="primary"
                size="small"
                disabled={contactDisabled}
                style={{
                  background: contactDisabled ? undefined : '#16A34A',
                  borderColor: contactDisabled ? undefined : '#16A34A',
                }}
                onClick={async () => {
                  try {
                    await http.put(`/orders/${r.id}/contact`, { contactStatus: 'added' });
                    message.success('已添加成功，正在进入客户管理');
                    window.location.href = '/companion/customers';
                  } catch (e: any) {
                    message.error(extractErrorMessage(e, '操作失败'));
                  }
                }}
              >
                ✅ 添加成功
              </Button>
            </Tooltip>
            <Tooltip title={contactDisabled ? '请先在"工作微信"列选择微信' : undefined}>
              <Button
                danger
                size="small"
                disabled={contactDisabled}
                onClick={async () => {
                  try {
                    await http.put(`/orders/${r.id}/contact`, {
                      contactStatus: 'not_accepted',
                      notes: '客户一直没同意',
                    });
                    message.success('已标记添加失败');
                    fetch();
                  } catch (e: any) {
                    message.error(extractErrorMessage(e, '操作失败'));
                  }
                }}
              >
                ❌ 添加失败
              </Button>
            </Tooltip>
          </>
        )}
        {r.status === 'GRABBED' && r.contactStatus === 'not_accepted' && (
          <>
            <Tag color="orange">待客户同意</Tag>
            {r.screenshotUrl && <Image src={r.screenshotUrl} width={40} style={{ marginLeft: 4, borderRadius: 4 }} />}
            <Button
              type="primary"
              size="small"
              style={{ background: '#16A34A', borderColor: '#16A34A' }}
              onClick={async () => {
                try {
                  await http.put(`/orders/${r.id}/contact`, { contactStatus: 'added' });
                  message.success('已标记为客户同意');
                  fetch();
                } catch (e: any) {
                  message.error(extractErrorMessage(e, '操作失败'));
                }
              }}
            >
              客户已同意
            </Button>
          </>
        )}
        {r.status === 'DONE' && (
          <Button size="small" type="primary" onClick={() => {
            setPreFill({
              customerId: r.customerId,
              companionId: user?.companionId,
              coCompanionId: r.coCompanionId || undefined,
              gameName: r.gameName,
              amount: r.amount,
              coAmount: r.coAmount,
              dispatchType: 'DIRECT',
            });
            setCreateOpen(true);
          }}>续单</Button>
        )}
      </>
    );
  };

  // Load companions for filter + reassign
  useEffect(() => {
    http
      .get('/companions')
      .then(({ data }: any) => setCompanions(data.data || []))
      .catch(() => {});
  }, []);

  const [reassignOrder, setReassignOrder] = useState<any>(null);
  const [reassignCompanionId, setReassignCompanionId] = useState<string>('');
  const [reassignNote, setReassignNote] = useState('');
  const [paymentOrder, setPaymentOrder] = useState<any>(null);
  const [paidTo, setPaidTo] = useState<string>('');
  const [paymentAccountName, setPaymentAccountName] = useState('');

  const releaseClaim = async (r: any) => {
    try {
      await http.post(`/orders/${r.id}/release`, { urgency: 'now' });
      message.success('已放回抢单池并标记为立即打');
      fetch();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '操作失败'));
    }
  };

  const openPayment = (r: any) => {
    setPaymentOrder(r);
    setPaidTo(r.customerPaidTo || '');
    setPaymentAccountName(r.customerPaymentAccountName || '');
  };

  const savePayment = async () => {
    if (!paymentOrder) return;
    try {
      await http.put(`/orders/${paymentOrder.id}/payment`, {
        customerPaidTo: paidTo || null,
        customerPaymentAccountName: paymentAccountName || null,
      });
      message.success('收款去向已保存');
      setPaymentOrder(null);
      fetch();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '保存失败'));
    }
  };

  const renderAdminActions = (r: any) => (
    <>
      {r.status !== 'DONE' && r.status !== 'CANCELLED' && (
        <Button
          type="link"
          size="small"
          onClick={() => {
            setReassignOrder(r);
            setReassignCompanionId(r.companionId || '');
            setReassignNote('');
          }}
        >
          归属调整
        </Button>
      )}
      {r.status === 'CLAIMED' && (
        <Button size="small" type="primary" style={{ background: '#7C3AED', borderColor: '#7C3AED' }} onClick={() => releaseClaim(r)}>
          放回抢单池
        </Button>
      )}
      {(r.status === 'CLAIMED' || r.status === 'GRABBED' || r.status === 'CONFIRMED' || r.status === 'DONE') && (
        <Button size="small" onClick={() => openPayment(r)}>
          收款去向
        </Button>
      )}
      {r.contactStatus === 'not_accepted' && r.screenshotUrl && (
        <Image
          src={r.screenshotUrl}
          width={40}
          style={{ borderRadius: 4, cursor: 'pointer', marginLeft: 4 }}
          preview={{ mask: '查看' }}
        />
      )}
    </>
  );

  const sorted = [...orders]
    .sort((a: any, b: any) => {
      const aUnread = unreadMap[a.id] || 0;
      const bUnread = unreadMap[b.id] || 0;
      if (aUnread > 0 && bUnread === 0) return -1;
      if (bUnread > 0 && aUnread === 0) return 1;
      return new Date(b.grabbedAt || b.createdAt).getTime() - new Date(a.grabbedAt || a.createdAt).getTime();
    })
    .filter((o: any) => {
      if (!dateFilter) return true;
      return new Date(o.grabbedAt || o.createdAt).toDateString() === dateFilter.toDate().toDateString();
    })
    .filter((o: any) => {
      if (!typeFilter) return true;
      return o.type === typeFilter;
    })
    .filter((o: any) => {
      if (!gameSearch) return true;
      return (o.gameName || '').toLowerCase().includes(gameSearch.toLowerCase());
    })
    .filter((o: any) => {
      if (!companionFilter) return true;
      return o.companionId === companionFilter;
    });

  return (
    <>
      <div>
        <PageHeader
          title={isCompanion ? '接单记录' : '📋 订单管理'}
          subtitle={isCompanion ? '查看我的接单历史' : undefined}
          extra={
            <div style={{ display: 'flex', gap: 8 }}>
              <Select
                placeholder="全部状态"
                allowClear
                value={statusFilter || undefined}
                onChange={(v) => setStatusFilter(v || '')}
                style={{ width: 120 }}
              >
                {Object.entries(orderStatusConfig).map(([k, v]) => (
                  <Option key={k} value={k}>
                    {v.label}
                  </Option>
                ))}
              </Select>
              <DatePicker placeholder="筛选日期" value={dateFilter} onChange={setDateFilter} style={{ width: 140 }} />
              <Button icon={React.createElement(ReloadOutlined)} onClick={fetch} loading={loading}>
                刷新
              </Button>
            </div>
          }
        />
        {/* Filter bar */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <Input.Search
            placeholder="搜索游戏名"
            allowClear
            value={gameSearch}
            onChange={(e) => setGameSearch(e.target.value)}
            style={{ width: 160 }}
            size="small"
          />
          <Select
            placeholder="订单类型"
            allowClear
            value={typeFilter || undefined}
            onChange={(v) => setTypeFilter(v || '')}
            style={{ width: 100 }}
            size="small"
          >
            <Option value="NEW">首单</Option>
            <Option value="RENEW">续费</Option>
            <Option value="REPURCHASE">复购</Option>
            <Option value="TIP">打赏</Option>
          </Select>
          <Select
            placeholder="员工筛选"
            allowClear
            value={companionFilter || undefined}
            onChange={(v) => setCompanionFilter(v || '')}
            style={{ width: 130 }}
            size="small"
            showSearch
            optionFilterProp="children"
          >
            {companions.map((c: any) => (
              <Option key={c.id} value={c.id}>
                {c.user?.username || c.id.slice(0, 6)}
              </Option>
            ))}
          </Select>
        </div>
        {/* Today's order stats */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
          <Tag color="blue">
            📋 今日抢单：
            {
              orders.filter((o: any) => {
                const d = new Date(o.grabbedAt || o.createdAt).toDateString();
                return d === new Date().toDateString() && o.status !== 'CANCELLED';
              }).length
            }
          </Tag>
          <Tag color="red">
            🔴 补单：
            {
              orders.filter((o: any) => {
                const d = new Date(o.grabbedAt || o.createdAt).toDateString();
                return d === new Date().toDateString() && (o.customFields?.deltaNote || o.notes || '').includes('补单');
              }).length
            }
          </Tag>
          <Tag color="green">
            📊 合计：
            {
              orders.filter(
                (o: any) => new Date(o.grabbedAt || o.createdAt).toDateString() === new Date().toDateString(),
              ).length
            }
          </Tag>
        </div>{' '}
        {loading && orders.length === 0 ? (
          <TableSkeleton columns={5} rows={5} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sorted.map((r) => (
              <OrderRow
                key={r.id}
                order={r}
                renderActions={isCompanion ? renderCompanionActions : renderAdminActions}
              />
            ))}
          </div>
        )}
        <Modal
          title="归属调整"
          open={!!reassignOrder}
          onOk={async () => {
            if (!reassignCompanionId) {
              message.warning('请选择陪玩');
              return Promise.reject();
            }
            try {
              await http.post(`/orders/${reassignOrder.id}/assign`, { companionId: reassignCompanionId });
              if (reassignNote)
                await http.put(`/orders/${reassignOrder.id}/contact`, { notes: `[归属调整] ${reassignNote}` });
              message.success('已重新分配');
              fetch();
              setReassignOrder(null);
            } catch (e: any) {
              message.error(extractErrorMessage(e, '分配失败'));
              return Promise.reject();
            }
          }}
          onCancel={() => setReassignOrder(null)}
          okText="确认调整"
          cancelText="取消"
          destroyOnClose
        >
          <div style={{ marginBottom: 12 }}>
            <Text>当前陪玩：{reassignOrder?.companion?.user?.username || '未分配'}</Text>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Text>新陪玩：</Text>
            <Select
              value={reassignCompanionId || undefined}
              style={{ width: '100%' }}
              onChange={(v) => setReassignCompanionId(v)}
              placeholder="选择新员工"
            >
              {companions
                .filter((c: any) => c.status !== 'OFFLINE')
                .map((c: any) => (
                  <Option key={c.id} value={c.id}>
                    {c.user?.username || c.id.slice(0, 6)}
                  </Option>
                ))}
            </Select>
          </div>
          <div>
            <Text>备注：</Text>
            <Input.TextArea
              rows={3}
              value={reassignNote}
              onChange={(e) => setReassignNote(e.target.value)}
              placeholder="请填写归属调整原因"
            />
          </div>
        </Modal>
        <Modal
          title="💰 收款去向"
          open={!!paymentOrder}
          onOk={savePayment}
          onCancel={() => setPaymentOrder(null)}
          okText="保存"
          cancelText="取消"
        >
          <div style={{ marginBottom: 12 }}>
            <Text>客户实际付款到：</Text>
            <Select
              value={paidTo || undefined}
              placeholder="选择付款去向"
              style={{ width: '100%', marginTop: 8 }}
              onChange={(v) => setPaidTo(v)}
            >
              <Option value="CS_WECHAT">客服工作微信</Option>
              <Option value="COMPANION_WECHAT">陪玩微信</Option>
              <Option value="STUDIO_ACCOUNT">工作室收款账号</Option>
              <Option value="OTHER">其他</Option>
            </Select>
          </div>
          <div>
            <Text>收款账号名称/微信号：</Text>
            <Input
              value={paymentAccountName}
              onChange={(e) => setPaymentAccountName(e.target.value)}
              placeholder="例如：工作室微信1号 / 陪玩张三微信"
              style={{ marginTop: 8 }}
            />
          </div>
        </Modal>
      </div>
      <CreateOrderModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setPreFill(null);
        }}
        onCreated={() => {
          message.success('订单已创建');
          fetch();
          setCreateOpen(false);
          setPreFill(null);
        }}
        userId={user?.id}
        customerPreFill={preFill || undefined}
      />
      <ChatModal open={!!chatPartner} partner={chatPartner} onClose={() => setChatPartner(null)} />
    </>
  );
};

export default OrdersPage;
