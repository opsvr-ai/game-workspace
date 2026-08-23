import React, { useEffect, useState } from 'react';
import { Button, Card, message } from 'antd';
import { ordersApi } from '../api/orders';
import OrderRow from './OrderRow';

const CsConvertedPanel: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await ordersApi.csConverted();
      setItems(data.data || []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <Card size="small" style={{ marginBottom: 12, borderColor: '#13c2c2' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>🎯 管理端直添客户流转明细</div>
        <Button size="small" onClick={load} loading={loading}>刷新</Button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((r) => (
          <OrderRow key={r.id} order={r} />
        ))}
      </div>
    </Card>
  );
};

export default CsConvertedPanel;
