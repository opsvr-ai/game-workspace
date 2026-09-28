import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Space, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { ordersApi } from '../api/orders';
import OrderTable, { noteSub, NOTE_SEP } from './OrderTable';
import { visibleInterval } from '../hooks/usePolling';

interface Props {
  refreshSignal?: number;
  onDispatch?: (item: any) => void;
}

/**
 * 管理端直添客户跟进列表（老板 2026-09-28：「流转失败列表页很混乱，你再查查所有角色所有页面」）。
 *
 * 和「订单池流转失败明细」一样，从卡片行改成和订单管理同一张表：
 * 一格一行、列和表头上下对齐、添加情况收在「添加情况」列里（彩色文字，不再彩色标签块）。
 */
const CsFollowupPanel: React.FC<Props> = ({ refreshSignal, onDispatch }) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await ordersApi.csFollowup();
      setItems(data.data || []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = visibleInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (refreshSignal) load();
  }, [refreshSignal]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) => {
      const cf = r.customFields || {};
      const c = r.customer || {};
      const haystack = [
        r.gameName,
        r.orderCode,
        c.wechatId,
        c.customerCode,
        c.platform,
        cf.customerSource,
        cf.customerSourceAccount,
        cf.customerNickname,
        cf.customerAccountId,
        cf.customerWechat,
        cf.customerYy,
        cf.customerPlatformAccount,
        cf.customerRoomCode,
        cf.deltaNote,
        cf.scheduledTimeText,
        cf.notes,
      ]
        .filter((v) => v != null && String(v).trim() !== '')
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, search]);

  const markResult = async (item: any, addResult: 'passed' | 'failed') => {
    await ordersApi.markCsContact(item.id, 'added', undefined, { addResult });
    message.success(addResult === 'passed' ? '已标记添加成功' : '已标记添加失败');
    load();
  };

  // 这一页特有的「加到哪一步了」：已添加 / 客户已同意 / 添加失败 / 还没标
  const stateOf = (r: any) => {
    if (r.contactStatus === 'added') return { text: '已添加', color: '#15803D' };
    if (r.contactStatus === 'not_accepted') return { text: '客户已同意', color: '#15803D' };
    if (r.status === 'GRABBED' || r.status === 'CONFIRMED') return { text: '添加失败', color: '#B45309' };
    return { text: '待添加', color: '#B45309' };
  };
  const bitsOf = (r: any) => {
    const cf = r.customFields || {};
    return [
      cf.directAdd ? '直接添加' : '',
      r.companion?.user?.username ? `主陪 ${r.companion.user.username}` : '',
      cf.deltaNote ? `备注 ${cf.deltaNote}` : '',
      cf.scheduledTimeText ? cf.scheduledTimeText : '',
    ].filter(Boolean);
  };

  const renderActions = (r: any) =>
    r.contactStatus === 'added' ? (
      <Space size={4}>
        <Button size="small" type="primary" onClick={() => onDispatch?.(r)}>
          重新派单
        </Button>
      </Space>
    ) : r.contactStatus === 'not_accepted' ? (
      <Space size={4}>
        <Button
          size="small"
          type="primary"
          style={{ background: '#16A34A', borderColor: '#16A34A' }}
          onClick={() => markResult(r, 'passed')}
        >
          客户已同意
        </Button>
      </Space>
    ) : (
      <Space size={4}>
        <Button
          size="small"
          type="primary"
          style={{ background: '#16A34A', borderColor: '#16A34A' }}
          onClick={() => markResult(r, 'passed')}
        >
          添加成功
        </Button>
        <Button size="small" danger onClick={() => markResult(r, 'failed')}>
          添加失败
        </Button>
      </Space>
    );

  // 老板 2026-09-28：「查查所有角色所有页面」——这一页是派单管理里的一个独立标签页，
  // 以前「一条跟进都没有」时整页 return null，客服点进来看到的是一片空白，
  // 既不知道是没数据还是坏了。现在和同组的「流转失败明细 / 流转明细」一样：
  // 标题、搜索框、表头都在，中间显示「暂无待跟进的直添客户」。
  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12 }}>
        <div style={{ fontWeight: 600 }}>管理端直添客户跟进列表</div>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索客户微信/昵称/ID/游戏/备注..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 300 }}
        />
      </div>
      <OrderTable
        orders={filtered}
        hideStudio
        loading={loading}
        renderActions={renderActions}
        emptyText="暂无待跟进的直添客户"
        noteColumn={{
          title: '添加情况',
          render: (r: any) => {
            const st = stateOf(r);
            const bits = bitsOf(r);
            return (
              <>
                <span style={{ color: st.color }}>{st.text}</span>
                {bits.length > 0 && <span style={noteSub}>{NOTE_SEP}{bits.join(NOTE_SEP)}</span>}
              </>
            );
          },
          titleText: (r: any) => [stateOf(r).text, ...bitsOf(r)].join(' · '),
        }}
      />
    </Card>
  );
};

export default CsFollowupPanel;
