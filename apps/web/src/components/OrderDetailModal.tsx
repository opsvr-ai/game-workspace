// craftsman-ignore: TS001,TS002
import React from 'react';
import { Modal, Descriptions, Image, Tag, Typography } from 'antd';
import {
  orderStatusConfig,
  orderTypeConfig,
  serviceTypeConfig,
  urgencyConfig,
  billingModeConfig,
} from '../constants';
import { canSeeCustomerSource, DATA_FONT_SIZE, DATA_SUB_FONT_SIZE, DETAIL_LABEL_WIDTH } from '../constants/datasetColumns';
import { useAuthStore } from '../stores/authStore';

const { Text } = Typography;

interface Props {
  order: any | null;
  open: boolean;
  onClose: () => void;
}

const fmtTime = (v?: string | null) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-');

/**
 * 订单只读详情。
 *
 * 「广播 / 指定」这类订单按权限不给改，以前整行点不进去、右侧又没有按钮，
 * 客服想核一眼客户微信或备注只能去别处翻。现在整行点开就是这张只读卡。
 */
const OrderDetailModal: React.FC<Props> = ({ order, open, onClose }) => {
  // 陪玩点整行也会开到这张卡（OrdersPage 的 onRow 是「能改的进编辑、不能改的进详情」），
  // 所以「客户昵称 / 客户来源 / 来源账号」这三行也要按角色藏：老板 2026-09-29「陪玩端 隐藏客户小红书信息」。
  // 昵称也是小红书昵称（建单时那个框写的就是「小红书昵称/抖音昵称等」），订单列表对陪玩本来就不显示，
  // 这里不一起藏掉的话，点开整行又能看见。
  // hook 必须放在下面的 `if (!order) return null` 之前。
  const role = useAuthStore((s) => s.user?.role);
  const showSource = canSeeCustomerSource(role);
  if (!order) return null;
  const cf = order.customFields || {};
  const isRound = cf.billingMode === 'round';
  const duration = isRound ? `${order.duration || cf.deltaCount || '?'}局` : `${order.duration || '?'}小时`;
  const isDouble = !!order.coCompanionId || cf.deltaCount === '双';
  const companionStudio = order.companion?.studio;
  const isBridged = !!companionStudio?.id && !!order.studioId && order.studioId !== companionStudio.id;

  return (
    <Modal
      title={`订单详情 · ${order.orderCode || order.id?.slice(0, 8)}`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnClose
    >
      <Descriptions
        column={2}
        size="small"
        bordered
        style={{ fontSize: DATA_FONT_SIZE }}
        labelStyle={{ width: DETAIL_LABEL_WIDTH }}
      >
        <Descriptions.Item label="状态">
          <Tag color={orderStatusConfig[order.status]?.color || 'default'} style={{ margin: 0 }}>
            {orderStatusConfig[order.status]?.label || order.status}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="类型">
          <Tag color={orderTypeConfig[order.type]?.color || 'blue'} style={{ margin: 0 }}>
            {orderTypeConfig[order.type]?.label || order.type || '首单'}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="游戏">{order.gameName || '-'}</Descriptions.Item>
        <Descriptions.Item label="服务">
          {serviceTypeConfig[cf.serviceType || order.serviceType]?.label || '陪玩'}
        </Descriptions.Item>
        <Descriptions.Item label="单/双">{isDouble ? '双陪' : '单陪'}</Descriptions.Item>
        <Descriptions.Item label="任务">{cf.deltaMission || '-'}</Descriptions.Item>
        <Descriptions.Item label="时长">{duration}</Descriptions.Item>
        <Descriptions.Item label="计费">
          {billingModeConfig[cf.billingMode]?.label || (isRound ? '按局' : '按小时')}
        </Descriptions.Item>
        <Descriptions.Item label="金额">
          <Text strong>¥{Number(order.amount || 0).toFixed(2)}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="打单时间">
          <Tag color={urgencyConfig[cf.urgency]?.color || 'green'} style={{ margin: 0 }}>
            {urgencyConfig[cf.urgency]?.label || '立即'}
          </Tag>
          {cf.urgency === 'later' && cf.scheduledTimeText ? (
            <Text type="secondary" style={{ marginLeft: 6, fontSize: DATA_SUB_FONT_SIZE }}>
              {cf.scheduledTimeText}
            </Text>
          ) : null}
        </Descriptions.Item>
        <Descriptions.Item label="主陪">{order.companion?.user?.username || '-'}</Descriptions.Item>
        <Descriptions.Item label="接单工作室">
          {companionStudio?.name ? (
            <Tag color={isBridged ? 'purple' : 'default'} style={{ margin: 0 }}>
              {isBridged ? `桥接·${companionStudio.name}` : companionStudio.name}
            </Tag>
          ) : (
            '-'
          )}
        </Descriptions.Item>
        <Descriptions.Item label="副陪">{order.coCompanion?.user?.username || '-'}</Descriptions.Item>
        <Descriptions.Item label="发布人">{order.csUser?.username || '-'}</Descriptions.Item>
        <Descriptions.Item label="客户微信">{cf.customerWechat || order.customer?.wechatId || '-'}</Descriptions.Item>
        {showSource && (
          <>
            <Descriptions.Item label="客户昵称">{cf.customerNickname || '-'}</Descriptions.Item>
            <Descriptions.Item label="客户来源">{cf.customerSource || order.customer?.platform || '-'}</Descriptions.Item>
            <Descriptions.Item label="来源账号">{cf.customerSourceAccount || cf.customerAccountId || '-'}</Descriptions.Item>
          </>
        )}
        <Descriptions.Item label="房间码">{cf.customerRoomCode || '-'}</Descriptions.Item>
        <Descriptions.Item label="YY / KOOK">
          {[cf.customerYy ? 'YY:' + cf.customerYy : '', cf.customerPlatformAccount ? 'KOOK:' + cf.customerPlatformAccount : '']
            .filter(Boolean)
            .join(' ') || '-'}
        </Descriptions.Item>
        <Descriptions.Item label="客户二维码">
          {cf.customerWechatQr ? (
            <Image src={cf.customerWechatQr} width={96} style={{ borderRadius: 4 }} preview={{ mask: '二维码' }} />
          ) : (
            '-'
          )}
        </Descriptions.Item>
        <Descriptions.Item label="发布时间">{fmtTime(order.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="接单时间">{fmtTime(order.grabbedAt)}</Descriptions.Item>
        <Descriptions.Item label="备注" span={2}>
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
