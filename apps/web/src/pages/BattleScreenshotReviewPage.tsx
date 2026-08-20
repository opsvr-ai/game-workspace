// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Tabs, Typography, Space, Tag, Image, message, Empty, Spin, Input, Modal } from 'antd';
import { battleScreenshotsApi, type BattleScreenshot } from '../api/battleScreenshots';
import PageHeader from '../components/PageHeader';

const { Text } = Typography;

const STATUS: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'gold', label: '待审核' },
  APPROVED: { color: 'green', label: '已采纳' },
  REJECTED: { color: 'red', label: '已驳回' },
};

const BattleScreenshotReviewPage: React.FC = () => {
  const [items, setItems] = useState<BattleScreenshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('PENDING');
  const [rejecting, setRejecting] = useState<BattleScreenshot | null>(null);
  const [note, setNote] = useState('');

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await battleScreenshotsApi.list(status);
      setItems(data?.data ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const review = async (id: string, action: 'approve' | 'reject', noteText?: string) => {
    try {
      await battleScreenshotsApi.review(id, action, noteText);
      message.success(action === 'approve' ? '已采纳并加分' : '已驳回');
      setRejecting(null);
      setNote('');
      fetchItems();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '操作失败');
    }
  };

  return (
    <div>
      <PageHeader title="🖼 战绩图审核" subtitle="采纳后自动给该陪玩综合评分加分（作为小红书素材）" />
      <Card size="small">
        <Tabs
          activeKey={status}
          onChange={setStatus}
          items={[
            { key: 'PENDING', label: '待审核' },
            { key: 'APPROVED', label: '已采纳' },
            { key: 'REJECTED', label: '已驳回' },
            { key: 'ALL', label: '全部' },
          ]}
        />
        {loading ? (
          <Spin />
        ) : items.length === 0 ? (
          <Empty description="暂无记录" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {items.map((it) => (
              <div key={it.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  {(() => {
                    const av = it.companion?.user?.avatar;
                    const name = it.companion?.user?.displayName || it.companion?.user?.username || it.companionId;
                    const initial = (name || '?').slice(0, 1).toUpperCase();
                    return (
                      <>
                        <div
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            background: av ? `url(/uploads/avatars/${av}) center/cover` : '#2563EB',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {!av && <span style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>{initial}</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: '#1F2937' }}>
                            上传人：{name}
                          </div>
                          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
                            {it.customer ? `关联客户：${it.customer.customerCode || it.customer.wechatId} · ` : ''}
                            {new Date(it.createdAt).toLocaleString('zh-CN')}
                          </div>
                        </div>
                        <Tag color={STATUS[it.status]?.color} style={{ margin: 0 }}>{STATUS[it.status]?.label}</Tag>
                      </>
                    );
                  })()}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  <Image.PreviewGroup>
                    {it.images.map((url, i) => (
                      <Image
                        key={i}
                        src={url}
                        width={140}
                        height={140}
                        style={{ objectFit: 'cover', borderRadius: 6, cursor: 'zoom-in' }}
                      />
                    ))}
                  </Image.PreviewGroup>
                </div>
                {it.note && <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>备注：{it.note}</Text>}
                {it.status === 'PENDING' && (
                  <Space style={{ marginTop: 10 }}>
                    <Button type="primary" onClick={() => review(it.id, 'approve')}>采纳并加分</Button>
                    <Button danger onClick={() => setRejecting(it)}>驳回</Button>
                  </Space>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      <Modal
        title="驳回战绩图"
        open={!!rejecting}
        onOk={() => review(rejecting!.id, 'reject', note)}
        onCancel={() => { setRejecting(null); setNote(''); }}
        okText="确认驳回"
        cancelText="取消"
      >
        <Text>请填写驳回原因（可选）：</Text>
        <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：图片不清晰/非本人战绩" />
      </Modal>
    </div>
  );
};

export default BattleScreenshotReviewPage;
