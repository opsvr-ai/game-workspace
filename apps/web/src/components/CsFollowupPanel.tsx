import React, { useEffect, useState } from 'react';
import { Button, Card, Space, Tag, message } from 'antd';
import { ordersApi } from '../api/orders';
import { useChatStore } from '../stores/chatStore';
import OrderRow from './OrderRow';

const CsFollowupPanel: React.FC = () => {
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

  const chatWithCs = async (r: any) => {
    const csUser = r.csUser;
    if (!csUser?.id) return;
    const participant = {
      userId: csUser.id,
      username: csUser.displayName || csUser.username || '客服',
      displayName: csUser.displayName,
      avatar: csUser.avatar,
      role: csUser.role || 'CS',
    };
    const orderInfo = `${r.gameName} · ¥${Number(r.amount).toFixed(0)}`;
    const convId = await useChatStore.getState().openConversation(csUser.id, participant as any, orderInfo);
    window.dispatchEvent(
      new CustomEvent('open-chat-modal', {
        detail: { conversationId: convId, participant, orderInfo },
      }),
    );
  };

  const renderActions = (r: any) => (
    <Space size={4} wrap>
      {r.csUser?.id && (
        <Button size="small" onClick={() => chatWithCs(r)}>
          沟通
        </Button>
      )}
      {r.contactStatus === 'added' ? (
        <Tag color="green">已添加</Tag>
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
