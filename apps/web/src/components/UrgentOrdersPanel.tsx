import React, { useEffect, useState } from 'react';
import { Button, Card, Modal, Select, Space, Tag, message } from 'antd';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import OrderRow from './OrderRow';

interface Props {
  onDispatch?: (item: any) => void;
  onGotoFollowup?: () => void;
}

const UrgentOrdersPanel: React.FC<Props> = ({ onDispatch, onGotoFollowup }) => {
  const [items, setItems] = useState<any[]>([]);
  const [workWechats, setWorkWechats] = useState<any[]>([]);
  const [contactOrder, setContactOrder] = useState<any>(null);
  const [contactWechatId, setContactWechatId] = useState<string | undefined>();

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
    const t = setInterval(load, 10000);
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

  if (items.length === 0) return null;

  const renderActions = (r: any) => (
    <Space size={4} wrap>
      {r.dispatchCount > 1 && <Tag color="orange" style={{ margin: 0 }}>第{r.dispatchCount}次派</Tag>}
      {r.customFields?.directAdd && <Tag color="cyan" style={{ margin: 0 }}>直接添加</Tag>}
      {r.csContactStatus === 'added' ? (
        <Tag color="green">已添加</Tag>
      ) : r.csContactStatus === 'not_accepted' ? (
        <Tag color="orange">添加失败</Tag>
      ) : r.poolExpired ? (
        <Tag color="red" style={{ margin: 0 }}>流转失败</Tag>
      ) : r.requireCsContact ? (
        <Tag color="red" style={{ margin: 0 }}>需添加</Tag>
      ) : null}
      {r.csContactStatus !== 'added' && (
        <Button size="small" onClick={() => openContact(r)}>跳转到直添客户跟进列表</Button>
      )}
      <Button size="small" type="primary" onClick={() => onDispatch?.(r)}>再次发布订单</Button>
    </Space>
  );

  return (
    <>
      <Card size="small" style={{ marginBottom: 12, borderColor: '#ff4d4f' }}>
        <div style={{ fontWeight: 600, marginBottom: 8, color: '#d4380d' }}>📥 订单池流转失败明细</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((r, idx) => (
            <OrderRow key={r.id} order={r} index={idx} renderActions={renderActions} />
          ))}
        </div>
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
            <div>📋 {contactOrder.gameName} · ¥{contactOrder.amount}</div>
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
                    {w.wechatId}
                  </Select.Option>
                ))}
              </Select>
            </div>
            <div style={{ color: '#888', fontSize: 12 }}>
              确认后即标记“已添加”；添加成功或失败，请在「跟进列表」里选择，无需上传截图。
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};

export default UrgentOrdersPanel;
