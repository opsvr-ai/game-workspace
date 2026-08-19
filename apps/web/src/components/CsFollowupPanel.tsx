// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Button, Card, List, Modal, InputNumber, Input, Select, message, Tag, Space } from 'antd';
import { ordersApi } from '../api/orders';

interface Props {
  onRedispatch?: (item: any) => void;
}

const CsFollowupPanel: React.FC<Props> = ({ onRedispatch }) => {
  const [items, setItems] = useState<any[]>([]);
  const [flowOrder, setFlowOrder] = useState<any>(null);
  const [flows, setFlows] = useState<any[]>([]);
  const [form, setForm] = useState({ direction: 'IN', amount: 0, counterpart: '', note: '' });

  const load = async () => {
    try {
      const { data } = await ordersApi.csFollowup();
      setItems(data.data || []);
    } catch {}
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const openFlows = async (item: any) => {
    setFlowOrder(item);
    try {
      const { data } = await ordersApi.listMoneyFlows(item.id);
      setFlows(data.data || []);
    } catch {
      setFlows([]);
    }
  };

  const addFlow = async () => {
    if (!flowOrder) return;
    if (!form.amount || !form.counterpart) {
      message.warning('请填写金额和对方');
      return;
    }
    await ordersApi.addMoneyFlow(flowOrder.id, { ...form });
    message.success('已记录');
    setForm({ direction: 'IN', amount: 0, counterpart: '', note: '' });
    openFlows(flowOrder);
  };

  if (items.length === 0) return null;

  return (
    <>
      <Card size="small" style={{ marginBottom: 12, borderColor: '#722ed1' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>📥 客服跟进中（已添加客户）</div>
        <List
          size="small"
          dataSource={items}
          renderItem={(item: any) => (
            <List.Item
              key={item.id}
              actions={[
                <Button size="small" onClick={() => openFlows(item)}>资金流水</Button>,
                <Button size="small" type="primary" onClick={() => onRedispatch?.(item)}>重新派单</Button>,
              ]}
            >
              <List.Item.Meta
                title={<span>{item.gameName} · ¥{item.amount}</span>}
                description={
                  <div>
                    客户微信：{item.customer?.wechatId || item.customFields?.customerWechat || '-'}
                    {' · '}工作微信：{item.customFields?.csWorkWechatName || '-'}
                  </div>
                }
              />
            </List.Item>
          )}
        />
      </Card>

      <Modal
        title="资金流水"
        open={!!flowOrder}
        onCancel={() => setFlowOrder(null)}
        footer={null}
        width={560}
      >
        {flowOrder && (
          <div>
            {(() => {
              const cf = flowOrder.customFields || {};
              const isDouble = flowOrder.coCompanionId || cf.deltaCount === '双';
              const companions = isDouble ? 2 : 1;
              const bridgeReturn = cf.deltaMission === '绝密' ? 15 * (flowOrder.duration || 1) * companions : 0;
              const inTotal = flows.filter((f: any) => f.direction === 'IN').reduce((s: number, f: any) => s + (f.amount || 0), 0);
              const outTotal = flows.filter((f: any) => f.direction === 'OUT').reduce((s: number, f: any) => s + (f.amount || 0), 0);
              const profit = inTotal - outTotal - bridgeReturn;
              return (
                <div style={{ background: '#f6f8fb', borderRadius: 8, padding: '10px 12px', marginBottom: 10, fontSize: 13, lineHeight: 2 }}>
                  <div>类型：{cf.deltaMission || '-'} · {isDouble ? '双陪' : '单陪'} · {flowOrder.duration || '?'}h</div>
                  <div>桥接应返还：<b style={{ color: '#d4380d' }}>¥{bridgeReturn}</b>（仅桥接单适用）</div>
                  <div>转入合计：<b>¥{inTotal}</b> · 转出合计：<b>¥{outTotal}</b> · 利润：<b style={{ color: '#389e0d' }}>¥{profit}</b></div>
                </div>
              );
            })()}
            <List
              size="small"
              dataSource={flows}
              locale={{ emptyText: '暂无流水' }}
              renderItem={(f: any) => (
                <List.Item>
                  <Space>
                    <Tag color={f.direction === 'IN' ? 'green' : 'red'}>{f.direction === 'IN' ? '转入' : '转出'}</Tag>
                    <span>¥{f.amount}</span>
                    <span>{f.counterpart}</span>
                    {f.note && <span style={{ color: '#999' }}>{f.note}</span>}
                    <span style={{ color: '#999', fontSize: 12 }}>{new Date(f.createdAt).toLocaleString('zh-CN')}</span>
                  </Space>
                </List.Item>
              )}
            />
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <Select
                value={form.direction}
                onChange={(v) => setForm((p) => ({ ...p, direction: v }))}
                style={{ width: 90 }}
              >
                <Select.Option value="IN">转入</Select.Option>
                <Select.Option value="OUT">转出</Select.Option>
              </Select>
              <InputNumber
                value={form.amount}
                onChange={(v) => setForm((p) => ({ ...p, amount: v || 0 }))}
                prefix="¥"
                style={{ width: 110 }}
                placeholder="金额"
              />
              <Input
                value={form.counterpart}
                onChange={(e) => setForm((p) => ({ ...p, counterpart: e.target.value }))}
                placeholder="对方（客户/陪玩/桥接工作室）"
                style={{ width: 180 }}
              />
              <Input
                value={form.note}
                onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                placeholder="备注"
                style={{ width: 130 }}
              />
              <Button type="primary" size="small" onClick={addFlow}>记录</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};

export default CsFollowupPanel;
