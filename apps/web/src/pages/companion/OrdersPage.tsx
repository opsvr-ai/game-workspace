import React, { useState, useEffect, useCallback } from 'react';
import { Table, Tag, Typography, Button, message, Select, Modal, Input, InputNumber, Checkbox, Upload, Space, Divider } from 'antd';
import { ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import http from '../../api/client';
import { ordersApi } from '../../api/orders';
import { useAuthStore } from '../../stores/authStore';

const { Text } = Typography;
const { Option } = Select;

const typeConfig: Record<string, { color: string; label: string }> = {
  NEW: { color: 'blue', label: '新单' }, RENEW: { color: 'cyan', label: '续费' },
  REPURCHASE: { color: 'purple', label: '复购' }, TIP: { color: 'orange', label: '打赏' },
};
const statusConfig: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'gold', label: '待派' }, GRABBED: { color: 'blue', label: '已抢' },
  CONFIRMED: { color: 'green', label: '已确认' }, DONE: { color: 'green', label: '已完成' },
  CANCELLED: { color: 'default', label: '已取消' },
};

interface SettlementForm {
  customerCode: string;
  firstDuration: number;
  firstPrice: number;
  hasRenew: boolean;
  renewDuration: number;
  renewPrice: number;
  customerType: string;
  gameName: string;
  settlementType: string;
  screenshotUrl: string;
  wechatId: string;
}

const OrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const { chatActive, chatPartner, setChatActive } = useAuthStore();

  // Settlement modal state
  const [settleModal, setSettleModal] = useState(false);
  const [settleOrderId, setSettleOrderId] = useState<string>('');
  const [settleLoading, setSettleLoading] = useState(false);
  const [form, setForm] = useState<SettlementForm>({
    customerCode: '',
    firstDuration: 0,
    firstPrice: 0,
    hasRenew: false,
    renewDuration: 0,
    renewPrice: 0,
    customerType: '',
    gameName: '',
    settlementType: 'COMPANION',
    screenshotUrl: '',
    wechatId: '',
  });

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      const { data } = await http.get('/orders', { params });
      const list = data.data?.items ?? data.data ?? [];
      setOrders(list);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  // Auto-detect customer type when customerCode changes
  useEffect(() => {
    if (!form.customerCode || form.customerCode.length < 2) {
      setForm(prev => ({ ...prev, customerType: '' }));
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { data } = await http.get('/customers', { params: { customerCode: form.customerCode } });
        const customers = data.data?.items ?? data.data ?? [];
        if (Array.isArray(customers) && customers.length > 0) {
          const customer = customers[0];
          // Check order history to determine type
          try {
            const orderRes = await http.get('/orders', { params: { customerId: customer.id, status: 'DONE' } });
            const doneOrders = orderRes.data?.data?.items ?? orderRes.data?.data ?? [];
            const doneCount = Array.isArray(doneOrders) ? doneOrders.length : 0;
            setForm(prev => ({
              ...prev,
              customerType: doneCount === 0 ? 'NEW' : 'REPURCHASE',
              gameName: prev.gameName || customer.preferredGame || '',
              wechatId: prev.wechatId || customer.wechatId || '',
            }));
          } catch {
            setForm(prev => ({ ...prev, customerType: 'NEW' }));
          }
        }
      } catch { /* customer lookup may fail */ }
    }, 500);
    return () => clearTimeout(timer);
  }, [form.customerCode]);

  const firstAmount = (form.firstDuration || 0) * (form.firstPrice || 0);
  const renewAmount = form.hasRenew ? (form.renewDuration || 0) * (form.renewPrice || 0) : 0;
  const totalAmount = firstAmount + renewAmount;
  const totalDuration = (form.firstDuration || 0) + (form.hasRenew ? (form.renewDuration || 0) : 0);

  const openSettleModal = (order: any) => {
    setSettleOrderId(order.id);
    setForm({
      customerCode: order.customer?.customerCode || order.customFields?.customerCode || '',
      firstDuration: order.duration || 1,
      firstPrice: order.amount || 0,
      hasRenew: false,
      renewDuration: 0,
      renewPrice: 0,
      customerType: order.type === 'NEW' ? 'NEW' : order.type === 'REPURCHASE' ? 'REPURCHASE' : '',
      gameName: order.gameName || '',
      settlementType: 'COMPANION',
      screenshotUrl: '',
      wechatId: order.customFields?.customerWechat || order.customer?.wechatId || '',
    });
    setSettleModal(true);
  };

  const handleSettleSubmit = async () => {
    if (!form.firstDuration || !form.firstPrice) {
      message.warning('请填写首单时长和单价');
      return;
    }
    if (!form.gameName) {
      message.warning('请填写游戏名称');
      return;
    }
    setSettleLoading(true);
    try {
      await ordersApi.completeBilling(settleOrderId, {
        customerCode: form.customerCode || undefined,
        firstOrder: { duration: form.firstDuration, price: form.firstPrice },
        hasRenew: form.hasRenew,
        renewOrder: form.hasRenew ? { duration: form.renewDuration, price: form.renewPrice } : undefined,
        gameName: form.gameName,
        type: form.settlementType,
        screenshotUrl: form.screenshotUrl || undefined,
        wechatId: form.wechatId || undefined,
      });
      message.success('服务结算完成');
      setSettleModal(false);
      fetch();
    } catch (e: any) {
      message.error(e?.response?.data?.message ?? '结算失败');
    } finally {
      setSettleLoading(false);
    }
  };

  const handleUpload = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const { data } = await http.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setForm(prev => ({ ...prev, screenshotUrl: data.data?.url ?? data.url ?? '' }));
      message.success('上传成功');
    } catch {
      message.error('上传失败');
    }
    return false; // Prevent default upload behavior
  };

  return (
    <div>
      {chatActive && (
        <div onClick={() => setChatActive(false)} style={{
          background: 'linear-gradient(135deg, #FF4757, #FF6B81)', borderRadius: 14, padding: '14px 18px',
          marginBottom: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14,
          boxShadow: '0 4px 16px rgba(255,71,87,0.35)',
        }}>
          <span style={{ width: 44, height: 44, borderRadius: '50%', background: '#FFF',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 900, color: '#FF4757',
            animation: 'pulse-glow 0.8s ease-in-out infinite', boxShadow: '0 0 16px rgba(255,255,255,0.6)' }}>
            {(chatPartner || '?')[0].toUpperCase()}
          </span>
          <div style={{ flex: 1, color: '#FFF' }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{chatPartner} 发来消息</div>
            <div style={{ fontSize: 13, opacity: 0.9, marginTop: 2 }}>💬 点击前往订单池查看并回复</div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Text strong style={{ fontSize: 16 }}>接单记录</Text>
          <br /><Text type="secondary">查看我的接单历史</Text>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select placeholder="全部状态" allowClear value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')} style={{ width: 120 }}>
            {Object.entries(statusConfig).map(([k, v]) => <Option key={k} value={k}>{v.label}</Option>)}
          </Select>
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetch} loading={loading}>刷新</Button>
        </div>
      </div>
      <Table size="small" dataSource={orders} rowKey="id" loading={loading}
        columns={[
          { title: '订单ID', dataIndex: 'id', width: 90, render: (v: string) => v?.slice(0, 8) },
          { title: '游戏', dataIndex: 'gameName', width: 100 },
          { title: '客户', key: 'wx', width: 120, render: (_: any, r: any) => r.customFields?.customerWechat || r.customer?.wechatId || '-' },
          { title: '金额', dataIndex: 'amount', width: 100, render: (v: number) => <span style={{ color: '#FF4757', fontWeight: 600 }}>¥{v?.toFixed(2)}</span> },
          { title: '类型', dataIndex: 'type', width: 70, render: (t: string) => <Tag color={typeConfig[t]?.color}>{typeConfig[t]?.label || t}</Tag> },
          { title: '接单人', key: 'companion', width: 100,
            render: (_: any, r: any) => r.companion?.user?.username ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#7B61FF', color: '#FFF',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
                  {r.companion.user.username[0].toUpperCase()}
                </span>
                <Text>{r.companion.user.username}</Text>
              </span>
            ) : <Text type="secondary">-</Text>
          },
          { title: '状态', dataIndex: 'status', width: 80, render: (s: string) => <Tag color={statusConfig[s]?.color}>{statusConfig[s]?.label||s}</Tag> },
          { title: '创建时间', dataIndex: 'createdAt', width: 130, render: (v: string) => v ? new Date(v).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '-' },
          {
            title: '操作', key: 'action', width: 100,
            render: (_: any, r: any) => {
              if (r.status === 'CONFIRMED') {
                return (
                  <Button type="primary" size="small" onClick={() => openSettleModal(r)}>
                    结束服务
                  </Button>
                );
              }
              return null;
            },
          },
        ]}
        pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 条` }}
      />

      {/* Settlement Modal */}
      <Modal
        title="服务结算"
        open={settleModal}
        onOk={handleSettleSubmit}
        onCancel={() => setSettleModal(false)}
        okText="提交结算"
        cancelText="取消"
        confirmLoading={settleLoading}
        width={520}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {/* Customer Code */}
          <div>
            <Text strong>客户编号</Text>
            <Input
              placeholder="输入客户编号自动检测类型"
              value={form.customerCode}
              onChange={e => setForm(prev => ({ ...prev, customerCode: e.target.value }))}
              style={{ marginTop: 4 }}
            />
            {form.customerType && (
              <Tag color={form.customerType === 'NEW' ? 'blue' : 'purple'} style={{ marginTop: 4 }}>
                {form.customerType === 'NEW' ? '首单客户' : '复购客户'}
              </Tag>
            )}
          </div>

          <Divider style={{ margin: '8px 0' }} />

          {/* Game Name & Settlement Type */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Text strong>游戏名称</Text>
              <Input
                placeholder="游戏名称"
                value={form.gameName}
                onChange={e => setForm(prev => ({ ...prev, gameName: e.target.value }))}
                style={{ marginTop: 4 }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Text strong>结算类型</Text>
              <Select
                value={form.settlementType}
                onChange={(v) => setForm(prev => ({ ...prev, settlementType: v }))}
                style={{ width: '100%', marginTop: 4 }}
              >
                <Option value="COMPANION">陪玩</Option>
                <Option value="ESCORT">代练</Option>
              </Select>
            </div>
          </div>

          <Divider style={{ margin: '8px 0' }} />

          {/* First Order (Required) */}
          <div>
            <Text strong style={{ color: '#FF4757' }}>首单（必填）</Text>
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <div style={{ flex: 1 }}>
                <Text type="secondary">时长（小时）</Text>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.5}
                  value={form.firstDuration}
                  onChange={v => setForm(prev => ({ ...prev, firstDuration: v ?? 0 }))}
                />
              </div>
              <div style={{ flex: 1 }}>
                <Text type="secondary">单价（元/小时）</Text>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  step={0.01}
                  value={form.firstPrice}
                  onChange={v => setForm(prev => ({ ...prev, firstPrice: v ?? 0 }))}
                />
              </div>
              <div style={{ flex: 1 }}>
                <Text type="secondary">小计</Text>
                <div style={{ padding: '4px 11px', border: '1px solid #d9d9d9', borderRadius: 6, marginTop: 4, background: '#fafafa' }}>
                  <Text strong style={{ color: '#FF4757' }}>¥{firstAmount.toFixed(2)}</Text>
                </div>
              </div>
            </div>
          </div>

          {/* Renew Order */}
          <div>
            <Checkbox
              checked={form.hasRenew}
              onChange={e => setForm(prev => ({ ...prev, hasRenew: e.target.checked }))}
            >
              <Text strong>是否续单？</Text>
            </Checkbox>
            {form.hasRenew && (
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <div style={{ flex: 1 }}>
                  <Text type="secondary">续单时长（小时）</Text>
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    step={0.5}
                    value={form.renewDuration}
                    onChange={v => setForm(prev => ({ ...prev, renewDuration: v ?? 0 }))}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Text type="secondary">续单单价（元/小时）</Text>
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    step={0.01}
                    value={form.renewPrice}
                    onChange={v => setForm(prev => ({ ...prev, renewPrice: v ?? 0 }))}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Text type="secondary">续单小计</Text>
                  <div style={{ padding: '4px 11px', border: '1px solid #d9d9d9', borderRadius: 6, marginTop: 4, background: '#fafafa' }}>
                    <Text strong style={{ color: '#722ed1' }}>¥{renewAmount.toFixed(2)}</Text>
                  </div>
                </div>
              </div>
            )}
          </div>

          <Divider style={{ margin: '8px 0' }} />

          {/* Total Summary */}
          <div style={{
            background: 'linear-gradient(135deg, #f0f5ff, #e6f7ff)',
            borderRadius: 8,
            padding: '12px 16px',
          }}>
            <Space size="large">
              <span>
                <Text type="secondary">总时长 </Text>
                <Text strong style={{ fontSize: 16 }}>{totalDuration}小时</Text>
              </span>
              <span style={{ color: '#d9d9d9' }}>|</span>
              <span>
                <Text type="secondary">总金额 </Text>
                <Text strong style={{ fontSize: 16, color: '#FF4757' }}>¥{totalAmount.toFixed(2)}</Text>
              </span>
            </Space>
          </div>

          {/* Screenshot Upload */}
          <div>
            <Text strong>截图凭证</Text>
            <div style={{ marginTop: 4 }}>
              <Upload
                beforeUpload={handleUpload}
                maxCount={1}
                listType="picture-card"
              >
                <Button icon={React.createElement(UploadOutlined)}>上传截图</Button>
              </Upload>
            </div>
          </div>

          {/* Wechat ID */}
          <div>
            <Text strong>客户微信ID</Text>
            <Input
              placeholder="客户微信ID"
              value={form.wechatId}
              onChange={e => setForm(prev => ({ ...prev, wechatId: e.target.value }))}
              style={{ marginTop: 4 }}
            />
          </div>
        </Space>
      </Modal>
    </div>
  );
};

export default OrdersPage;
