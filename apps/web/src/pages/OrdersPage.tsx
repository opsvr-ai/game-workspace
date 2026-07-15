import React, { useState, useEffect, useCallback } from 'react';
import { Typography, Button, Select, DatePicker, message, Badge, Tag, Image, Upload, Modal, Input } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';
import OrderTable from '../components/OrderTable';
import CreateOrderModal from '../components/CreateOrderModal';
import { orderStatusConfig } from '../constants';

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
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});

  useEffect(() => {
    const read = () => {
      const m: Record<string, number> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('unread-')) m[k.replace('unread-', '')] = parseInt(localStorage.getItem(k) || '0', 10);
      }
      setUnreadMap(m);
    };
    read(); const t = setInterval(read, 3000); return () => clearInterval(t);
  }, []);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (statusFilter) params.status = statusFilter;
      const { data } = await http.get('/orders', { params });
      setOrders(data.data?.items ?? data.data ?? []);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  // Companion-only action buttons
  const renderCompanionActions = (r: any) => (
    <>
      <Badge count={unreadMap[r.id] || 0} size="small">
        <Button size="small" onClick={() => {
          localStorage.removeItem(`unread-${r.id}`);
          setUnreadMap(prev => { const { [r.id]: _, ...rest } = prev; return rest; });
        }}>沟通</Button>
      </Badge>
      {r.status === 'GRABBED' && !r.contactStatus && (<>
        <Button type="primary" size="small" style={{ background: '#52c41a', borderColor: '#52c41a' }} onClick={async () => {
          try { await http.put(`/orders/${r.id}/contact`, { contactStatus: 'added' }); message.success('已标记'); fetch(); }
          catch(e:any) { message.error(e?.response?.data?.message||'操作失败'); }
        }}>联系方式添加成功</Button>
        <Upload showUploadList={false} accept="image/*" beforeUpload={async (file) => {
          const fd = new FormData(); fd.append('file', file);
          try { const { data } = await http.post('/upload/screenshot', fd);
            await http.put(`/orders/${r.id}/contact`, { contactStatus: 'not_accepted', screenshotUrl: data.data?.url || data.url || '' });
            message.success('截图已上传，等待审核补客户'); fetch();
          } catch(e:any) { message.error('上传失败'); }
          return false;
        }}>
          <Button danger size="small">📎 已添加未同意</Button>
        </Upload>
      </>)}
      {r.status === 'GRABBED' && r.contactStatus === 'not_accepted' && (<>
        <Tag color="orange">待客户同意</Tag>
        {r.screenshotUrl && <Image src={r.screenshotUrl} width={40} style={{ marginLeft: 4, borderRadius: 4 }} />}
        {(user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS') && (
          <Button size="small" type="primary" style={{ background: '#fa8c16', borderColor: '#fa8c16' }} onClick={() => {
            setPreFill({ customerId: r.customer?.id, customerWechat: r.customFields?.customerWechat || r.customer?.wechatId, gameName: r.gameName, amount: r.amount, notes: '补单客户' });
            setCreateOpen(true);
          }}>补客户</Button>
        )}
      </>)}
    </>
  );

  // Admin/CS/Owner actions — show screenshot + compensate button + reassign
  const [companions, setCompanions] = useState<any[]>([]);
  useEffect(() => { http.get('/companions').then(({data}:any) => setCompanions(data.data||[])).catch(()=>{}); }, []);

  const [switchWxOrder, setSwitchWxOrder] = useState<any>(null);
  const [selectedWxId, setSelectedWxId] = useState('');
  const [reassignOrder, setReassignOrder] = useState<any>(null);
  const [reassignCompanionId, setReassignCompanionId] = useState<string>('');
  const [reassignNote, setReassignNote] = useState('');

  const renderAdminActions = (r: any) => (<>
    {r.status !== 'DONE' && r.status !== 'CANCELLED' && (
      <Button type="link" size="small" onClick={() => { setReassignOrder(r); setReassignCompanionId(r.companionId || ''); setReassignNote(''); }}>
        归属调整
      </Button>
    )}
    {r.contactStatus === 'not_accepted' && r.screenshotUrl && (
      <Image src={r.screenshotUrl} width={40} style={{ borderRadius: 4, cursor: 'pointer', marginLeft: 4 }} preview={{ mask: '查看' }} />
    )}
    {r.contactStatus === 'not_accepted' && (
      <Button size="small" type="primary" style={{ background: '#fa8c16', borderColor: '#fa8c16', marginLeft: 4 }}
        onClick={async () => {
          try { await http.post(`/orders/${r.id}/compensate-customer`); message.success('已补客户'); fetch(); }
          catch(e:any) { message.error(e?.response?.data?.message||'操作失败'); }
        }}>补客户</Button>
    )}
  </>);

  const sorted = [...orders].sort((a: any, b: any) => {
    const aUnread = unreadMap[a.id] || 0; const bUnread = unreadMap[b.id] || 0;
    if (aUnread > 0 && bUnread === 0) return -1;
    if (bUnread > 0 && aUnread === 0) return 1;
    return new Date(b.grabbedAt || b.createdAt).getTime() - new Date(a.grabbedAt || a.createdAt).getTime();
  }).filter((o: any) => {
    if (!dateFilter) return true;
    return new Date(o.grabbedAt || o.createdAt).toDateString() === dateFilter.toDate().toDateString();
  });

  return (
    <>
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <Text strong style={{ fontSize: 16 }}>{isCompanion ? '接单记录' : '📋 订单管理'}</Text>
          {isCompanion && <><br /><Text type="secondary">查看我的接单历史</Text></>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select placeholder="全部状态" allowClear value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')} style={{ width: 120 }}>
            {Object.entries(orderStatusConfig).map(([k, v]) => <Option key={k} value={k}>{v.label}</Option>)}
          </Select>
          <DatePicker placeholder="筛选日期" value={dateFilter} onChange={setDateFilter} style={{ width: 140 }} />
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetch} loading={loading}>刷新</Button>
        </div>
      </div>
      <OrderTable dataSource={sorted} loading={loading} unreadMap={unreadMap}
        renderActions={isCompanion ? renderCompanionActions : renderAdminActions} />

      <Modal title="切换工作微信" open={!!switchWxOrder} onCancel={() => setSwitchWxOrder(null)} footer={null} width={400}>
        <Select placeholder="选择工作微信" value={selectedWxId || undefined} onChange={(v) => setSelectedWxId(v)} style={{ width: '100%' }} allowClear>
          {workWechats.map((w: any) => <Select.Option key={w.id} value={w.id}>{w.wechatId}{w.companion ? ' ('+w.companion?.user?.username+')' : ''}</Select.Option>)}
        </Select>
        <Button type="primary" block style={{ marginTop: 12 }} disabled={!selectedWxId} onClick={async () => {
          if (!selectedWxId || !switchWxOrder) return;
          try {
            const wx = workWechats.find((w: any) => w.id === selectedWxId);
            await http.put(`/orders/${switchWxOrder.id}/contact`, { workWechatId: selectedWxId, workWechatName: wx?.wechatId || '' });
            message.success('微信已切换');
            setSwitchWxOrder(null);
            setSelectedWxId('');
            fetch();
          } catch { message.error('操作失败'); }
        }}>确认切换</Button>
      </Modal>

      <Modal title="归属调整" open={!!reassignOrder}
        onOk={async () => {
          if (!reassignCompanionId) { message.warning('请选择陪玩'); return Promise.reject(); }
          try {
            await http.post(`/orders/${reassignOrder.id}/assign`, { companionId: reassignCompanionId });
            if (reassignNote) await http.put(`/orders/${reassignOrder.id}/contact`, { notes: `[归属调整] ${reassignNote}` });
            message.success('已重新分配');
            fetch();
            setReassignOrder(null);
          } catch(e:any) { message.error(e?.response?.data?.message||'分配失败'); return Promise.reject(); }
        }}
        onCancel={() => setReassignOrder(null)} okText="确认调整" cancelText="取消" destroyOnClose>
        <div style={{ marginBottom: 12 }}>
          <Text>当前陪玩：{reassignOrder?.companion?.user?.username || '未分配'}</Text>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Text>新陪玩：</Text>
          <Select value={reassignCompanionId || undefined} style={{ width: '100%' }}
            onChange={(v) => setReassignCompanionId(v)} placeholder="选择新陪玩">
            {companions.filter((c:any) => c.status !== 'OFFLINE').map((c:any) => (
              <Option key={c.id} value={c.id}>{c.user?.username || c.id.slice(0,6)}</Option>
            ))}
          </Select>
        </div>
        <div>
          <Text>备注：</Text>
          <Input.TextArea rows={3} value={reassignNote} onChange={(e) => setReassignNote(e.target.value)}
            placeholder="请填写归属调整原因" />
        </div>
      </Modal>
    </div>
      <CreateOrderModal open={createOpen} onClose={() => { setCreateOpen(false); setPreFill(null); }} onCreated={() => { message.success('补客户订单已创建'); fetch(); setCreateOpen(false); setPreFill(null); }} userId={user?.id} customerPreFill={preFill || undefined} />
    </>
  );
};

export default OrdersPage;
