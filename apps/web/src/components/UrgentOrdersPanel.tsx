import React, { useEffect, useState } from 'react';
import { Button, Card, List, Tag, Upload, message } from 'antd';
import { ordersApi } from '../api/orders';
import http from '../api/client';

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}分${sec}秒`;
}

const UrgentOrdersPanel: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [redispatching, setRedispatching] = useState<string | null>(null);
  const [evidences, setEvidences] = useState<Record<string, string>>({});

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

  const markContact = async (orderId: string) => {
    const evidenceUrl = evidences[orderId];
    await ordersApi.markCsContact(orderId, 'added', evidenceUrl);
    message.success(evidenceUrl ? '已标记客服已添加客户' : '已标记（未上传凭证，老板后台可查）');
    load();
  };

  const redispatch = async (orderId: string) => {
    setRedispatching(orderId);
    try {
      await ordersApi.redispatch(orderId);
      message.success('已重新派到抢单池');
      load();
    } finally {
      setRedispatching(null);
    }
  };

  const uploadEvidence = async (orderId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const { data } = await http.post('/upload/screenshot', fd);
    setEvidences((prev) => ({ ...prev, [orderId]: data.data?.url || data.url || '' }));
    message.success('凭证已上传');
    return false;
  };

  if (items.length === 0) return null;

  const immediateItems = items.filter((i) => !i.isScheduled);
  const scheduledItems = items.filter((i) => i.isScheduled);

  const renderItem = (item: any) => (
    <List.Item
      key={item.id}
      actions={[
        item.poolExpired ? <Tag color="red">待处理</Tag> : item.requireCsContact ? <Tag color="red">需添加客户联系方式</Tag> : null,
      ]}
    >
      <List.Item.Meta
        title={<span>{item.poolExpired ? '⏳ ' : '🔥 '}{item.gameName} {item.gameMode} · ¥{item.amount} · 已等待 {fmt(item.waitingSeconds)}</span>}
        description={
          <>
            <div>客户微信：{item.customerWechat || '未填写'}</div>
            <div>
              客服联系状态：
              {item.csContactStatus === 'added' ? (
                item.csContactEvidenceUrl ? (
                  <Tag color="green">已添加</Tag>
                ) : (
                  <Tag color="orange">未传凭证</Tag>
                )
              ) : (
                <>
                  <Upload showUploadList={false} beforeUpload={(file) => uploadEvidence(item.id, file)}>
                    <Button size="small">上传凭证</Button>
                  </Upload>
                  <Button size="small" type="link" onClick={() => markContact(item.id)}>标记已添加</Button>
                </>
              )}
            </div>
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
            {item.poolExpired && (
              <div style={{ marginTop: 6 }}>
                <Button size="small" type="primary" loading={redispatching === item.id} onClick={() => redispatch(item.id)}>
                  一键重新派到抢单池
                </Button>
              </div>
            )}
          </>
        }
      />
    </List.Item>
  );

  return (
    <Card size="small" style={{ marginBottom: 12, borderColor: '#ff4d4f' }}>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: '#d4380d' }}>⚡ 立即打待处理</div>
          {immediateItems.length === 0 ? (
            <div style={{ color: '#999', fontSize: 12 }}>暂无</div>
          ) : (
            <List size="small" dataSource={immediateItems} renderItem={renderItem} />
          )}
        </div>
        <div style={{ flex: 1, borderLeft: '1px solid #f0f0f0', paddingLeft: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: '#722ed1' }}>📅 预约待处理</div>
          {scheduledItems.length === 0 ? (
            <div style={{ color: '#999', fontSize: 12 }}>暂无</div>
          ) : (
            <List size="small" dataSource={scheduledItems} renderItem={renderItem} />
          )}
        </div>
      </div>
    </Card>
  );
};

export default UrgentOrdersPanel;
