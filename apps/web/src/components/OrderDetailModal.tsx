// craftsman-ignore: TS001,TS002
import React from 'react';
import { Modal, Descriptions, Image, Tag, Typography, Button } from 'antd';
import { billingModeConfig } from '../constants';
import {
  canSeeCustomerSource,
  CELL_SUB_TEXT,
  DATA_FONT_SIZE,
  DATA_SUB_FONT_SIZE,
  DETAIL_LABEL_WIDTH,
} from '../constants/datasetColumns';
import {
  ORDER_FIELD_LABELS,
  ORDER_STATUS_TEXT_COLOR,
  orderAmountText,
  orderBillingModeText,
  orderCompanionText,
  orderCustomerContact,
  orderDeltaCountText,
  orderDurationText,
  orderGameText,
  orderServiceTypeText,
  orderStatusLabel,
  orderTypeLabel,
  orderUrgencyText,
} from '../constants/orderFields';
import { useAuthStore } from '../stores/authStore';
import { TransferNote, transferList } from './OrderTransferNote';
import { BRAND } from '../styles/tokens';

const { Text } = Typography;

interface Props {
  order: any | null;
  open: boolean;
  onClose: () => void;
  /** 接单陪玩点「转让订单」时回调（老板 2026-09-29）。不传就不显示这个按钮。 */
  onTransfer?: (order: any) => void;
}

const fmtTime = (v?: string | null) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-');

/**
 * 订单只读详情。
 *
 * 「广播 / 指定」这类订单按权限不给改，以前整行点不进去、右侧又没有按钮，
 * 客服想核一眼客户微信或备注只能去别处翻。现在整行点开就是这张只读卡。
 */
