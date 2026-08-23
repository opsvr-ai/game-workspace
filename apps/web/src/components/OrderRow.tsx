// craftsman-ignore: TS001,TS002
import React, { memo } from 'react';
import { Card, Tag, Typography, Row, Col } from 'antd';
import { orderTypeConfig, serviceTypeConfig, urgencyConfig, billingModeConfig } from '../constants/orders';

const { Text } = Typography;

interface OrderRowProps {
  order: any;
  index?: number;
  renderActions?: (order: any) => React.ReactNode;
}

const OrderRow: React.FC<OrderRowProps> = ({ order, index, renderActions }) => (
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
      {order.customFields?.deltaMission && (
        <Col>
          <Tag style={{ margin: 0 }}>{order.customFields.deltaMission}</Tag>
        </Col>
      )}
      {order.customFields?.deltaCount && (
        <Col>
          <Tag style={{ margin: 0 }}>{order.customFields.deltaCount}</Tag>
        </Col>
      )}
      {order.customFields?.deltaNote && (
        <Col>
          <Text type="warning" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
            📝{order.customFields.deltaNote}
          </Text>
        </Col>
      )}
      <Col>
        <Text style={{ fontSize: 14, fontWeight: 700, color: '#1677ff', whiteSpace: 'nowrap' }}>
          ¥{Number(order.amount).toFixed(0)}
        </Text>
      </Col>
      <Col>
        <Tag color={urgencyConfig[order.customFields?.urgency]?.color || 'green'} style={{ margin: 0 }}>
          {urgencyConfig[order.customFields?.urgency]?.label || '⚡立即打'}
        </Tag>
      </Col>
      {order.customFields?.scheduledTimeText && (
        <Col>
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {order.customFields.scheduledTimeText}
          </Text>
        </Col>
      )}
      {(order.customFields?.customerSource || order.customer?.platform) && (
        <Col>
          <Tag color="orange" style={{ margin: 0 }}>
            📡{order.customFields?.customerSource || order.customer?.platform}
          </Tag>
        </Col>
      )}
      {order.customFields?.customerWechat && (
        <Col>
          <Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
            💬{order.customFields.customerWechat}
          </Text>
        </Col>
      )}
      {order.customFields?.customerYy && (
        <Col>
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            YY:{order.customFields.customerYy}
          </Text>
        </Col>
      )}
      {order.customFields?.customerPlatformAccount && (
        <Col>
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            KOOK:{order.customFields.customerPlatformAccount}
          </Text>
        </Col>
      )}
      {order.customFields?.customerRoomCode && (
        <Col>
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            🚪{order.customFields.customerRoomCode}
          </Text>
        </Col>
      )}
      <Col>
        <Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
          {billingModeConfig[order.customFields?.billingMode]?.label || '按时'}
          {order.customFields?.billingMode === 'round'
            ? ` ${order.duration || '?'}局`
            : order.duration
              ? ` ${order.duration}h`
              : ''}
        </Text>
      </Col>
      <Col>
        <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          📋{order.csUser?.username || order.customFields?.createdBy || '-'}
        </Text>
      </Col>
      {renderActions && (
        <Col flex="auto" style={{ textAlign: 'right' }}>
          {renderActions(order)}
        </Col>
      )}
    </Row>
  </Card>
);

export default memo(OrderRow);
