import React, { useEffect, useState } from 'react';
import { Button, Card, Space, Tag, message } from 'antd';
import { ordersApi } from '../api/orders';
import OrderRow from './OrderRow';

interface Props {
  refreshSignal?: number;
  onDispatch?: (item: any) => void;
}

const CsFollowupPanel: React.FC<Props> = ({ refreshSignal, onDispatch }) => {
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

  useEffect(() => {
    if (refreshSignal) load();
  }, [refreshSignal]);

  const markResult = async (item: any, addResult: 'passed' | 'failed') => {
    await ordersApi.markCsContact(item.id, 'added', undefined, { addResult });
    message.success(addResult === 'passed' ? '已标记添加成功' : '已标记添加失败');
    load();
  };

  const renderActions = (r: any) => (
    <Space size={4} wrap>
      {r.contactStatus === 'added' ? (
        <>
          <Tag color="green">已添加</Tag>
          <Button size="small" type="primary" onClick={() => onDispatch?.(r)}>
            重新派单
          </Button>
        </>
      ) : r.contactStatus === 'not_accepted' ? (
        <Button size="small" type="primary" style={{ background: '#16A34A', borderColor: '#16A34A' }} onClick={() => markResult(r, 'passed')}>
          客户已同意
        </Button>
      ) : (
        <>
          <Button size="small" type="primary" style={{ background: '#16A34A', borderColor: '#16A34A' }} onClick={() => markResult(r, 'passed')}>
            ✅ 添加成功
          </Button>
          <Button size="small" danger onClick={() => markResult(r, 'failed')}>
            ❌ 添加失败
          </Button>
        </>
      )}
    </Space>
  );

  if (items.length === 0) return null;

  return (
    <Card size="small" style={{ marginBottom: 12, borderColor: '#722ed1' }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>📥 管理端直添客户跟进列表</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((r, idx) => (
          <OrderRow key={r.id} order={r} index={idx} renderActions={renderActions} />
        ))}
      </div>
    </Card>
  );
};

export default CsFollowupPanel;
