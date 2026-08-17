import React, { useEffect, useState } from 'react';
import { Button, Card, List, Tag, message } from 'antd';
import { ordersApi } from '../api/orders';

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}分${sec}秒`;
}

const UrgentOrdersPanel: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [assigning, setAssigning] = useState<string | null>(null);

  const load = async () => {
    try {
      const { data } = await ordersApi.urgent();
      setItems(data.data || []);
    } catch {}
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const assign = async (orderId: string, companionId: string, name: string) => {
    setAssigning(orderId);
    try {
      await ordersApi.assign(orderId, companionId);
      message.success(`已指派给 ${name}`);
      load();
    } finally {
      setAssigning(null);
    }
  };

  if (items.length === 0) return null;

  return (
    <Card size="small" style={{ marginBottom: 12, borderColor: '#ff4d4f' }}>
      <List
        dataSource={items}
        renderItem={(item) => (
          <List.Item
            key={item.id}
            actions={[
              item.requireCsContact ? <Tag color="red">需添加客户联系方式</Tag> : null,
            ]}
          >
            <List.Item.Meta
              title={<span>🔥 {item.gameName} {item.gameMode} · ¥{item.amount} · 已等待 {fmt(item.waitingSeconds)}</span>}
              description={
                <>
                  <div>客户微信：{item.customerWechat || '未填写'}</div>
                  {item.availableCompanions?.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      {item.availableCompanions.map((c: any) => (
                        <Tag key={c.id} color={c.excellent ? 'gold' : 'default'}>
                          {c.name} · 剩余{c.remainingMinutes}分
                          <Button size="small" type="link" loading={assigning === item.id} onClick={() => assign(item.id, c.id, c.name)}>
                            指派
                          </Button>
                        </Tag>
                      ))}
                    </div>
                  )}
                </>
              }
            />
          </List.Item>
        )}
      />
    </Card>
  );
};

export default UrgentOrdersPanel;
