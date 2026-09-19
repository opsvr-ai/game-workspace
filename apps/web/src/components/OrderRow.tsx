// craftsman-ignore: TS001,TS002
import React, { memo, useEffect, useState } from 'react';
import { Card, Tag, Typography, Row, Col, Image, Tooltip } from 'antd';
import { orderTypeConfig, serviceTypeConfig, urgencyConfig, billingModeConfig, dispatchTypeConfig, orderStatusConfig } from '../constants/orders';
import { fmtClock, fmtAgo } from '../utils/orderPool';
import { useAuthStore } from '../stores/authStore';
import { trafficAccountApi } from '../api/trafficAccount';

const { Text } = Typography;

let cachedInactiveAccounts: Set<string> | null = null;
let cachedAt = 0;
let pendingPromise: Promise<Set<string>> | null = null;

// 全局共享一次请求：多个订单行同时挂载时也只发一次引流账号请求，避免重复请求拖慢列表。
function loadInactiveAccounts(): Promise<Set<string>> {
  if (cachedInactiveAccounts && Date.now() - cachedAt < 5 * 60 * 1000) {
    return Promise.resolve(cachedInactiveAccounts);
  }
  if (pendingPromise) return pendingPromise;
  pendingPromise = trafficAccountApi
    .list('studio')
    .then(({ data }: any) => {
      const inactive = new Set<string>();
      (data.data || []).forEach((a: any) => {
        if (a.status === 'INACTIVE') inactive.add(a.nickname);
      });
      cachedInactiveAccounts = inactive;
      cachedAt = Date.now();
      return inactive;
    })
    .finally(() => {
      pendingPromise = null;
    });
  return pendingPromise;
}

interface OrderRowProps {
  order: any;
  index?: number;
  renderActions?: (order: any) => React.ReactNode;
}

const OrderRow: React.FC<OrderRowProps> = ({ order, index, renderActions }) => {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'CS' || role === 'ADMIN' || role === 'OWNER';
  const cf = order.customFields || {};
  const session = order.sessions?.[0];
  const createdAtMs = order.createdAt ? new Date(order.createdAt).getTime() : null;
  const actualHours = session?.startedAt
    ? Math.max(
        0,
        ((session.endedAt ? new Date(session.endedAt).getTime() : Date.now()) -
          new Date(session.startedAt).getTime() -
          (session.totalPausedSec || 0) * 1000) /
          3600000,
      )
    : null;
  const statusCfg = orderStatusConfig[order.status];
  const [inactiveAccounts, setInactiveAccounts] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    loadInactiveAccounts()
      .then((inactive) => {
        if (alive) setInactiveAccounts(inactive);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card
      className="order-row-card"
      size="small"
      style={{ borderLeft: `3px solid ${orderTypeConfig[order.type]?.color || '#1677ff'}` }}
    >
      {/* 允许换行：这一行字段很多，写死单行时 antd 会把右侧按钮列压窄，
          按钮被挤成竖排（订单池流转失败明细里就能看到「跳/再」竖着排）。 */}
      <Row align="middle" gutter={8} wrap>
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
        {statusCfg && (
          <Col>
            <Tag color={statusCfg.color} style={{ margin: 0 }}>
              {statusCfg.label}
            </Tag>
          </Col>
        )}
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
        {cf.csCultivated === true && (
          <Col>
            <Tag color="cyan" style={{ margin: 0 }}>
              ✅ 客服已加过微信，请知悉
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
        {order.coCompanion?.user?.username && (
          <Col>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap', color: '#722ed1' }}>
              副陪:{order.coCompanion.user.username}
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
              {inactiveAccounts.has(cf.customerSourceAccount) && (
                <Tag color="default" style={{ fontSize: 10, margin: '0 0 0 4px' }}>已弃用</Tag>
              )}
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
            {/* 平台账号数字 ID 平时用不上，写出来又长又占地方（用户反馈「对客服没用」）。
                改成一个小问号，鼠标停上去才显示，需要核对时照样查得到。 */}
            <Tooltip title={`客户ID：${cf.customerAccountId}`}>
              <Text type="secondary" style={{ fontSize: 12, cursor: 'help' }}>
                🆔
              </Text>
            </Tooltip>
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
        {isAdmin && actualHours != null && (
          <Col>
            <Text type="secondary" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
              实际服务 {actualHours.toFixed(1)}h
            </Text>
          </Col>
        )}
        <Col>
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            📋{order.csUser?.username || cf.createdBy || '-'}
          </Text>
        </Col>
        {/* 流转失败明细/跟进列表只有「谁发的」，没有「什么时候发的」，
            客服判断要不要把单再次入池时缺少依据，所以补上发布时间和已过去多久。 */}
        {createdAtMs != null && (
          <Col>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
              🕒{fmtClock(order.createdAt)} · {fmtAgo(Date.now() - createdAtMs)}
            </Text>
          </Col>
        )}
        {order.poolExpiredAt && (
          <Col>
            <Text style={{ fontSize: 12, whiteSpace: 'nowrap', color: '#fa8c16' }}>
              ↩退回 {fmtClock(order.poolExpiredAt)}
            </Text>
          </Col>
        )}
        {renderActions && (
          <Col
            flex="auto"
            style={{
              textAlign: 'right',
              position: 'sticky',
              right: 0,
              background: '#fff',
              paddingLeft: 8,
              // 按钮列不参与压缩：挤压会把它压成竖排文字，宁可让这一列换到下一行。
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {renderActions(order)}
          </Col>
        )}
      </Row>
    </Card>
  );
};

export default memo(OrderRow);
