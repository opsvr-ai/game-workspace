// craftsman-ignore: TS001,TS002
import React, { memo } from 'react';
import { Card, Tag, Typography, Row, Col, Image } from 'antd';
import { orderTypeConfig, serviceTypeConfig, urgencyConfig, billingModeConfig, dispatchTypeConfig } from '../constants/orders';
import { useAuthStore } from '../stores/authStore';

const { Text } = Typography;

interface OrderRowProps {
  order: any;
  index?: number;
  renderActions?: (order: any) => React.ReactNode;
}

const OrderRow: React.FC<OrderRowProps> = ({ order, index, renderActions }) => {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'CS' || role === 'ADMIN' || role === 'OWNER';
  const cf = order.customFields || {};

  return (
    <Card
      size="small"
      style={{ borderLeft: `3px solid ${orderTypeConfig[order.type]?.color || '#1677ff'}` }}
    >
      <Row align="middle" gutter={8} wrap={false}>
        {index !== undefined && (
          <Col>
            <Tag style={{ background: '#f0f0f0', color: '#666', fontWeight: 700, minWidth: 24, textAlign: 'center', margin: 0 }}>
              {index + 1}
            </Tag>
          </Col>
        )}
        {order.customer?.customerCode && (
          <Col>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              👤{order.customer.customerCode}
            </Text>
          </Col>
        )}
        <Col>
          <Tag color={orderTypeConfig[order.type]?.color || 'blue'} style={{ margin: 0 }}>
            {orderTypeConfig[order.type]?.label || order.type}
          </Tag>
        </Col>
        <Col>
          <Text strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
            {order.gameName}
          </Text>
        </Col>
        <Col>
          <Tag color={serviceTypeConfig[order.serviceType]?.color || 'default'} style={{ margin: 0 }}>
            {serviceTypeConfig[order.serviceType]?.label || '陪玩'}
          </Tag>
        </Col>
        {cf.deltaMission && (
          <Col>
            <Tag style={{ margin: 0 }}>{cf.deltaMission}</Tag>
          </Col>
        )}
        {cf.deltaCount && (
          <Col>
            <Tag style={{ margin: 0 }}>{cf.deltaCount}</Tag>
          </Col>
        )}
        {cf.deltaNote && (
          <Col>
            <Text type="warning" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
              📝{cf.deltaNote}
            </Text>
          </Col>
        )}
        {order.dispatchType && (
          <Col>
            <Tag color={dispatchTypeConfig[order.dispatchType]?.color || 'default'} style={{ margin: 0 }}>
              {dispatchTypeConfig[order.dispatchType]?.label || order.dispatchType}
            </Tag>
          </Col>
        )}
        {order.companion?.user?.username && (
          <Col>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              主陪:{order.companion.user.username}
            </Text>
          </Col>
        )}
        <Col>
          <Text style={{ fontSize: 14, fontWeight: 700, color: '#1677ff', whiteSpace: 'nowrap' }}>
            ¥{Number(order.amount).toFixed(0)}
          </Text>
        </Col>
        <Col>
          <Tag color={urgencyConfig[cf.urgency]?.color || 'green'} style={{ margin: 0 }}>
            {urgencyConfig[cf.urgency]?.label || '⚡立即打'}
          </Tag>
        </Col>
        {cf.scheduledTimeText && (
          <Col>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              {cf.scheduledTimeText}
            </Text>
          </Col>
        )}
        {(cf.customerSource || order.customer?.platform) && (
          <Col>
            <Tag color="orange" style={{ margin: 0 }}>
              📡{cf.customerSource || order.customer?.platform}
            </Tag>
          </Col>
        )}
        {isAdmin && cf.customerSourceAccount && (
          <Col>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              来源账号:{cf.customerSourceAccount}
            </Text>
          </Col>
        )}
        {isAdmin && cf.customerNickname && (
          <Col>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              客户昵称:{cf.customerNickname}
            </Text>
          </Col>
        )}
        {isAdmin && cf.customerAccountId && (
          <Col>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              客户ID:{cf.customerAccountId}
            </Text>
          </Col>
        )}
        {cf.customerWechat && (
          <Col>
            <Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
              💬{cf.customerWechat}
            </Text>
          </Col>
        )}
        {cf.customerWechatQr && (
          <Col>
            <Image
              src={cf.customerWechatQr}
              width={28}
              height={28}
              style={{ borderRadius: 4, objectFit: 'cover' }}
              preview={{ mask: '二维码' }}
            />
          </Col>
        )}
        {cf.customerYy && (
          <Col>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              YY:{cf.customerYy}
            </Text>
          </Col>
        )}
        {cf.customerPlatformAccount && (
          <Col>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              KOOK:{cf.customerPlatformAccount}
            </Text>
          </Col>
        )}
        {cf.customerRoomCode && (
          <Col>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              🚪{cf.customerRoomCode}
            </Text>
          </Col>
        )}
        <Col>
          <Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
            {billingModeConfig[cf.billingMode]?.label || '按时'}
            {cf.billingMode === 'round'
              ? ` ${order.duration || '?'}局`
              : order.duration
                ? ` ${order.duration}h`
                : ''}
          </Text>
        </Col>
        <Col>
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            📋{order.csUser?.username || cf.createdBy || '-'}
          </Text>
        </Col>
        {renderActions && (
          <Col flex="auto" style={{ textAlign: 'right', position: 'sticky', right: 0, background: '#fff', paddingLeft: 8 }}>
            {renderActions(order)}
          </Col>
        )}
      </Row>
    </Card>
  );
};

export default memo(OrderRow);
