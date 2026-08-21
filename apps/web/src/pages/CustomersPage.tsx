// craftsman-ignore: TS001,TS002
// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { extractErrorMessage } from '../utils/error-handler';
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Space,
  Typography,
  message,
  Popconfirm,
  Tag,
  DatePicker,
  ConfigProvider,
  Card,
  Tabs,
  Upload,
} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  SwapOutlined,
  MessageOutlined,
  CalendarOutlined,
  PlayCircleOutlined,
  SendOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { customersApi } from '../api/customers';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import http from '../api/client';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { platformOptions, customerStatusConfig, orderTypeConfig, urgencyConfig, billingModeConfig } from '../constants';
import ChatModal from '../components/ChatModal';
import CreateOrderModal from '../components/CreateOrderModal';
import StartServiceModal from '../components/StartServiceModal';
import ServiceTimer from '../components/ServiceTimer';
import EndServiceModal from '../components/EndServiceModal';
import { CustomerDetailDrawer } from '../components/CustomerDetailDrawer';
import CustomerTrackingCenter from '../components/CustomerTrackingCenter';
import CompanionTrackingPanel from '../components/CompanionTrackingPanel';
import ErrorBanner from '../components/ErrorBanner';
import PageHeader from '../components/PageHeader';
import TableSkeleton from '../components/TableSkeleton';

const { Text } = Typography;
const { Option } = Select;

interface Customer {
  id: string;
  customerCode: string;
  wechatId: string;
  platform: string;
  platformAccount: string;
  notes: string;
  totalSpent: number;
  depositBalance?: number;
  status: string;
  isLegacy?: boolean;
  companion?: { id: string; user?: { username: string } };
  scheduledAt?: string | null;
  followUps?: Array<{ content: string; createdAt: string }>;
  orders?: Array<{ id: string; gameName: string; type: string; amount: number; duration: number; customFields: any; csUserId?: string; csUser?: { username?: string; displayName?: string; avatar?: string }; contactStatus?: string; screenshotUrl?: string; status?: string; sessions?: Array<{ id: string; startedAt: string | null; status: string; pausedAt?: string | null; totalPausedSec?: number | null; coCompanionId?: string | null; coAmount?: number | null; claimedMode?: string | null; claimedPrice?: number | null; duration?: number | null }> }>;
}

interface CompanionOption {
  id: string;
  username: string;
  status?: string;
}

// 是否已经“打过首单”：自己录入的老客户视为已打过；系统抢来的要有已完成的首单(NEW/DONE)。
function hasFirstOrder(c: Customer): boolean {
  return !!c.isLegacy || !!(c.orders?.some((o) => o.type === 'NEW' && o.status === 'DONE'));
}

const CustomersPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const role = user?.role;
  const isCompanion = role === 'COMPANION';
  const isCs = role === 'CS';
  const isAdmin = role === 'ADMIN' || role === 'OWNER';
  const canManage = isCs || isAdmin;
  const canReassign = isAdmin;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [searchCode, setSearchCode] = useState('');
  const [sortBy, setSortBy] = useState<string>('createdAt'); // createdAt | totalSpent

  // Companion: chat, create order, schedule
  const [chatPartner, setChatPartner] = useState<any>(null);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);

  const openChat = (record: Customer) => {
    const o = record.orders?.[0];
    // 「沟通」应和订单发布者（客服）聊天，而不是和自己（companionId）聊。
    const csUserId = o?.csUserId;
    setChatPartner({
      conversationId: csUserId || record.id,
      participant: {
        userId: csUserId || record.id,
        username: o?.csUser?.displayName || o?.csUser?.username || '客服',
        displayName: o?.csUser?.displayName,
        avatar: o?.csUser?.avatar,
        role: 'CS',
      },
      orderInfo: o ? `${o.gameName} · ¥${Number(o.amount || 0).toFixed(0)}` : undefined,
    });
  };
  const [startServicePreFill, setStartServicePreFill] = useState<any>(null);
  const [startServiceOrder, setStartServiceOrder] = useState<{ id?: string; customerId?: string; gameName?: string; mode?: 'first' | 'renew' | 'repurchase'; initialValues?: any } | null>(null);
  const [endServiceTarget, setEndServiceTarget] = useState<{ sessionId: string; orderId: string } | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleCustomer, setScheduleCustomer] = useState<Customer | null>(null);
  const [scheduleTime, setScheduleTime] = useState<any>(null);
  const [deleteCustomer, setDeleteCustomer] = useState<Customer | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteScreenshot, setDeleteScreenshot] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [depositCustomer, setDepositCustomer] = useState<Customer | null>(null);
  const [depositAmount, setDepositAmount] = useState<number | null>(null);
  const [depositScreenshot, setDepositScreenshot] = useState('');
  const [depositNote, setDepositNote] = useState('');
  const [depositSubmitting, setDepositSubmitting] = useState(false);

  const openScheduleModal = (record: Customer) => {
    setScheduleCustomer(record);
    setScheduleTime(null);
    setScheduleModalOpen(true);
  };
  const handleSchedule = async () => {
    if (!scheduleTime || !scheduleCustomer) {
      message.warning('请选择预约时间');
      return;
    }
    try {
      await customersApi.update(scheduleCustomer.id, { scheduledAt: scheduleTime.toISOString() });
      message.success(`已设置预约: ${scheduleTime.format('YYYY-MM-DD HH:mm')}`);
      setScheduleModalOpen(false);
      fetchCustomers();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '设置失败'));
    }
  };
  const cancelPendingSession = async (sessionId: string, orderId?: string, orderType?: string) => {
    try {
      await ordersApi.endSession(sessionId);
      // 复购（REPURCHASE）是新建订单，搭档没接受时把整单也结束，避免卡在「进行中」
      if (orderId && orderType === 'REPURCHASE') {
        try { await ordersApi.complete(orderId); } catch { /* ignore */ }
      }
      message.success('已取消搭档邀请');
      fetchCustomers();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '取消失败');
    }
  };
  const [notesEditing, setNotesEditing] = useState<Record<string, string>>({});
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const saveNotes = (id: string, notes: string) => {
    customersApi
      .update(id, { notes })
      .then(() => {
        message.success('备注已更新');
        fetchCustomers();
      })
      .catch((e: any) => message.error(extractErrorMessage(e, '更新失败')));
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassigningCustomer, setReassigningCustomer] = useState<Customer | null>(null);
  const [reassigning, setReassigning] = useState(false);
  const [companionOptions, setCompanionOptions] = useState<CompanionOption[]>([]);
  const [editingCompanion, setEditingCompanion] = useState<string | null>(null);
  const [companionsLoading, setCompanionsLoading] = useState(false);
  const [reassignForm] = Form.useForm();

  const fetchCustomers = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const { data } = await customersApi.list({ sortBy });
      setCustomers(data.data?.items ?? data.data ?? []);
    } catch (err: any) {
      if (!silent) {
        const errorMsg = extractErrorMessage(err, '加载客户列表失败');
        setError(errorMsg);
        message.error(errorMsg);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [sortBy]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);
  useEffect(() => {
    const onServiceStarted = () => fetchCustomers();
    window.addEventListener('chunlv:service-started', onServiceStarted);
    return () => window.removeEventListener('chunlv:service-started', onServiceStarted);
  }, [fetchCustomers]);
  useEffect(() => {
    const t = setInterval(() => fetchCustomers(true), 30000);
    return () => clearInterval(t);
  }, [fetchCustomers]);
  useEffect(() => {
    if (canReassign) {
      companionsApi
        .list()
        .then(({ data }: any) =>
          setCompanionOptions((data.data || []).map((c: any) => ({ id: c.id, username: c.user?.username || '未知' }))),
        )
        .catch(() => {});
    }
  }, [canReassign]);

  const openCreateModal = () => {
    setEditingCustomer(null);
    form.resetFields();
    setModalOpen(true);
  };
  const openEditModal = (record: Customer) => {
    setEditingCustomer(record);
    form.setFieldsValue({
      wechatId: record.wechatId,
      platform: record.platform,
      platformAccount: record.platformAccount,
      notes: record.notes,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (editingCustomer) {
        await customersApi.update(editingCustomer.id, values);
        message.success('客户信息已更新');
      } else {
        await customersApi.create(values);
        message.success('客户已创建');
      }
      setModalOpen(false);
      form.resetFields();
      fetchCustomers();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(extractErrorMessage(err, '操作失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await customersApi.delete(id);
      message.success('客户已删除');
      fetchCustomers();
    } catch (err: any) {
      message.error(extractErrorMessage(err, '删除失败'));
    }
  };

  const openReassignModal = async (record: Customer) => {
    setReassigningCustomer(record);
    reassignForm.resetFields();
    setReassignModalOpen(true);
    setCompanionsLoading(true);
    try {
      const { data } = await companionsApi.list();
      const raw = data.data ?? [];
      setCompanionOptions(raw.map((c: any) => ({ id: c.id, username: c.user?.username ?? '未知' })));
    } catch {
      message.warning('加载陪玩列表失败');
    } finally {
      setCompanionsLoading(false);
    }
  };

  const handleReassign = async () => {
    try {
      const values = await reassignForm.validateFields();
      if (!reassigningCustomer) return;
      setReassigning(true);
      await customersApi.reassign(reassigningCustomer.id, values.companionId);
      if (values.note) await customersApi.update(reassigningCustomer.id, { notes: `[归属调整] ${values.note}` });
      message.success('已重新分配');
      setReassignModalOpen(false);
      reassignForm.resetFields();
      fetchCustomers();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(extractErrorMessage(err, '归属调整失败'));
    } finally {
      setReassigning(false);
    }
  };

  const columns: any[] = [
    {
      title: '客户编号',
      dataIndex: 'customerCode',
      key: 'customerCode',
      width: 150,
      render: (code: string, record: Customer) => (
        <>
          <Text>{code}</Text>
          {Number(record.depositBalance) > 0 && (
            <Tag color="blue" style={{ marginLeft: 6 }}>存单 ¥{Number(record.depositBalance).toFixed(1)}</Tag>
          )}
          {record.scheduledAt &&
            (() => {
              const d = new Date(record.scheduledAt);
              return (
                <>
                  <br />
                  <Tag color="purple" style={{ fontSize: 10, marginTop: 2 }}>
                    📅{d.getMonth() + 1}月{d.getDate()}日 {String(d.getHours()).padStart(2, '0')}:
                    {String(d.getMinutes()).padStart(2, '0')}
                  </Tag>
                </>
              );
            })()}
        </>
      ),
    },
    { title: '微信号', dataIndex: 'wechatId', key: 'wechatId' },
    ...(!isCompanion
      ? [
          {
            title: '客户昵称',
            key: 'nickname',
            width: 120,
            render: (_: any, r: Customer) => {
              const cf = r.orders?.[0]?.customFields || {};
              return cf.customerNickname || <Text type="secondary">-</Text>;
            },
          },
          {
            title: '来源账号',
            key: 'sourceAccount',
            width: 150,
            render: (_: any, r: Customer) => {
              const cf = r.orders?.[0]?.customFields || {};
              return cf.customerSourceAccount || <Text type="secondary">-</Text>;
            },
          },
        ]
      : []),
    {
      title: '最近订单',
      key: 'lastOrder',
      width: 220,
      render: (_: any, r: any) => {
        const o = r.orders?.[0];
        if (!o) return <Text type="secondary">-</Text>;
        const cf = o.customFields || {};
        return (
          <>
            <Text strong>{o.gameName}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>
              <Tag color={orderTypeConfig[o.type]?.color} style={{ fontSize: 10, margin: 0 }}>
                {orderTypeConfig[o.type]?.label || o.type}
              </Tag>{' '}
              ¥{Number(o.amount).toFixed(0)}
              {cf.deltaMission && (
                <Tag color="red" style={{ fontSize: 10, margin: '0 0 0 4px' }}>
                  {cf.deltaMission}
                </Tag>
              )}
              {cf.deltaCount && <Tag style={{ fontSize: 10, margin: '0 0 0 4px' }}>{cf.deltaCount}</Tag>}
              {cf.billingMode === 'round' && (
                <Tag style={{ fontSize: 10, margin: '0 0 0 4px' }}>🎯{o.duration || cf.deltaCount || '?'}局</Tag>
              )}
              {o.duration > 0 && cf.billingMode !== 'round' && <Text style={{ fontSize: 10 }}> · {o.duration}h</Text>}
            </Text>
          </>
        );
      },
    },
    {
      title: '来源/时间',
      key: 'source',
      width: 110,
      render: (_: any, r: any) => {
        const cf = r.orders?.[0]?.customFields || {};
        return (
          <>
            {cf.customerSource && (
              <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>
                📡{cf.customerSource}
              </Tag>
            )}
            {cf.urgency && (
              <Tag color={urgencyConfig[cf.urgency]?.color} style={{ fontSize: 10, margin: '2px 0' }}>
                {urgencyConfig[cf.urgency]?.label}
              </Tag>
            )}
            {cf.billingMode && (
              <Tag style={{ fontSize: 10, margin: 0 }}>{billingModeConfig[cf.billingMode]?.label}</Tag>
            )}
          </>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: string) => {
        const cfg = customerStatusConfig[s];
        return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : <Tag>{s || '-'}</Tag>;
      },
    },
    {
      title: '所用微信',
      key: 'workWechat',
      width: 100,
      render: (_: any, r: any) => {
        const wo = r.orders?.[0]?.customFields;
        if (wo?.workWechatName)
          return (
            <Tag color="cyan" style={{ fontSize: 11, margin: 0 }}>
              📱{wo.workWechatName}
            </Tag>
          );
        if (wo?.workWechatId)
          return (
            <Tag color="cyan" style={{ fontSize: 11, margin: 0 }}>
              📱{wo.workWechatId?.slice(0, 8)}
            </Tag>
          );
        return (
          <Text type="secondary" style={{ fontSize: 11 }}>
            -
          </Text>
        );
      },
    },
    {
      title: '陪玩',
      key: 'companion',
      width: 80,
      render: (_: any, r: Customer) => r.companion?.user?.username ?? <Text type="secondary">未分配</Text>,
    },
    {
      title: '最近跟进',
      key: 'followUp',
      width: 120,
      render: (_: any, r: Customer) => {
        const latest = r.followUps?.[0];
        return latest ? (
          <>
            <Text style={{ fontSize: 11 }}>{latest.content?.slice(0, 20)}...</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 10 }}>
              {new Date(latest.createdAt).toLocaleDateString('zh-CN')}
            </Text>
          </>
        ) : (
          <Tag color="orange" style={{ fontSize: 10 }}>
            未跟进
          </Tag>
        );
      },
    },
    {
      title: '累计消费',
      dataIndex: 'totalSpent',
      key: 'totalSpent',
      width: 120,
      render: (val: number) => <span style={{ color: '#FF4757', fontWeight: 600 }}>¥{(val ?? 0).toFixed(1)}</span>,
    },
    {
      title: '备注',
      key: 'notes',
      width: 200,
      render: (_: any, r: Customer) =>
        isCompanion ? (
          <Input
            size="small"
            placeholder="输入备注"
            value={notesEditing[r.id] ?? r.notes ?? ''}
            onChange={(e) => setNotesEditing((prev) => ({ ...prev, [r.id]: e.target.value }))}
            onBlur={() => {
              const v = notesEditing[r.id];
              if (v !== undefined && v !== r.notes) saveNotes(r.id, v);
            }}
            onPressEnter={(e: any) => {
              e.target.blur();
            }}
          />
        ) : (
          <Text style={{ fontSize: 12 }}>{r.notes || '-'}</Text>
        ),
    },
  ];

  if (isCompanion) {
    columns.push({
      title: '操作',
      key: 'actions',
      width: 280,
      render: (_: unknown, record: Customer) => {
        const contactStatus = record.orders?.[0]?.contactStatus;
        if (contactStatus === 'not_accepted') {
          const orderId = record.orders?.[0]?.id;
          return (
            <Button
              type="primary"
              size="small"
              style={{ background: '#16A34A', borderColor: '#16A34A' }}
              onClick={async () => {
                if (!orderId) return;
                try {
                  await ordersApi.updateContact(orderId, { contactStatus: 'added' });
                  message.success('已设置成功，客户可正常服务');
                  fetchCustomers();
                } catch (e: any) {
                  message.error(extractErrorMessage(e, '操作失败'));
                }
              }}
            >
              ✅ 设置成功
            </Button>
          );
        }
        return (
          <Space size={4}>
          {record.orders?.[0]?.id && (
            <Button size="small" icon={React.createElement(MessageOutlined)} onClick={() => openChat(record)}>
              沟通
            </Button>
          )}
          <Button
            type="primary"
            size="small"
            icon={React.createElement(PlayCircleOutlined)}
            onClick={() => {
              const active = record.orders?.find((o: any) => o.status === 'GRABBED');
              if (active?.id) {
                setStartServiceOrder({
                  id: active.id,
                  gameName: active.gameName,
                  mode: 'first',
                  initialValues: {
                    claimPrice: active.amount || null,
                    claimDuration: active.duration || 1,
                    claimMode: active.customFields?.deltaMission || '机密',
                  },
                });
              } else if (record.orders?.some((o: any) => o.status === 'CONFIRMED')) {
                message.warning('正在服务中，当场继续请用「续单」，打完请点「结束服务」');
              } else if (record.orders?.some((o: any) => o.status === 'DONE')) {
                message.warning('首单已完成，下次玩请使用「复购」');
              } else {
                message.warning('当前没有可打首单的订单，请先在抢单池抢单');
              }
            }}
          >
            首单
          </Button>
          <Button
            size="small"
            onClick={() => {
              const active = record.orders?.find((o: any) => o.status === 'CONFIRMED');
              if (active?.id) {
                const lastSession = active.sessions?.[0];
                setStartServiceOrder({
                  id: active.id,
                  gameName: active.gameName,
                  mode: 'renew',
                  initialValues: {
                    dual: !!lastSession?.coCompanionId,
                    coId: lastSession?.coCompanionId,
                    coPrice: lastSession?.coAmount != null ? Number(lastSession.coAmount) / (lastSession.duration || 1) : null,
                    claimMode: lastSession?.claimedMode || '机密',
                    claimPrice: null,
                    claimDuration: lastSession?.duration || 1,
                  },
                });
              } else {
                if (!hasFirstOrder(record)) {
                  message.warning('该客户第一次消费，请选择首单');
                } else {
                  message.warning('当前没有进行中的服务，无法续单');
                }
              }
            }}
          >
            续单
          </Button>
          <Button
            size="small"
            onClick={() => {
              if (!hasFirstOrder(record)) {
                message.warning('该客户第一次消费，请选择首单');
                return;
              }
              setStartServiceOrder({
                customerId: record.id,
                gameName: record.orders?.[0]?.gameName,
                mode: 'repurchase',
              });
            }}
          >
            复购
          </Button>
          {(() => {
            const activeOrder = record.orders?.find((o: any) => o.status === 'CONFIRMED');
            const activeSession = activeOrder?.sessions?.find((s: any) => s.status === 'ACTIVE');
            if (!activeOrder || !activeSession) return null;
            if (activeSession.startedAt) {
              return (
                <Space size={4}>
                  {activeSession.pausedAt ? (
                    <Tag color="orange">暂停中</Tag>
                  ) : (
                    <>
                      <Tag color="blue">服务中</Tag>
                      <ServiceTimer startedAt={activeSession.startedAt} />
                    </>
                  )}
                  {activeSession.pausedAt ? (
                    <Button
                      size="small"
                      type="primary"
                      onClick={async () => {
                        try {
                          await ordersApi.resumeSession(activeSession.id);
                          (window as any).electronAPI?.sessionResume?.();
                          message.success('已继续服务');
                          fetchCustomers();
                        } catch (e: any) {
                          message.error(extractErrorMessage(e, '继续失败'));
                        }
                      }}
                    >
                      继续
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      onClick={async () => {
                        try {
                          await ordersApi.pauseSession(activeSession.id);
                          (window as any).electronAPI?.sessionPause?.();
                          message.success('已暂停，暂停期间不计算服务时长');
                          fetchCustomers();
                        } catch (e: any) {
                          message.error(extractErrorMessage(e, '暂停失败'));
                        }
                      }}
                    >
                      暂停
                    </Button>
                  )}
                  <Button
                    size="small"
                    danger
                    onClick={() => setEndServiceTarget({ sessionId: activeSession.id, orderId: activeOrder.id })}
                  >
                    结束服务
                  </Button>
                </Space>
              );
            }
            // 双陪：搭档还没接受，不显示“服务中”
            return (
              <Space size={4}>
                <Tag color="orange">等待搭档接受</Tag>
                <Button
                  size="small"
                  danger
                  onClick={() => cancelPendingSession(activeSession.id, activeOrder.id, activeOrder.type)}
                >
                  取消邀请
                </Button>
              </Space>
            );
          })()}
          <Button size="small" icon={React.createElement(SendOutlined)} onClick={() => setCreateOrderOpen(true)}>
            发布订单
          </Button>
          <Button size="small" icon={React.createElement(CalendarOutlined)} onClick={() => openScheduleModal(record)}>
            预约
          </Button>
          <Button size="small" onClick={() => {
            setDepositCustomer(record);
            setDepositAmount(null);
            setDepositScreenshot('');
            setDepositNote('');
          }}>
            存单
          </Button>
          <Button type="link" size="small" onClick={() => navigate(`/companion/customers/${record.id}`)}>
            查看
          </Button>
          <Button
            type="link"
            danger
            size="small"
            onClick={() => {
              setDeleteCustomer(record);
              setDeleteReason('');
              setDeleteScreenshot('');
            }}
          >
            删除
          </Button>
          </Space>
        );
      },
    });
  } else {
    columns.push({
      title: '操作',
      key: 'actions',
      width: canReassign ? 260 : 160,
      render: (_: unknown, record: Customer) => (
        <Space size="small">
          {canReassign && (
            <Button type="link" size="small" onClick={() => openReassignModal(record)}>
              归属调整
            </Button>
          )}
          {canManage && (
            <Button
              type="link"
              size="small"
              icon={React.createElement(EditOutlined)}
              onClick={() => openEditModal(record)}
            >
              编辑
            </Button>
          )}
          {isAdmin && (
            <Popconfirm
              title="确定删除该客户？"
              onConfirm={() => handleDelete(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="link" size="small" danger icon={React.createElement(DeleteOutlined)}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    });
  }

  return (
    <ConfigProvider locale={zhCN}>
      <div>
        <PageHeader
          title="客户管理"
          subtitle={isCompanion ? '管理我的客户信息' : undefined}
          extra={
            <Space>
              <Select
                value={sortBy}
                onChange={(v) => setSortBy(v)}
                style={{ width: 140 }}
                placeholder="排序"
                options={[
                  { label: '添加时间', value: 'createdAt' },
                  { label: '消费高低', value: 'totalSpent' },
                ]}
              />
              <Input.Search
                placeholder={!isCompanion ? '搜索微信号/编号/昵称/来源' : '搜索客户编号/微信号'}
                value={searchCode}
                onChange={(e) => setSearchCode(e.target.value)}
                style={{ width: 200 }}
                allowClear
              />
              <Button icon={React.createElement(ReloadOutlined)} onClick={() => fetchCustomers()} loading={loading}>
                刷新
              </Button>
              {(canManage || isCompanion) && (
                <Button type="primary" icon={React.createElement(PlusOutlined)} onClick={openCreateModal}>
                  新建客户
                </Button>
              )}
            </Space>
          }
        />
        <Tabs
          defaultActiveKey="list"
          items={[
            {
              key: 'list',
              label: '客户列表',
              children: (
                <>
                  {error && <ErrorBanner message={error} onRetry={fetchCustomers} />}
                  {loading && customers.length === 0 ? (
                    <TableSkeleton columns={6} rows={5} />
                  ) : (
                    <Card size="small" style={{ overflow: 'auto' }}>
                      <Table
                        size="small"
                        columns={columns}
                        dataSource={customers.filter(
                          (c: Customer) => {
                            if (!searchCode) return true;
                            const q = searchCode.toLowerCase();
                            if (isCompanion) {
                              return (
                                (c.customerCode || '').toLowerCase().includes(q) ||
                                (c.wechatId || '').toLowerCase().includes(q)
                              );
                            }
                            const cf = c.orders?.[0]?.customFields || {};
                            const hay = [
                              c.customerCode,
                              c.wechatId,
                              c.platformAccount,
                              cf.customerNickname,
                              cf.customerSource,
                              cf.customerSourceAccount,
                              cf.customerAccountId,
                            ]
                              .filter(Boolean)
                              .join(' ')
                              .toLowerCase();
                            return hay.includes(q);
                          },
                        )}
                        rowKey="id"
                        loading={loading}
                        onRow={(record) => ({ style: { cursor: 'pointer' }, onClick: () => setDetailCustomer(record) })}
                        scroll={{ x: 1000 }}
                        locale={{ emptyText: '暂无客户数据' }}
                        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
                      />
                    </Card>
                  )}
                </>
              ),
            },
            ...(isCompanion
              ? [{ key: 'tracking', label: '我的追踪', children: <CompanionTrackingPanel /> }]
              : [{ key: 'tracking', label: '客户追踪中心', children: <CustomerTrackingCenter /> }]),
          ]}
        />
        <Modal
          title={editingCustomer ? '编辑客户' : '新建客户'}
          open={modalOpen}
          onOk={handleSubmit}
          onCancel={() => {
            setModalOpen(false);
            form.resetFields();
          }}
          confirmLoading={submitting}
          okText="保存"
          cancelText="取消"
          destroyOnClose
        >
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item name="wechatId" label="微信号" rules={[{ required: true, message: '请输入微信号' }]}>
              <Input placeholder="请输入微信号" />
            </Form.Item>
            <Form.Item name="platform" label="平台" rules={[{ required: true, message: '请选择平台' }]}>
              <Select placeholder="请选择平台">
                {platformOptions.map((opt) => (
                  <Option key={opt.value} value={opt.value}>
                    {opt.label}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item name="platformAccount" label="平台账号">
              <Input placeholder="请输入平台账号" />
            </Form.Item>
            <Form.Item name="notes" label="备注">
              <Input.TextArea rows={3} placeholder="请输入备注信息" />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          title="归属调整"
          open={reassignModalOpen}
          onOk={handleReassign}
          onCancel={() => {
            setReassignModalOpen(false);
            reassignForm.resetFields();
          }}
          confirmLoading={reassigning}
          okText="确认调整"
          cancelText="取消"
          destroyOnClose
        >
          <Form form={reassignForm} layout="vertical" style={{ marginTop: 16 }}>
            <p>
              将客户 <Text strong>{reassigningCustomer?.customerCode}</Text> 重新分配给：
            </p>
            <Form.Item name="companionId" rules={[{ required: true, message: '请选择陪玩' }]}>
              <Select
                placeholder="请选择陪玩"
                loading={companionsLoading}
                options={companionOptions.map((c) => ({ label: c.username, value: c.id }))}
              />
            </Form.Item>
            <Form.Item name="note" label="备注">
              <Input.TextArea rows={3} placeholder="请填写归属调整原因" />
            </Form.Item>
          </Form>
        </Modal>
        <ChatModal open={!!chatPartner} partner={chatPartner} onClose={() => setChatPartner(null)} />
        <CreateOrderModal
          open={createOrderOpen}
          onClose={() => {
            setCreateOrderOpen(false);
            setStartServicePreFill(null);
          }}
          onCreated={() => {
            fetchCustomers();
            setStartServicePreFill(null);
          }}
          userId={user?.id}
          customerPreFill={startServicePreFill}
        />
        <StartServiceModal
          open={!!startServiceOrder}
          orderId={startServiceOrder?.id ?? null}
          customerId={startServiceOrder?.customerId ?? null}
          gameName={startServiceOrder?.gameName}
          mode={startServiceOrder?.mode}
          initialValues={startServiceOrder?.initialValues}
          onClose={() => setStartServiceOrder(null)}
          onDone={() => {
            setStartServiceOrder(null);
            fetchCustomers();
          }}
        />
        <EndServiceModal
          open={!!endServiceTarget}
          sessionId={endServiceTarget?.sessionId}
          orderId={endServiceTarget?.orderId}
          onClose={() => setEndServiceTarget(null)}
          onDone={() => fetchCustomers()}
        />
        <Modal
          title="💰 客户存单"
          open={!!depositCustomer}
          onOk={async () => {
            if (!depositCustomer) return;
            if (!depositAmount || depositAmount <= 0) {
              message.warning('请填写存单金额');
              return;
            }
            setDepositSubmitting(true);
            try {
              await customersApi.createDeposit(depositCustomer.id, {
                amount: depositAmount,
                screenshotUrl: depositScreenshot || undefined,
                note: depositNote || undefined,
              });
              message.success('存单已记录');
              setDepositCustomer(null);
              fetchCustomers();
            } catch (e: any) {
              message.error(extractErrorMessage(e, '存单失败'));
            } finally {
              setDepositSubmitting(false);
            }
          }}
          onCancel={() => setDepositCustomer(null)}
          okText="确认存单"
          cancelText="取消"
          confirmLoading={depositSubmitting}
          destroyOnClose
        >
          <div>
            <Text strong>客户：{depositCustomer?.wechatId || depositCustomer?.customerCode}</Text>
          </div>
          <div style={{ marginTop: 12 }}>
            <Text>存单金额（元）</Text>
            <InputNumber
              min={0}
              step={10}
              style={{ width: '100%', marginTop: 6 }}
              value={depositAmount ?? undefined}
              onChange={(v) => setDepositAmount(v ?? null)}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <Text>预存截图</Text>
            <div style={{ marginTop: 6 }}>
              <Upload
                showUploadList={false}
                accept="image/*"
                beforeUpload={async (file) => {
                  const fd = new FormData();
                  fd.append('file', file);
                  try {
                    const { data } = await http.post('/upload/screenshot', fd);
                    setDepositScreenshot(data.data?.url || data.url || '');
                    message.success('截图已上传');
                  } catch {
                    message.error('上传失败');
                  }
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />}>{depositScreenshot ? '重新上传截图' : '上传截图'}</Button>
              </Upload>
              {depositScreenshot && <Tag color="green" style={{ marginLeft: 8 }}>已上传</Tag>}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <Text>备注（可选）</Text>
            <Input.TextArea
              rows={2}
              style={{ marginTop: 6 }}
              value={depositNote}
              onChange={(e) => setDepositNote(e.target.value)}
              placeholder="例如：客户预存 ¥xxx"
            />
          </div>
        </Modal>
        <CustomerDetailDrawer
          customerId={detailCustomer?.id ?? null}
          customerCode={detailCustomer?.customerCode}
          open={!!detailCustomer}
          onClose={() => setDetailCustomer(null)}
        />
        <Modal
          title="预约时间"
          open={scheduleModalOpen}
          onOk={handleSchedule}
          onCancel={() => setScheduleModalOpen(false)}
          okText="确认预约"
          cancelText="取消"
          destroyOnClose
        >
          <div style={{ marginTop: 16 }}>
            <p>
              为客户 <Text strong>{scheduleCustomer?.customerCode}</Text> 设置预约提醒：
            </p>
            <DatePicker
              showTime
              format="YYYY年M月D日 HH:mm"
              placeholder="选择预约时间"
              value={scheduleTime}
              onChange={(v) => setScheduleTime(v)}
              style={{ width: '100%' }}
            />
          </div>
        </Modal>
        <Modal
          title="删除客户"
          open={!!deleteCustomer}
          onOk={async () => {
            if (!deleteReason.trim()) {
              message.warning('请填写删除原因');
              return Promise.reject();
            }
            if (!deleteScreenshot) {
              message.warning('请上传删除截图');
              return Promise.reject();
            }
            setDeleteSubmitting(true);
            try {
              await http.post('/customer-tracking/delete-requests', {
                customerId: deleteCustomer?.id,
                reason: deleteReason.trim(),
                evidenceUrl: deleteScreenshot,
              });
              message.success('删除申请已提交，等待管理端审核');
              setDeleteCustomer(null);
              fetchCustomers();
            } catch (e: any) {
              message.error(extractErrorMessage(e, '申请失败'));
              return Promise.reject();
            } finally {
              setDeleteSubmitting(false);
            }
          }}
          onCancel={() => setDeleteCustomer(null)}
          okText="提交申请"
          cancelText="取消"
          confirmLoading={deleteSubmitting}
          destroyOnClose
        >
          <div style={{ marginTop: 12 }}>
            <Text>
              确认删除客户 <Text strong>{deleteCustomer?.wechatId || deleteCustomer?.customerCode}</Text> ？删除需填写原因并上传截图，提交后管理端审核。
            </Text>
          </div>
          <div style={{ marginTop: 12 }}>
            <Text>删除原因（必填）：</Text>
            <Input.TextArea
              rows={3}
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="例如：客户已删除我 / 客户拉黑 / 不再合作"
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <Text>删除截图（必传）：</Text>
            <div style={{ marginTop: 8 }}>
              <Upload
                showUploadList={false}
                accept="image/*"
                beforeUpload={async (file) => {
                  const fd = new FormData();
                  fd.append('file', file);
                  try {
                    const { data } = await http.post('/upload/screenshot', fd);
                    setDeleteScreenshot(data.data?.url || data.url || '');
                    message.success('截图已上传');
                  } catch {
                    message.error('上传失败');
                  }
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />}>
                  {deleteScreenshot ? '重新上传截图' : '上传截图'}
                </Button>
              </Upload>
              {deleteScreenshot && <Tag color="green" style={{ marginLeft: 8 }}>已上传</Tag>}
            </div>
          </div>
        </Modal>
      </div>
    </ConfigProvider>
  );
};

export default CustomersPage;
