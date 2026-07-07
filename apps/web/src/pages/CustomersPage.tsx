import React, { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Space, Typography, message, Popconfirm, Tag, DatePicker, ConfigProvider,
} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined, SwapOutlined,
  MessageOutlined, CalendarOutlined, PlayCircleOutlined, SendOutlined,
} from '@ant-design/icons';
import { customersApi } from '../api/customers';
import { companionsApi } from '../api/companions';
import { useAuthStore } from '../stores/authStore';
import { platformOptions, customerStatusConfig, orderTypeConfig, urgencyConfig, billingModeConfig } from '../constants';
import ChatModal from '../components/ChatModal';
import CreateOrderModal from '../components/CreateOrderModal';

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
  status: string;
  companion?: { id: string; username: string };
  scheduledAt?: string | null;
  orders?: Array<{ id: string; gameName: string; type: string; amount: number; duration: number; customFields: any }>;
}

interface CompanionOption { id: string; username: string }

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

  // Companion: chat, create order, schedule
  const [chatPartner, setChatPartner] = useState<{ name: string; orderId: string; orderInfo?: string } | null>(null);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);

  const openChat = (record: Customer) => {
    const o = record.orders?.[0];
    setChatPartner({ name: record.wechatId || record.customerCode, orderId: o?.id || '',
      orderInfo: o ? `👤${record.customerCode} · ${o.gameName}` : `👤${record.customerCode}` });
  };
  const [startServicePreFill, setStartServicePreFill] = useState<any>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleCustomer, setScheduleCustomer] = useState<Customer | null>(null);
  const [scheduleTime, setScheduleTime] = useState<any>(null);

  const openScheduleModal = (record: Customer) => {
    setScheduleCustomer(record); setScheduleTime(null); setScheduleModalOpen(true);
  };
  const handleSchedule = async () => {
    if (!scheduleTime || !scheduleCustomer) { message.warning('请选择预约时间'); return; }
    try {
      await customersApi.update(scheduleCustomer.id, { scheduledAt: scheduleTime.toISOString() });
      message.success(`已设置预约: ${scheduleTime.format('YYYY-MM-DD HH:mm')}`);
      setScheduleModalOpen(false); fetchCustomers();
    } catch (e: any) { message.error(e?.response?.data?.message || '设置失败'); }
  };
  const [notesEditing, setNotesEditing] = useState<Record<string, string>>({});
  const saveNotes = (id: string, notes: string) => {
    customersApi.update(id, { notes }).then(() => { message.success('备注已更新'); fetchCustomers(); }).catch((e: any) => message.error(e?.response?.data?.message || '更新失败'));
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassigningCustomer, setReassigningCustomer] = useState<Customer | null>(null);
  const [reassigning, setReassigning] = useState(false);
  const [companionOptions, setCompanionOptions] = useState<CompanionOption[]>([]);
  const [companionsLoading, setCompanionsLoading] = useState(false);
  const [reassignForm] = Form.useForm();

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await customersApi.list();
      setCustomers(data.data?.items ?? data.data ?? []);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '加载客户列表失败';
      setError(msg);
      message.error(msg);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const openCreateModal = () => { setEditingCustomer(null); form.resetFields(); setModalOpen(true); };
  const openEditModal = (record: Customer) => {
    setEditingCustomer(record);
    form.setFieldsValue({ wechatId: record.wechatId, platform: record.platform, platformAccount: record.platformAccount, notes: record.notes });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (editingCustomer) { await customersApi.update(editingCustomer.id, values); message.success('客户信息已更新'); }
      else { await customersApi.create(values); message.success('客户已创建'); }
      setModalOpen(false); form.resetFields(); fetchCustomers();
    } catch (err: any) { if (err?.errorFields) return; message.error(err?.response?.data?.message || err?.message || '操作失败'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id: string) => {
    try { await customersApi.delete(id); message.success('客户已删除'); fetchCustomers(); }
    catch (err: any) { message.error(err?.response?.data?.message || err?.message || '删除失败'); }
  };

  const openReassignModal = async (record: Customer) => {
    setReassigningCustomer(record); reassignForm.resetFields(); setReassignModalOpen(true);
    setCompanionsLoading(true);
    try {
      const { data } = await companionsApi.list();
      const raw = data.data ?? [];
      setCompanionOptions(raw.map((c: any) => ({ id: c.id, username: c.user?.username ?? '未知' })));
    } catch { message.warning('加载陪玩列表失败'); }
    finally { setCompanionsLoading(false); }
  };

  const handleReassign = async () => {
    try {
      const values = await reassignForm.validateFields();
      if (!reassigningCustomer) return;
      setReassigning(true);
      await customersApi.reassign(reassigningCustomer.id, values.companionId);
      message.success(`已将客户 ${reassigningCustomer.customerCode} 重新分配给新陪玩`);
      setReassignModalOpen(false); reassignForm.resetFields(); fetchCustomers();
    } catch (err: any) { if (err?.errorFields) return; message.error(err?.response?.data?.message || err?.message || '归属调整失败'); }
    finally { setReassigning(false); }
  };

  const columns: any[] = [
    { title: '客户编号', dataIndex: 'customerCode', key: 'customerCode', width: 150,
      render: (code: string, record: Customer) => (<>
        <Text>{code}</Text>
        {record.scheduledAt && (() => { const d=new Date(record.scheduledAt); return <><br /><Tag color="purple" style={{ fontSize: 10, marginTop: 2 }}>📅{d.getMonth()+1}月{d.getDate()}日 {String(d.getHours()).padStart(2,'0')}:{String(d.getMinutes()).padStart(2,'0')}</Tag></>; })()}
      </>)},
    { title: '微信号', dataIndex: 'wechatId', key: 'wechatId' },
    { title: '最近订单', key: 'lastOrder', width: 220, render: (_: any, r: any) => {
      const o = r.orders?.[0];
      if (!o) return <Text type="secondary">-</Text>;
      const cf = o.customFields || {};
      return (<>
        <Text strong>{o.gameName}</Text>
        <br /><Text type="secondary" style={{ fontSize: 11 }}>
          <Tag color={orderTypeConfig[o.type]?.color} style={{ fontSize: 10, margin: 0 }}>{orderTypeConfig[o.type]?.label || o.type}</Tag>
          {' '}¥{Number(o.amount).toFixed(0)}
          {cf.deltaMode && <Tag style={{ fontSize: 10, margin: '0 0 0 4px' }}>{cf.deltaMode}</Tag>}
          {cf.deltaMission && <Tag color="red" style={{ fontSize: 10, margin: '0 0 0 4px' }}>{cf.deltaMission}</Tag>}
          {cf.deltaCount && <Tag style={{ fontSize: 10, margin: '0 0 0 4px' }}>{cf.deltaCount}</Tag>}
          {cf.billingMode === 'round' && <Tag style={{ fontSize: 10, margin: '0 0 0 4px' }}>🎯{o.duration||cf.deltaCount||'?'}局</Tag>}
          {o.duration > 0 && cf.billingMode !== 'round' && <Text style={{ fontSize: 10 }}> · {o.duration}h</Text>}
        </Text>
      </>);
    }},
    { title: '来源/时间', key: 'source', width: 110, render: (_: any, r: any) => {
      const cf = r.orders?.[0]?.customFields || {};
      return (<>
        {cf.customerSource && <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>📡{cf.customerSource}</Tag>}
        {cf.urgency && <Tag color={urgencyConfig[cf.urgency]?.color} style={{ fontSize: 10, margin: '2px 0' }}>{urgencyConfig[cf.urgency]?.label}</Tag>}
        {cf.billingMode && <Tag style={{ fontSize: 10, margin: 0 }}>{billingModeConfig[cf.billingMode]?.label}</Tag>}
      </>);
    }},
    { title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (s: string) => { const cfg = customerStatusConfig[s]; return cfg ? <Tag color={cfg.color}>{cfg.label}</Tag> : <Tag>{s || '-'}</Tag>; } },
    { title: '陪玩', dataIndex: ['companion', 'username'], key: 'companion', render: (name: string) => name ?? <Text type="secondary">未分配</Text> },
    { title: '累计消费', dataIndex: 'totalSpent', key: 'totalSpent', width: 120,
      render: (val: number) => <span style={{ color: '#FF4757', fontWeight: 600 }}>¥{(val ?? 0).toFixed(2)}</span> },
  ];

  if (isCompanion) {
    columns.push({
      title: '备注', key: 'notes', width: 280,
      render: (_: unknown, record: Customer) => (
        <Input size="small" placeholder="输入备注"
          style={{ width: '100%', maxWidth: 260 }}
          value={notesEditing[record.id] ?? record.notes ?? ''}
          onChange={(e) => setNotesEditing(prev => ({ ...prev, [record.id]: e.target.value }))}
          onBlur={() => { const v = notesEditing[record.id]; if (v !== undefined && v !== record.notes) saveNotes(record.id, v); }}
          onPressEnter={(e: any) => { e.target.blur(); }} />
      ),
    });
    columns.push({
      title: '操作', key: 'actions', width: 280,
      render: (_: unknown, record: Customer) => (
        <Space size={4}>
          {record.orders?.[0]?.id && (
            <Button size="small" icon={React.createElement(MessageOutlined)} onClick={() => openChat(record)}>沟通</Button>
          )}
          <Button type="primary" size="small" icon={React.createElement(PlayCircleOutlined)} onClick={() => { setStartServicePreFill({ customerId: record.id, companionSelfId: user?.companionId, gameName: record.orders?.[0]?.gameName, amount: record.orders?.[0]?.amount }); setCreateOrderOpen(true); }}>开始服务</Button>
          <Button size="small" icon={React.createElement(SendOutlined)} onClick={() => setCreateOrderOpen(true)}>发布订单</Button>
          <Button size="small" icon={React.createElement(CalendarOutlined)} onClick={() => openScheduleModal(record)}>预约</Button>
        </Space>
      ),
    });
  } else {
    columns.push({
      title: '操作', key: 'actions', width: canReassign ? 260 : 160,
      render: (_: unknown, record: Customer) => (
        <Space size="small">
          {canReassign && <Button type="link" size="small" icon={React.createElement(SwapOutlined)} onClick={() => openReassignModal(record)}>归属调整</Button>}
          {canManage && <Button type="link" size="small" icon={React.createElement(EditOutlined)} onClick={() => openEditModal(record)}>编辑</Button>}
          {isAdmin && (
            <Popconfirm title="确定删除该客户？" onConfirm={() => handleDelete(record.id)} okText="确定" cancelText="取消">
              <Button type="link" size="small" danger icon={React.createElement(DeleteOutlined)}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    });
  }

  return (
    <ConfigProvider locale={zhCN}>
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div><Text strong style={{ fontSize: 16 }}>客户管理</Text>{isCompanion && <><br /><Text type="secondary">管理我的客户信息</Text></>}</div>
        <Space>
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetchCustomers} loading={loading}>刷新</Button>
          {canManage && <Button type="primary" icon={React.createElement(PlusOutlined)} onClick={openCreateModal}>新建客户</Button>}
        </Space>
      </div>
      {error && <div style={{ color: '#ff4d4f', background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, padding: '8px 12px', marginBottom: 16 }}>{error}</div>}
      <Table columns={columns} dataSource={customers} rowKey="id" loading={loading}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: '暂无客户数据' }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }} />
      <Modal title={editingCustomer ? '编辑客户' : '新建客户'} open={modalOpen} onOk={handleSubmit}
        onCancel={() => { setModalOpen(false); form.resetFields(); }} confirmLoading={submitting} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="wechatId" label="微信号" rules={[{ required: true, message: '请输入微信号' }]}><Input placeholder="请输入微信号" /></Form.Item>
          <Form.Item name="platform" label="平台" rules={[{ required: true, message: '请选择平台' }]}>
            <Select placeholder="请选择平台">{platformOptions.map((opt) => <Option key={opt.value} value={opt.value}>{opt.label}</Option>)}</Select>
          </Form.Item>
          <Form.Item name="platformAccount" label="平台账号"><Input placeholder="请输入平台账号" /></Form.Item>
          <Form.Item name="notes" label="备注"><Input.TextArea rows={3} placeholder="请输入备注信息" /></Form.Item>
        </Form>
      </Modal>
      <Modal title="归属调整" open={reassignModalOpen} onOk={handleReassign}
        onCancel={() => { setReassignModalOpen(false); reassignForm.resetFields(); }} confirmLoading={reassigning} okText="确认分配" cancelText="取消" destroyOnClose>
        <Form form={reassignForm} layout="vertical" style={{ marginTop: 16 }}>
          <p>将客户 <Text strong>{reassigningCustomer?.customerCode}</Text> 重新分配给：</p>
          <Form.Item name="companionId" rules={[{ required: true, message: '请选择陪玩' }]}>
            <Select placeholder="请选择陪玩" loading={companionsLoading}
              options={companionOptions.map((c) => ({ label: c.username, value: c.id }))} />
          </Form.Item>
        </Form>
      </Modal>
      <ChatModal open={!!chatPartner} partner={chatPartner} onClose={() => setChatPartner(null)} />
      <CreateOrderModal open={createOrderOpen} onClose={() => { setCreateOrderOpen(false); setStartServicePreFill(null); }} onCreated={() => { fetchCustomers(); setStartServicePreFill(null); }} userId={user?.id} customerPreFill={startServicePreFill} />
      <Modal title="预约时间" open={scheduleModalOpen} onOk={handleSchedule} onCancel={() => setScheduleModalOpen(false)}
        okText="确认预约" cancelText="取消" destroyOnClose>
        <div style={{ marginTop: 16 }}>
          <p>为客户 <Text strong>{scheduleCustomer?.customerCode}</Text> 设置预约提醒：</p>
          <DatePicker showTime format="YYYY年M月D日 HH:mm" placeholder="选择预约时间"
            value={scheduleTime} onChange={(v) => setScheduleTime(v)}
            style={{ width: '100%' }} />
        </div>
      </Modal>
    </div>
    </ConfigProvider>
  );
};

export default CustomersPage;
