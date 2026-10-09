// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Tabs, Typography, Space, Tag, Input, Modal, Image } from 'antd';
import { message } from '../utils/feedback';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import { DownloadOutlined } from '@ant-design/icons';
import { battleScreenshotsApi, type BattleScreenshot } from '../api/battleScreenshots';
import PageHeader from '../components/PageHeader';
import { useAuthStore } from '../stores/authStore';
import { UserRole } from '@chunlv/shared';
import { BRAND, BORDER, TEXT } from '../styles/tokens';

const { Text } = Typography;

const STATUS: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'gold', label: '待审核' },
  APPROVED: { color: 'green', label: '已采纳' },
  REJECTED: { color: 'red', label: '已驳回' },
};

// 图片在服务器上丢了 / 加载失败时的占位，别留一块空白让人以为页面坏了。
const BROKEN_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="92" height="92">' +
      `<rect width="100%" height="100%" fill="${BORDER.secondary}"/>` +
      `<text x="50%" y="50%" fill="${TEXT.tertiary}" font-size="12" text-anchor="middle" dominant-baseline="middle">图片打不开</text>` +
      '</svg>',
  );

const BattleScreenshotReviewPage: React.FC = () => {
  const role = useAuthStore((s) => s.user?.role);
  // 老板 2026-10-01：「客服端怎么没有查看战绩图呢？只有店长有？」——客服看得到这一页。
  // 老板 2026-10-09：「客服端怎么不能采纳陪玩上传的战绩图？」——采纳 / 驳回（会加综合分）
  // 现在客服和店长 / 老板一样能点；上传时那条实时提醒本来就发给全店客服 + 店长 + 老板，
  // 只让店长点等于提醒了也白提醒。
  const canReview = role === UserRole.ADMIN || role === UserRole.OWNER || role === UserRole.CS;
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

  const downloadImages = async (it: BattleScreenshot) => {
    const fallbackName = `战绩图_${it.companion?.user?.username || it.id}.zip`;
    try {
      const token = sessionStorage.getItem('accessToken');
      const res = await fetch(`/api/battle-screenshots/${it.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        // 服务端会给出具体原因（记录不存在 / 图片在服务器上丢了要重新上传 / 打包失败），
        // 以前一律吞成「下载失败」，管理端根本不知道该怎么办。
        let reason = '下载失败';
        try {
          const data = await res.json();
          if (data?.message) reason = String(data.message);
        } catch {}
        message.error(reason);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const cd = res.headers.get('Content-Disposition') || '';
      // 中文文件名走 filename*=UTF-8''（服务端另给一份 ASCII 兜底），优先取前者，
      // 否则存下来会变成「??_2026-09-22.zip」这种名字。
      const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
      const plain = cd.match(/filename=(?!\*)"?([^";]+)"?/i);
      let filename = fallbackName;
      if (star) {
        try {
          filename = decodeURIComponent(star[1]);
        } catch {
          filename = plain?.[1] || fallbackName;
        }
      } else if (plain) {
        filename = plain[1];
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      message.error('下载失败');
    }
  };

  return (
    <div>
      <PageHeader
        title={canReview ? '战绩图审核' : '战绩图查看'}
        subtitle={
          canReview
            ? '点缩略图放大看原图；觉得可以就直接点「采纳并加分」（采纳后自动给该陪玩综合评分加分，作为小红书素材）'
            : '点缩略图放大看原图'
        }
      />
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
          <LoadingState minHeight={200} />
        ) : items.length === 0 ? (
          <EmptyState description="暂无记录" />
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
                            background: av ? `url(/uploads/avatars/${av}) center/cover` : BRAND.primary,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {!av && <span style={{ color: TEXT.inverse, fontSize: 15, fontWeight: 700 }}>{initial}</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: '#1F2937' }}>
                            上传人：{name}
                          </div>
                          <div style={{ fontSize: 12, color: TEXT.tertiary, marginTop: 2 }}>
                            {it.customer ? `关联客户：${it.customer.customerCode || it.customer.wechatId} · ` : ''}
                            {new Date(it.createdAt).toLocaleString('zh-CN')}
                          </div>
                        </div>
                        <Tag color={STATUS[it.status]?.color} style={{ margin: 0 }}>{STATUS[it.status]?.label}</Tag>
                      </>
                    );
                  })()}
                </div>
                {/* 缩略图直接铺在记录里（老板 2026-10-09：「点查看文件怎么疯狂弹窗？能不能直接改成
                    缩略图的形式？方便查看，觉得可以就直接点采纳」）。以前这一页不显示图，
                    「看到战绩图」只有「下载图片包 → 解压 → 开文件夹」这一条路，一组一弹、越点越多。
                    现在点任意一张用 antd 大图预览放大（同一组里可左右切换），看清楚了下面就能直接采纳。 */}
                {it.images.length > 0 ? (
                  <Image.PreviewGroup>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {it.images.map((url, i) => (
                        <Image
                          key={`${it.id}-${i}`}
                          src={url}
                          width={92}
                          height={92}
                          style={{ objectFit: 'cover', borderRadius: 6, border: `1px solid ${BORDER.secondary}` }}
                          preview={{ mask: <span style={{ fontSize: 12 }}>点开放大</span> }}
                          fallback={BROKEN_IMAGE}
                        />
                      ))}
                    </div>
                  </Image.PreviewGroup>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>这组没有图片</Text>
                )}
                {it.note && <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>备注：{it.note}</Text>}
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
                  {it.status === 'PENDING' && canReview && (
                    <Space>
                      <Button type="primary" onClick={() => review(it.id, 'approve')}>采纳并加分</Button>
                      <Button danger onClick={() => setRejecting(it)}>驳回</Button>
                    </Space>
                  )}
                  {/* 想存原图（比如做小红书素材）再走这里；日常审核看缩略图就够了，不用再弹文件夹。 */}
                  <Button
                    size="small"
                    type="link"
                    icon={<DownloadOutlined />}
                    onClick={() => downloadImages(it)}
                  >
                    下载原图包（{it.images.length} 张）
                  </Button>
                </div>
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
