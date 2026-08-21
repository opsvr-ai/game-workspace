import React, { useEffect, useState } from 'react';
import { Button, Card, Space, message } from 'antd';
import { ordersApi } from '../api/orders';
import OrderTable from './OrderTable';

interface Props {
  onRedispatch?: (item: any) => void;
}

const CsFollowupPanel: React.FC<Props> = ({ onRedispatch }) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

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
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const markResult = async (item: any, addResult: 'passed' | 'failed') => {
    await ordersApi.markCsContact(item.id, 'added', undefined, { addResult });
    message.success(addResult === 'passed' ? '已标记添加成功' : '已标记添加失败');
    load();
  };

  const renderActions = (r: any) => (
    <Space size={4} wrap>
      {r.contactStatus !== 'added' && (
        <Button
          size="small"
          type="primary"
          style={{ background: '#16A34A', borderColor: '#16A34A' }}
          onClick={() => markResult(r, 'passed')}
        >
          标记成功
        </Button>
      )}
      {r.contactStatus !== 'not_accepted' && (
        <Button size="small" danger onClick={() => markResult(r, 'failed')}>
          标记失败
        </Button>
      )}
      <Button size="small" type="primary" onClick={() => onRedispatch?.(r)}>
        重新派单
      </Button>
    </Space>
  );

  if (items.length === 0) return null;

  return (
    <Card size="small" style={{ marginBottom: 12, borderColor: '#722ed1' }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>📥 客服跟进中（已添加客户）</div>
      <OrderTable dataSource={items} loading={loading} renderActions={renderActions} />
    </Card>
  );
};

export default CsFollowupPanel;