const OrderDetailModal: React.FC<Props> = ({ order, open, onClose, onTransfer }) => {
  // 陪玩点整行也会开到这张卡（OrdersPage 的 onRow 是「能改的进编辑、不能改的进详情」），
  // 所以「客户昵称 / 客户来源 / 来源账号」这三行也要按角色藏：老板 2026-09-29「陪玩端 隐藏客户小红书信息」。
  // 昵称也是小红书昵称（建单时那个框写的就是「小红书昵称/抖音昵称等」），订单列表对陪玩本来就不显示，
  // 这里不一起藏掉的话，点开整行又能看见。
  // hook 必须放在下面的 `if (!order) return null` 之前。
  const user = useAuthStore((s) => s.user);
  const myCompanionId = user?.companionId;
  // 老板 2026-10-02：来源那几行只有**发单工作室**的管理端能看到
  const showSource = canSeeCustomerSource(order, user);
  if (!order) return null;
  // 转让入口（老板 2026-09-29）：只有「我抢到、还没开始服务」的单能自己转给别人，
  // 和 OrdersPage 的 canTransfer、服务端 orders.transferOrder 是同一套口径。
  const canTransfer =
    !!onTransfer &&
    !!myCompanionId &&
    order.companionId === myCompanionId &&
    (order.status === 'GRABBED' || order.status === 'CONFIRMED') &&
    !(order.sessions?.length && order.sessions[0]?.startedAt);
  const cf = order.customFields || {};
  // 联系方式整行取同一个函数，保证跟抢单池那一行、订单管理表显示的是同一段文字
  const contactText = orderCustomerContact(order);
  const companionStudio = order.companion?.studio;
  const isBridged = !!companionStudio?.id && !!order.studioId && order.studioId !== companionStudio.id;

  return (
    <Modal
      title={`订单详情 · ${order.orderCode || order.id?.slice(0, 8)}`}
      open={open}
      onCancel={onClose}
      footer={
        canTransfer ? (
          <Button type="primary" danger onClick={() => onTransfer!(order)}>
            转让订单
          </Button>
        ) : null
      }
      width={720}
      destroyOnClose
    >
      {/* 标签一律取 constants/orderFields.ts 的唯一一份口径（老板 2026-09-30：同一个数据在所有页面
          用同一套字段名，陪玩端只是少显示几个字段）—— 和订单管理表的表头、抢单池那一行、
          客户管理 / 客户详情是同一套字。 */}
      <Descriptions
        column={2}
        size="small"
        bordered
        style={{ fontSize: DATA_FONT_SIZE }}
        labelStyle={{ width: DETAIL_LABEL_WIDTH }}
      >
        <Descriptions.Item label={ORDER_FIELD_LABELS.orderCode}>
          <Text strong>{order.orderCode || order.id?.slice(0, 8)}</Text>
          <span style={CELL_SUB_TEXT}>· {orderTypeLabel(order)}</span>
        </Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.status}>
          <span style={{ color: ORDER_STATUS_TEXT_COLOR[order.status] || '#475569' }}>{orderStatusLabel(order)}</span>
        </Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.game}>{orderGameText(order)}</Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.amount}>
          <Text strong>{orderAmountText(order)}</Text>
          <span style={{ ...CELL_SUB_TEXT, color: cf.urgency === 'later' ? '#1D4ED8' : '#94A3B8' }}>
            {orderUrgencyText(order)}
          </span>
        </Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.serviceType}>
          {orderServiceTypeText(order)}
        </Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.deltaMission}>{cf.deltaMission || '-'}</Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.deltaCount}>{orderDeltaCountText(order)}</Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.duration}>{orderDurationText(order)}</Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.billingMode}>
          {orderBillingModeText(order)}
        </Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.urgency}>
          {orderUrgencyText(order)}
          {cf.urgency === 'later' && cf.scheduledTimeText ? (
            <Text type="secondary" style={{ marginLeft: 6, fontSize: DATA_SUB_FONT_SIZE }}>
              {cf.scheduledTimeText}
            </Text>
          ) : null}
        </Descriptions.Item>
        {showSource && (
          <>
            <Descriptions.Item label={ORDER_FIELD_LABELS.customerSource}>
              {cf.customerSource || order.customer?.platform || '-'}
            </Descriptions.Item>
            <Descriptions.Item label={ORDER_FIELD_LABELS.customerSourceAccount}>
              {cf.customerSourceAccount || '-'}
            </Descriptions.Item>
            <Descriptions.Item label={ORDER_FIELD_LABELS.customerNickname}>
              {cf.customerNickname || '-'}
            </Descriptions.Item>
            <Descriptions.Item label={ORDER_FIELD_LABELS.customerAccountId}>
              {cf.customerAccountId || '-'}
            </Descriptions.Item>
          </>
        )}
        <Descriptions.Item label={ORDER_FIELD_LABELS.customerContact} span={2}>
          {contactText ? (
            <Text copyable={{ text: contactText }} style={{ color: BRAND.primary }}>
              {contactText}
            </Text>
          ) : (
            '-'
          )}
        </Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.customerWechatQr}>
          {cf.customerWechatQr ? (
            <Image src={cf.customerWechatQr} width={96} style={{ borderRadius: 4 }} preview={{ mask: '二维码' }} />
          ) : (
            '-'
          )}
        </Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.companion}>
          {orderCompanionText(order) || '-'}
        </Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.companionStudio}>
          {companionStudio?.name ? (
            <Tag color={isBridged ? 'purple' : 'default'} style={{ margin: 0 }}>
              {isBridged ? `桥接·${companionStudio.name}` : companionStudio.name}
            </Tag>
          ) : (
            '-'
          )}
        </Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.csUser}>{order.csUser?.username || '-'}</Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.createdAt}>{fmtTime(order.createdAt)}</Descriptions.Item>
        <Descriptions.Item label={ORDER_FIELD_LABELS.grabbedAt}>{fmtTime(order.grabbedAt)}</Descriptions.Item>
        {transferList(order.transfers).length > 0 && (
          <Descriptions.Item label={ORDER_FIELD_LABELS.transfers} span={2}>
            <TransferNote transfers={order.transfers} />
          </Descriptions.Item>
        )}
        <Descriptions.Item label={ORDER_FIELD_LABELS.orderNote} span={2}>
          {cf.deltaNote || order.notes || '-'}
        </Descriptions.Item>
      </Descriptions>
      <Text type="secondary" style={{ fontSize: DATA_SUB_FONT_SIZE }}>
        该订单没有修改入口（按权限规则，只有你发布的入池订单可以修改）；需要改动请找发布人处理。
      </Text>
    </Modal>
  );
};

export default OrderDetailModal;
