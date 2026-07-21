// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback } from 'react';
import { Typography, Button, Select, DatePicker, message, Badge, Tag, Image, Upload, Modal, Input } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { extractErrorMessage } from '../utils/error-handler';
import http from '../api/client';
import { useAuthStore } from '../stores/authStore';
import OrderTable from '../components/OrderTable';
import CreateOrderModal from '../components/CreateOrderModal';
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
  const renderCompanionActions = (r: any) => (
    <>
      <Badge count={unreadMap[r.id] || 0} size="small">
        <Button
          size="small"
          onClick={() => {
            setUnreadMap((prev) => {
              const { [r.id]: _, ...rest } = prev;
              return rest;
            });
          }}
        >
          沟通
        </Button>
      </Badge>
      {r.status === 'GRABBED' && !r.contactStatus && (
        <>
          <Button
            type="primary"
            size="small"
            style={{ background: '#16A34A', borderColor: '#16A34A' }}
            onClick={async () => {
              try {
                await http.put(`/orders/${r.id}/contact`, { contactStatus: 'added' });
                message.success('已标记');
                fetch();
              } catch (e: any) {
                message.error(extractErrorMessage(e, '操作失败'));
              }
            }}
          >
            联系方式添加成功
          </Button>
          <Upload
            showUploadList={false}
            accept="image/*"
            beforeUpload={async (file) => {
              const fd = new FormData();
              fd.append('file', file);
              try {
                const { data } = await http.post('/upload/screenshot', fd);
                await http.put(`/orders/${r.id}/contact`, {
                  contactStatus: 'not_accepted',
                  screenshotUrl: data.data?.url || data.url || '',
                });
                message.success('截图已上传，等待审核补客户');
                fetch();
              } catch (e: any) {
                message.error('上传失败');
              }
              return false;
            }}
          >
            <Button danger size="small">
              📎 已添加未同意
            </Button>
          </Upload>
        </>
      )}
      {r.status === 'GRABBED' && r.contactStatus === 'not_accepted' && (
        <>
          <Tag color="orange">待客户同意</Tag>
          {r.screenshotUrl && <Image src={r.screenshotUrl} width={40} style={{ marginLeft: 4, borderRadius: 4 }} />}
          {(user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'CS') && (
            <Button
              size="small"
              type="primary"
              style={{ background: '#F59E0B', borderColor: '#F59E0B' }}
              onClick={() => {
                setPreFill({
                  customerId: r.customer?.id,
                  customerWechat: r.customFields?.customerWechat || r.customer?.wechatId,
                  gameName: r.gameName,
                  amount: r.amount,
                  companionId: r.companionId,
                  dispatchType: 'DIRECT',
                  notes: '补单客户',
                });
                setCreateOpen(true);
              }}
            >
              补客户
            </Button>
          )}
        </>
      )}
    </>
  );

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
      {r.contactStatus === 'not_accepted' && r.screenshotUrl && (
        <Image
          src={r.screenshotUrl}
          width={40}
          style={{ borderRadius: 4, cursor: 'pointer', marginLeft: 4 }}
          preview={{ mask: '查看' }}
        />
      )}
      {r.contactStatus === 'not_accepted' && (
        <Button
          size="small"
          type="primary"
          style={{ background: '#fa8c16', borderColor: '#fa8c16', marginLeft: 4 }}
          onClick={() => {
            setPreFill({
              customerId: r.customer?.id,
              customerWechat: r.customFields?.customerWechat || r.customer?.wechatId,
              gameName: r.gameName,
              amount: r.amount,
              companionId: r.companionId,
              dispatchType: 'DIRECT',
              notes: '补单客户',
            });
            setCreateOpen(true);
          }}
        >
          补客户
        </Button>
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
            placeholder="陪玩筛选"
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
          <OrderTable
            dataSource={sorted}
            loading={loading}
            unreadMap={unreadMap}
            renderActions={isCompanion ? renderCompanionActions : renderAdminActions}
          />
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
              placeholder="选择新陪玩"
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
      </div>
      <CreateOrderModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setPreFill(null);
        }}
        onCreated={() => {
          message.success('补客户订单已创建');
          fetch();
          setCreateOpen(false);
          setPreFill(null);
        }}
        userId={user?.id}
        customerPreFill={preFill || undefined}
      />
    </>
  );
};

export default OrdersPage;
