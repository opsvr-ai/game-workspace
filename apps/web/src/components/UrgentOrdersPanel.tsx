import React, { useEffect, useState } from 'react';
import { Button, Card, Tag, Modal, Select, message } from 'antd';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';

interface Props {
  onDispatch?: (item: any) => void;
}

const UrgentOrdersPanel: React.FC<Props> = ({ onDispatch }) => {
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
    await ordersApi.markCsContact(contactOrder.id, 'added', undefined, {
      workWechatId: contactWechatId,
      workWechatName: wx?.wechatId,
    });
    message.success('已标记添加，稍后在跟进中确认成功/失败');
    setContactOrder(null);
    load();
  };

  if (items.length === 0) return null;

  const immediateItems = items.filter((i) => !i.isScheduled);
  const scheduledItems = items.filter((i) => i.isScheduled);

  const renderItem = (item: any) => (
    <div
      key={item.id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 4px',
        borderBottom: '1px solid #f0f0f0',
        fontSize: 12,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      <span style={{ fontWeight: 600 }}>{item.poolExpired ? '⏳ ' : '🔥 '}{item.gameName}</span>
      <span style={{ color: '#d4380d' }}>¥{item.amount}</span>
      <span style={{ color: '#888' }}>{item.customerWechat || '-'}</span>
      {item.csContactStatus === 'added' ? (
        <span style={{ color: '#52c41a' }}>
          已添加
          {item.customFields?.csAddResult === 'passed' ? '·成功' : item.customFields?.csAddResult === 'failed' ? '·失败' : '·待结果'}
        </span>
      ) : null}
      <span style={{ flex: 1 }} />
      {item.dispatchCount > 1 && (
        <Tag color="orange" style={{ margin: 0 }}>第{item.dispatchCount}次派</Tag>
      )}
      {item.customFields?.directAdd && (
        <Tag color="cyan" style={{ margin: 0 }}>直接添加</Tag>
      )}
      {item.poolExpired ? (
        <Tag color="red" style={{ margin: 0 }}>待处理</Tag>
      ) : item.requireCsContact ? (
        <Tag color="red" style={{ margin: 0 }}>需添加</Tag>
      ) : null}
      {item.csContactStatus !== 'added' && (
        <Button size="small" onClick={() => openContact(item)}>添加客户</Button>
      )}
      <Button size="small" type="primary" onClick={() => onDispatch?.(item)}>发布订单</Button>
    </div>
  );

  return (
    <>
      <Card size="small" style={{ marginBottom: 12, borderColor: '#ff4d4f' }}>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: '#d4380d' }}>⚡ 立即打待处理</div>
            {immediateItems.length === 0 ? (
              <div style={{ color: '#999', fontSize: 12 }}>暂无</div>
            ) : (
              <div>{immediateItems.map(renderItem)}</div>
            )}
          </div>
          <div style={{ flex: 1, borderLeft: '1px solid #f0f0f0', paddingLeft: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: '#722ed1' }}>📅 预约待处理</div>
            {scheduledItems.length === 0 ? (
              <div style={{ color: '#999', fontSize: 12 }}>暂无</div>
            ) : (
              <div>{scheduledItems.map(renderItem)}</div>
            )}
          </div>
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
              确认后即标记“已添加”；添加成功或失败，请在「跟进中」里选择，无需上传截图。
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};

export default UrgentOrdersPanel;
