import React, { useEffect, useState } from 'react';
import { Button, Card, Table, Tag, message } from 'antd';
import { ordersApi } from '../api/orders';

const CsConvertedPanel: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await ordersApi.csConverted();
      const raw = data.data || [];
      const rank: Record<string, number> = { 添加失败: 0, 待添加: 1, 已加微信: 2 };
      setItems([...raw].sort((a, b) => (rank[a.addStatus] ?? 9) - (rank[b.addStatus] ?? 9)));
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const destColor: Record<string, string> = {
    线下工作室: 'blue',
    桥接工作室: 'orange',
    线上俱乐部: 'purple',
  };

  const columns = [
    {
      title: '客户',
      key: 'customer',
      render: (_: any, r: any) => (
        <div>
          <div>{r.customerNickname || r.customerWechat || '-'}</div>
          {r.customerWechat && <div style={{ color: '#999', fontSize: 12 }}>微信：{r.customerWechat}</div>}
          {r.customerSource && (
            <Tag color="cyan" style={{ marginTop: 2, fontSize: 11 }}>
              📡{r.customerSource}
            </Tag>
          )}
        </div>
      ),
    },
    { title: '游戏/金额', key: 'order', render: (_: any, r: any) => `${r.gameName} · ¥${Number(r.amount).toFixed(0)}` },
    {
      title: '去向',
      key: 'destination',
      render: (_: any, r: any) => (
        <Tag color={destColor[r.destination] || 'default'}>{r.destination}</Tag>
      ),
    },
    { title: '抢单陪玩', dataIndex: 'companionName', key: 'companionName' },
    { title: '陪玩工作微信', dataIndex: 'companionWechat', key: 'companionWechat', render: (v: string) => v || '-' },
    {
      title: '加微信',
      key: 'addStatus',
      render: (_: any, r: any) => (
        r.addStatus === '添加失败' ? (
          <Tag color="red">❌ 添加失败 · 继续追踪</Tag>
        ) : (
          <Tag color={r.addStatus === '已加微信' ? 'green' : 'gold'}>{r.addStatus}</Tag>
        )
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
      <Table
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={items}
        loading={loading}
        pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 单` }}
        locale={{ emptyText: '暂无重新派出的客户' }}
      />
    </Card>
  );
};

export default CsConvertedPanel;
