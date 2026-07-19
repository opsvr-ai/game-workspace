// craftsman-ignore: TS001,TS002
import React from 'react';
import { Button, Tag, Typography, message } from 'antd';
import { useAuthStore } from '../stores/authStore';

const { Text, Title } = Typography;

interface DualCompanionModalProps {
  urgentGrabbed: any | null;
  dualReady: boolean;
  setUrgentGrabbed: (v: any | null) => void;
  setDualReady: (v: boolean) => void;
}

const DualCompanionModal: React.FC<DualCompanionModalProps> = ({
  urgentGrabbed,
  dualReady,
  setUrgentGrabbed,
  setDualReady,
}) => {
  const user = useAuthStore((s) => s.user);

  if (!urgentGrabbed || urgentGrabbed._creatorRole !== 'COMPANION') return null;

  return (
    <>
      {/* Dual-companion: grabber view (zhangsan) */}
      {user?.id !== urgentGrabbed.csUserId && (
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
          <div style={{ background: '#FFF', borderRadius: 16, padding: 28, maxWidth: 460, width: '90%' }}>
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
            <div style={{ marginTop: 16, background: '#f6ffed', borderRadius: 8, padding: 12 }}>
              <Text strong>🤝 你将与 {urgentGrabbed._createdBy} 一起服务老板</Text>
              <div style={{ marginTop: 8 }}>
                <Button
                  type="primary"
                  size="large"
                  block
                  onClick={async () => {
                    try {
                      const { ordersApi } = await import('../api/orders');
                      await ordersApi.markReady(urgentGrabbed.id);
                      message.success('我已准备好');
                      setDualReady(true);
                    } catch (e: any) {
                      message.error(e?.response?.data?.message);
                    }
                  }}
                >
                  我已准备好
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dual-companion: creator view (peiwana) — shows when partner is ready */}
      {user?.id === urgentGrabbed.csUserId && (
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
          <div style={{ background: '#FFF', borderRadius: 16, padding: 28, maxWidth: 480, width: '90%' }}>
            <Title level={4}>🤝 本单将由抢单陪玩跟你一起服务老板</Title>
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
            {dualReady ? (
              <div style={{ marginTop: 16 }}>
                <Tag color="green">✅ 合作陪玩已准备就绪</Tag>
                <div style={{ marginTop: 8 }}>
                  <Button
                    type="primary"
                    size="large"
                    block
                    style={{ background: '#52c41a' }}
                    onClick={async () => {
                      try {
                        const { ordersApi } = await import('../api/orders');
                        await ordersApi.confirm(urgentGrabbed.id);
                        message.success('已开始服务');
                        setUrgentGrabbed(null);
                        setDualReady(false);
                      } catch (e: any) {
                        message.error(e?.response?.data?.message);
                      }
                    }}
                  >
                    开始服务
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <Text type="secondary">⏳ 等待合作陪玩准备就绪...</Text>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default DualCompanionModal;
