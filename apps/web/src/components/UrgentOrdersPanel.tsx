import React, { useEffect, useState } from 'react';
import { Button, Card, Input, Modal, Select, Space, Typography, message } from 'antd';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import OrderTable, { noteSub, NOTE_SEP } from './OrderTable';
import { visibleInterval } from '../hooks/usePolling';
import { orderMatchesSearch } from '../utils/orderPool';

interface Props {
  onDispatch?: (item: any) => void;
  onGotoFollowup?: () => void;
}

/** 说明列里的短时间（09-27 04:14）：完整时间放 title 里悬停看 */
const fmtShort = (v: string) => {
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * 订单池流转失败明细（老板 2026-09-28：「流转失败列表页很混乱」）。
 *
 * 以前这一页是卡片行：一格叠两三行、十几个彩色标签、按钮自己占一行还不对齐。
 * 现在和订单管理用的是同一张表（components/OrderTable.tsx）：
 * 一格一行、列和表头上下对齐、状态只用彩色文字，退回时间 / 派了几次 / 添加情况收在「退回情况」列里。
 */
const UrgentOrdersPanel: React.FC<Props> = ({ onDispatch, onGotoFollowup }) => {
  const [items, setItems] = useState<any[]>([]);
  const [workWechats, setWorkWechats] = useState<any[]>([]);
  const [contactOrder, setContactOrder] = useState<any>(null);
  const [contactWechatId, setContactWechatId] = useState<string | undefined>();
  // 客户搜索：和订单池 / 派单记录同一个口径（老板 2026-09-27 要求也加上）
  const [search, setSearch] = useState('');

  const load = async () => {
    try {
      const { data } = await ordersApi.urgent();
      setItems(data.data || []);
    } catch {}
  };

  useEffect(() => {
    load();
    companionsApi
      .listWorkWechats()
      .then(({ data }: any) => setWorkWechats(data?.data || []))
      .catch(() => {});
    const t = visibleInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const openContact = (item: any) => {
    setContactOrder(item);
    setContactWechatId(item.customFields?.csWorkWechatId || undefined);
  };

  const submitContact = async () => {
    if (!contactOrder) return;
    if (!contactWechatId) {
      message.warning('请选择工作微信');
      return;
    }
    const wx = workWechats.find((w: any) => w.id === contactWechatId);
    const alreadyCultivated = contactOrder.customFields?.csCultivated === true;
    await ordersApi.markCsContact(contactOrder.id, 'added', undefined, {
      workWechatId: contactWechatId,
      workWechatName: wx?.wechatId,
      ...(alreadyCultivated ? { addResult: 'passed' } : {}),
    });
    message.success(alreadyCultivated ? '已回到跟进列表（保持已添加）' : '已标记添加，稍后在跟进列表确认成功/失败');
    setContactOrder(null);
    load();
    onGotoFollowup?.();
  };

  // 同上（2026-09-28）：这一页也是派单管理里的独立标签页，空的就整页白板太吓人，
  // 一律保留标题 + 表头 + 「暂无」提示。
  const shown = search ? items.filter((r) => orderMatchesSearch(r, search)) : items;

  // 这一页特有的「这一单现在什么情况」：加了没有 / 退回了 / 派了几次 / 谁发的能不能处理
  const contactStateOf = (r: any) => {
    if (r.csContactStatus === 'added') return { text: '已添加', color: '#15803D' };
    if (r.csContactStatus === 'not_accepted') return { text: '添加失败', color: '#B45309' };
    if (r.poolExpired) return { text: '流转失败', color: '#DC2626' };
    if (r.requireCsContact) return { text: '需添加', color: '#DC2626' };
    return null;
  };
  const noteBits = (r: any) => {
    const cf = r.customFields || {};
    return [
      r.companion?.user?.username ? `主陪 ${r.companion.user.username}` : '',
      r.poolExpiredAt ? `退回 ${fmtShort(r.poolExpiredAt)}` : '',
      r.dispatchCount > 1 ? `第${r.dispatchCount}次派` : '',
      cf.directAdd ? '直接添加' : '',
      cf.csCultivated ? '客服加过微信' : '',
      r.canProcess === false ? '仅发单客服可处理' : '',
    ].filter(Boolean);
  };
  const noteTitle = (r: any) => {
    const st = contactStateOf(r);
    return [st?.text, ...noteBits(r)].filter(Boolean).join(' · ');
  };

  const renderActions = (r: any) =>
    r.canProcess === false ? null : (
      <Space size={4}>
        {r.csContactStatus !== 'added' && (
          <Button size="small" onClick={() => openContact(r)}>
            去跟进
          </Button>
        )}
        <Button size="small" type="primary" onClick={() => onDispatch?.(r)}>
          再次发布
        </Button>
      </Space>
    );

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontWeight: 600 }}>订单池流转失败明细</div>
          <Input.Search
            placeholder="搜客户微信 / 小红书 / 昵称 / 游戏名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            size="small"
            style={{ width: 240 }}
          />
          {search && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              筛选结果: {shown.length}/{items.length}
            </Typography.Text>
          )}
        </div>
        <OrderTable
          orders={shown}
          hideStudio
          renderActions={renderActions}
          emptyText={`没有匹配「${search}」的流转失败订单。`}
          noteColumn={{
            title: '退回情况',
            render: (r: any) => {
              const st = contactStateOf(r);
              const bits = noteBits(r);
              return (
                <>
                  {st && <span style={{ color: st.color }}>{st.text}</span>}
                  {bits.length > 0 && (
                    <span style={noteSub}>
                      {st ? NOTE_SEP : ''}
                      {bits.join(NOTE_SEP)}
                    </span>
                  )}
                  {!st && bits.length === 0 && <span style={{ color: '#94A3B8' }}>-</span>}
                </>
              );
            },
            titleText: noteTitle,
          }}
        />
      </Card>

      <Modal
        title="添加客户"
        open={!!contactOrder}
        onOk={submitContact}
        onCancel={() => setContactOrder(null)}
        okText="确认已添加"
        cancelText="取消"
        width={460}
      >
        {contactOrder && (
          <div style={{ lineHeight: 2.4 }}>
            <div>
              {contactOrder.gameName} · ¥{contactOrder.amount}
            </div>
            <div>
              <strong>工作微信：</strong>
              <Select
                placeholder="选择工作微信"
                value={contactWechatId}
                onChange={setContactWechatId}
                style={{ width: '100%' }}
                allowClear
              >
                {workWechats.filter((w: any) => w.type === 'STUDIO').map((w: any) => (
                  <Select.Option key={w.id} value={w.id}>
                    {w.wechatId}{w.nickname ? `（${w.nickname}）` : ''}
                  </Select.Option>
                ))}
              </Select>
            </div>
            <div style={{ color: '#888', fontSize: 12 }}>
              确认后即标记「已添加」；添加成功或失败，请在「跟进列表」里选择，无需上传截图。
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};

export default UrgentOrdersPanel;
