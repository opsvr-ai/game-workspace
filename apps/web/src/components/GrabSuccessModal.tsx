// craftsman-ignore: TS001,TS002
import React from 'react';
import { Modal, Tag, Typography } from 'antd';
import { BRAND, SEMANTIC } from '../styles/tokens';
import { orderTypeConfig } from '../constants/orders';

interface Props {
  /** 抢到的单（null = 不显示）；来自 orderStore.grabbedOrder */
  order: any;
  onClose: () => void;
}

/**
 * 「抢单成功」全局弹窗 —— 不跟着页面走（切页面也还在），所以挂在最外层。
 * 2026-10-07 从 `layouts/AppLayout.tsx` **原样搬出来**，行为零变化。
 * 这张卡是陪玩抢到单之后唯一会认真看的一屏，所以发单备注 / 微信 / 房间码都在这里再写一遍。
 */
const GrabSuccessModal: React.FC<Props> = ({ order, onClose }) => (
  <Modal title="抢单成功" open={!!order} onCancel={onClose} footer={null} width={480}>
    {order &&
      (() => {
        const g = order;
        return (
          <div style={{ fontSize: 14, lineHeight: 2 }}>
            <div>
              📋 {g.gameName} · {orderTypeConfig[g.type]?.label || g.type} · ¥
              {Number(g.amount).toFixed(0)} · {g.duration}h
            </div>
            {g.customer?.customerCode && <div>客户编号：{g.customer.customerCode}</div>}
            {/* 客服发单时填的备注：抢单成功这张卡是陪玩唯一会认真看的一屏（老板 2026-09-29
                「陪玩抢到订单后，订单管理怎么没显示当时发单时填写的备注」）。 */}
            {g.customFields?.deltaNote && (
              <div style={{ color: SEMANTIC.warningDeep }}>📝 备注：{g.customFields.deltaNote}</div>
            )}
            {g.customFields?.customerSource && <div>来源：{g.customFields.customerSource}</div>}
            {g.customFields?.csCultivated === true && (
              <div style={{ color: BRAND.primary, fontWeight: 500 }}>
                ✅ 该客户已添加到客服工作微信（{g.customFields?.csWorkWechatName || '客服微信'}），请注意措辞
              </div>
            )}
            {g.customFields?.customerWechat && (
              <div>
                💬 微信：<Typography.Text copyable>{g.customFields.customerWechat}</Typography.Text>
              </div>
            )}
            {g.customFields?.customerRoomCode && (
              <div>
                🏠 房间码：<Typography.Text copyable>{g.customFields.customerRoomCode}</Typography.Text>
              </div>
            )}
            {g.customFields?.customerPlatformAccount && (
              <div>
                🔗 平台号：
                <Typography.Text copyable>{g.customFields.customerPlatformAccount}</Typography.Text>
              </div>
            )}
            {g.csUser?.username && <div>发布者：{g.csUser.username}</div>}
            {g.customFields?.urgency === 'later' && <Tag color="purple">📅预约</Tag>}
            {g.customFields?.urgency !== 'later' && g.customFields?.urgency && <Tag color="green">⚡立即打</Tag>}
          </div>
        );
      })()}
  </Modal>
);

export default GrabSuccessModal;
