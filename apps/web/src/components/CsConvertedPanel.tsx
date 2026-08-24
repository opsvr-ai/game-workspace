import React, { useEffect, useState } from 'react';
import { Button, Card, Space, Tag, message } from 'antd';
import { ordersApi } from '../api/orders';
import { extractErrorMessage } from '../utils/error-handler';
import OrderRow from './OrderRow';

interface Props {
  refreshSignal?: number;
}

const CsConvertedPanel: React.FC<Props> = ({ refreshSignal }) => {
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

  useEffect(() => {
    if (refreshSignal) load();
  }, [refreshSignal]);

  const markContact = async (r: any, status: 'added' | 'not_accepted') => {
    try {
      await ordersApi.updateContact(r.id, {
        contactStatus: status,
        ...(status === 'not_accepted' ? { notes: '客户一直没同意' } : {}),
      });
      message.success(status === 'added' ? '已标记添加成功' : '已标记添加失败');
      load();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '操作失败'));
    }
  };

  const renderActions = (r: any) => (
    <Space size={4} wrap>
      {r.contactStatus === 'added' ? (
        <Tag color="green">已添加</Tag>
      ) : r.contactStatus === 'not_accepted' ? (
        <Button
          size="small"
          type="primary"
          style={{ background: '#16A34A', borderColor: '#16A34A' }}
          onClick={() => markContact(r, 'added')}
        >
          客户已同意
        </Button>
      ) : r.status === 'GRABBED' || r.status === 'CONFIRMED' ? (
        <>
          <Button
            size="small"
            type="primary"
            style={{ background: '#16A34A', borderColor: '#16A34A' }}
            onClick={() => markContact(r, 'added')}
          >
            ✅ 添加成功
          </Button>
          <Button size="small" danger onClick={() => markContact(r, 'not_accepted')}>
            ❌ 添加失败
          </Button>
        </>
      ) : null}
    </Space>
  );

  return (
    <Card size="small" style={{ marginBottom: 12, borderColor: '#13c2c2' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>🎯 管理端直添客户流转明细</div>
        <Button size="small" onClick={load} loading={loading}>
          刷新
        </Button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((r, idx) => (
          <OrderRow key={r.id} order={r} index={idx} renderActions={renderActions} />
        ))}
      </div>
    </Card>
  );
};

export default CsConvertedPanel;
