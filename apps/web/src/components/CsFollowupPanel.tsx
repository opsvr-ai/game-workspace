import React, { useEffect, useState } from 'react';
import { Button, Card, List, message, Tag } from 'antd';
import { ordersApi } from '../api/orders';

interface Props {
  onRedispatch?: (item: any) => void;
}

const CsFollowupPanel: React.FC<Props> = ({ onRedispatch }) => {
  const [items, setItems] = useState<any[]>([]);

  const load = async () => {
    try {
      const { data } = await ordersApi.csFollowup();
      setItems(data.data || []);
    } catch {}
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const markResult = async (item: any, addResult: 'passed' | 'failed') => {
    await ordersApi.markCsContact(item.id, 'added', undefined, { addResult });
    message.success(addResult === 'passed' ? '已标记添加成功' : '已标记添加失败');
    load();
  };

  if (items.length === 0) return null;

  return (
    <Card size="small" style={{ marginBottom: 12, borderColor: '#722ed1' }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>📥 客服跟进中（已添加客户）</div>
      <List
        size="small"
        dataSource={items}
        renderItem={(item: any) => (
          <List.Item
            key={item.id}
            actions={[
              ...(item.contactStatus !== 'added'
                ? [
                    <Button size="small" type="primary" onClick={() => markResult(item, 'passed')}>
                      标记成功
                    </Button>,
                  ]
                : []),
              ...(item.contactStatus !== 'not_accepted'
                ? [
                    <Button size="small" danger onClick={() => markResult(item, 'failed')}>
                      标记失败
                    </Button>,
                  ]
                : []),
              <Button size="small" type="primary" onClick={() => onRedispatch?.(item)}>
                重新派单
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={<span>{item.gameName} · ¥{item.amount}</span>}
              description={
                <div>
                  客户微信：{item.customer?.wechatId || item.customFields?.customerWechat || '-'}
                  {' · '}工作微信：{item.customFields?.csWorkWechatName || '-'}
                  <br />
                  添加结果：
                  {item.contactStatus === 'added' ? (
                    <Tag color="green">添加成功</Tag>
                  ) : item.contactStatus === 'not_accepted' ? (
                    <Tag color="red">添加失败</Tag>
                  ) : (
                    <Tag color="gold">待结果</Tag>
                  )}
                </div>
              }
            />
          </List.Item>
        )}
      />
    </Card>
  );
};

export default CsFollowupPanel;
