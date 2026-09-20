// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Typography, message } from 'antd';
import { configApi } from '../api/config';

const { Text, Title } = Typography;

interface UrgentOrderPopupProps {
  urgentOrder: any | null;
  urgentGrabbed: any | null;
  setUrgentOrder: (v: any | null) => void;
  setUrgentGrabbed: (v: any | null) => void;
}

const UrgentOrderPopup: React.FC<UrgentOrderPopupProps> = ({
  urgentOrder,
  urgentGrabbed,
  setUrgentOrder,
  setUrgentGrabbed,
}) => {
  const navigate = useNavigate();

  // 弹窗停留时长可在后台配置（pool.popup_seconds，默认 20 秒）。
  // 错过弹窗也不吃亏：广播单在订单池里对全店立即可见，不会等段位延迟。
  const [popupSeconds, setPopupSeconds] = useState(20);
  useEffect(() => {
    configApi
      .get(['pool.popup_seconds'])
      .then(({ data }: any) => {
        const v = Number(data?.data?.['pool.popup_seconds']);
        if (Number.isFinite(v) && v > 0) setPopupSeconds(v);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!urgentOrder) return;
    const t = setTimeout(() => setUrgentOrder(null), popupSeconds * 1000);
    return () => clearTimeout(t);
  }, [urgentOrder, setUrgentOrder, popupSeconds]);

  return (
    <>
      {/* Urgent order — idle companion notification */}
      {urgentOrder && !urgentGrabbed && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 9999,
            background: '#FFF',
            borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            padding: 20,
            minWidth: 320,
            borderLeft: '4px solid #FF4757',
          }}
        >
          <Text strong style={{ fontSize: 15 }}>
            {urgentOrder._direct
              ? '🎯 客服指定给你接单'
              : urgentOrder._bridged
                ? `🌉 桥接工作室发单！${urgentOrder._createdBy || '系统'} 发布`
                : `⚡ 新订单！${urgentOrder._createdBy || '系统'} 发布`}
          </Text>
          <div style={{ marginTop: 10, lineHeight: 1.8 }}>
            <div>
              🎮 {urgentOrder.gameName} ·{' '}
              <Text strong style={{ color: '#FF4757' }}>
                ¥{Number(urgentOrder.amount).toFixed(0)}
              </Text>
              {urgentOrder.duration ? ` · ${urgentOrder.duration}h` : ''}
            </div>
            <div style={{ fontSize: 13, color: '#64748B' }}>
              {urgentOrder.type === 'NEW' ? '首单' : urgentOrder.type === 'RENEW' ? '续单' : urgentOrder.type === 'REPURCHASE' ? '复购' : '订单'}
              {urgentOrder.customFields?.deltaMission ? ` · ${urgentOrder.customFields.deltaMission}` : ''}
              {urgentOrder.customFields?.urgency === 'later' ? ' · 预约（不占名额）' : ' · 立即打（占 1 个名额）'}
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            {urgentOrder._direct ? (
              <Button
                type="primary"
                size="large"
                block
                onClick={() => {
                  setUrgentOrder(null);
                  navigate('/companion/orders');
                }}
              >
                查看订单
              </Button>
            ) : (
              <Button
                type="primary"
                size="large"
                block
                onClick={async () => {
                  try {
                    const { ordersApi } = await import('../api/orders');
                    const r = await ordersApi.quickGrab(urgentOrder.id);
                    setUrgentGrabbed(r.data.data || urgentOrder);
                    setUrgentOrder(null);
                    // 抢到后直接进入订单管理，方便接着加客户微信、打首单。
                    // 成功卡片仍在上层浮着（里面有客户微信和房间码），
                    // 关掉它时人已经站在订单管理页了。
                    navigate('/companion/orders');
                  } catch (e: any) {
                    message.error(e?.response?.data?.message || '已被其他陪玩抢先');
                    setUrgentOrder(null);
                  }
                }}
              >
                同意
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Urgent grab success — solo (non-companion creator) */}
      {urgentGrabbed && urgentGrabbed._creatorRole !== 'COMPANION' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ background: '#FFF', borderRadius: 16, padding: 28, maxWidth: 440, width: '90%' }}>
            <Title level={4}>🎉 恭喜抢单成功</Title>
            <div style={{ lineHeight: 2.2, marginTop: 12 }}>
              <div>
                🎮 {urgentGrabbed.gameName} · ¥{Number(urgentGrabbed.amount).toFixed(0)}
              </div>
              {urgentGrabbed.customFields?.customerWechat && (
                <div>
                  💬 微信：<Text copyable>{urgentGrabbed.customFields.customerWechat}</Text>
                </div>
              )}
              {urgentGrabbed.customFields?.customerRoomCode && (
                <div>
                  🏠 房间码：<Text copyable>{urgentGrabbed.customFields.customerRoomCode}</Text>
                </div>
              )}
            </div>
            <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
              <Button size="large" onClick={() => setUrgentGrabbed(null)} style={{ flex: 1 }}>
                关闭
              </Button>
              <Button
                type="primary"
                size="large"
                style={{ flex: 1, background: '#52c41a' }}
                onClick={() => {
                  // 急单抢到后不能在这里直接 confirm：confirm 只会把订单改成“服务中”，
                  // 但不会创建计时会话，反而让后面的「首单」误判成“正在服务中”。
                  // 改为跳转到客户管理，让陪玩在客户管理中正常点「首单」开始服务。
                  setUrgentGrabbed(null);
                  message.info('请在「客户管理」中找到该客户，点「首单」开始服务');
                  navigate('/companion/customers');
                }}
              >
                去客户管理接单
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default UrgentOrderPopup;
