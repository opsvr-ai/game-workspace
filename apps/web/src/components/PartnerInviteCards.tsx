// craftsman-ignore: TS001
import React from 'react';
import { Button, Card, Space, Typography} from 'antd';
import { message } from '../utils/feedback';
import { ordersApi } from '../api/orders';
import { usePartnerInviteStore } from '../stores/partnerInviteStore';

import { SEMANTIC } from '../styles/tokens';
const { Text } = Typography;

/** 倒计时（只剩几秒就变灰，免得看着像还能点）。 */
const Countdown: React.FC<{ expiresAt: number }> = ({ expiresAt }) => {
  const leftOf = () => Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  const [left, setLeft] = React.useState(leftOf);
  React.useEffect(() => {
    setLeft(leftOf());
    const t = setInterval(() => setLeft(leftOf()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);
  return (
    <Text style={{ color: left > 0 ? '#f5222d' : '#999', fontWeight: 600 }}>⏳ {left} 秒后自动取消</Text>
  );
};

/**
 * 「待我确认的搭档邀请」（老板 2026-10-03）：
 * 放在陪玩端「订单管理」最上面 —— 右下角横幅点一下就是跳到这儿来同意 / 拒绝。
 * 和「别人转给我的单」一个路子：都在订单管理里点，不再弹软件内的模态框。
 */
export const PartnerInviteCards: React.FC = () => {
  const invites = usePartnerInviteStore((s) => s.invites);
  const remove = usePartnerInviteStore((s) => s.remove);
  const prune = usePartnerInviteStore((s) => s.prune);
  const [busy, setBusy] = React.useState('');

  React.useEffect(() => {
    const t = setInterval(prune, 3000);
    return () => clearInterval(t);
  }, [prune]);

  if (!invites.length) return null;

  const accept = async (p: any) => {
    setBusy(p.sessionId);
    try {
      await ordersApi.acceptPartnerInvite(p.sessionId);
      message.success('已接受搭档邀请，开始计时');
      remove(p.sessionId);
      (window as any).electronAPI?.sessionWatch?.(p.sessionId);
      window.dispatchEvent(new Event('chunlv:service-started'));
      window.dispatchEvent(new Event('chunlv:order-pool-updated'));
    } catch (e: any) {
      message.error(e?.response?.data?.message || '接受失败');
    } finally {
      setBusy('');
    }
  };

  const reject = async (p: any) => {
    setBusy(p.sessionId);
    try {
      await ordersApi.rejectPartnerInvite(p.sessionId);
    } catch {
      /* 服务端可能已经超时取消了，前端照样把它从列表里去掉 */
    } finally {
      remove(p.sessionId);
      setBusy('');
    }
  };

  return (
    <Card
      size="small"
      style={{ marginBottom: 12, borderColor: SEMANTIC.warning, background: '#FFFBEB' }}
      title={<span style={{ color: SEMANTIC.warningDeep }}>🤝 待我确认的搭档邀请（{invites.length}）</span>}
    >
      {invites.map((p: any) => (
        <div
          key={p.sessionId}
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            padding: '6px 0',
          }}
        >
          <div>
            <Text strong>{p.inviterName || '有陪玩'} 邀请你搭档</Text>
            <span style={{ marginLeft: 8, fontSize: 13, color: '#666' }}>
              {p.gameName || '订单'} · ¥{Number(p.amount || 0).toFixed(1)} · {p.duration || 1}h
            </span>
            <span style={{ marginLeft: 10 }}>
              <Countdown expiresAt={p.expiresAt} />
            </span>
          </div>
          <Space>
            <Button
              type="primary"
              size="small"
              loading={busy === p.sessionId}
              onClick={() => accept(p)}
            >
              同意
            </Button>
            <Button size="small" loading={busy === p.sessionId} onClick={() => reject(p)}>
              拒绝
            </Button>
          </Space>
        </div>
      ))}
    </Card>
  );
};

export default PartnerInviteCards;
