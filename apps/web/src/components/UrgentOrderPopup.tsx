// craftsman-ignore: TS001,TS002
import React from 'react';
import { Button, Typography, message } from 'antd';

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
            ⚡ 新订单！{urgentOrder._createdBy || '系统'} 发布
          </Text>
          <div style={{ marginTop: 10, lineHeight: 1.8 }}>
            <div>
              🎮 {urgentOrder.gameName} ·{' '}
              <Text strong style={{ color: '#FF4757' }}>
                ¥{Number(urgentOrder.amount).toFixed(0)}
              </Text>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
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
                } catch (e: any) {
                  message.error(e?.response?.data?.message || '已被其他陪玩抢先');
                  setUrgentOrder(null);
                }
              }}
            >
              同意
            </Button>
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
                onClick={async () => {
                  try {
                    const { ordersApi } = await import('../api/orders');
                    await ordersApi.confirm(urgentGrabbed.id);
                    message.success('已开始服务');
                    setUrgentGrabbed(null);
                  } catch (e: any) {
                    message.error(e?.response?.data?.message);
                  }
                }}
              >
                开始服务
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default UrgentOrderPopup;
