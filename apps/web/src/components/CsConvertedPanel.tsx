import React, { useEffect, useState } from 'react';
import { Button, Card, Tag, message } from 'antd';
import { ordersApi } from '../api/orders';
import { useChatStore } from '../stores/chatStore';
import OrderTable from './OrderTable';

const companionName = (r: any) =>
  r.companion?.user?.displayName || r.companion?.user?.username || '';

const CsConvertedPanel: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await ordersApi.csConverted();
      const raw = data.data || [];
      const rank: Record<string, number> = { 添加失败: 0, 待结果: 1, 添加成功: 2 };
      setItems([...raw].sort((a, b) => (rank[a.addStatus] ?? 9) - (rank[b.addStatus] ?? 9)));
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

  const contactCompanion = async (r: any) => {
    if (!r.companionUserId) return;
    const participant = {
      userId: r.companionUserId,
      username: companionName(r),
      role: 'COMPANION',
    };
    const orderInfo = `${r.gameName} · 客户：${r.customer?.wechatId || r.customFields?.customerWechat || '-'}`;
    const convId = await useChatStore.getState().openConversation(r.companionUserId, participant as any, orderInfo);
    window.dispatchEvent(
      new CustomEvent('open-chat-modal', {
        detail: { conversationId: convId, participant, orderInfo },
      }),
    );
  };

  const destColor: Record<string, string> = {
    线下工作室: 'blue',
    桥接工作室: 'orange',
    线上俱乐部: 'purple',
  };

  const extraColumns = [
    {
      title: '去向',
      key: 'destination',
      width: 100,
      align: 'center' as const,
      render: (_: any, r: any) => (
        <Tag color={destColor[r.destination] || 'default'}>{r.destination}</Tag>
      ),
    },
    {
      title: '加微信',
      key: 'addStatus',
      width: 100,
      align: 'center' as const,
      render: (_: any, r: any) => (
        <Tag color={r.addStatus === '添加成功' ? 'green' : r.addStatus === '添加失败' ? 'red' : 'gold'}>
          {r.addStatus}
        </Tag>
      ),
    },
  ];

  return (
    <Card size="small" style={{ marginBottom: 12, borderColor: '#13c2c2' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>🎯 派单去向（客服养好后重新派出的客户）</div>
        <Button size="small" onClick={load} loading={loading}>
          刷新
        </Button>
      </div>
      <OrderTable
        dataSource={items}
        loading={loading}
        extraColumns={extraColumns}
        renderActions={(r: any) =>
          r.addStatus !== '添加成功' ? (
            <Button size="small" type="primary" onClick={() => contactCompanion(r)}>
              询问陪玩
            </Button>
          ) : null
        }
      />
    </Card>
  );
};

export default CsConvertedPanel;
