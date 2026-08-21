// craftsman-ignore: TS001,TS002
import React, { memo } from 'react';
import { Table, Tag, Typography, Space, Image } from 'antd';
import { orderTypeConfig, orderStatusConfig, customerPaidToConfig } from '../constants';
import EditableWorkWechat from './EditableWorkWechat';
import ServiceTimer from './ServiceTimer';

const { Text } = Typography;

interface Props {
  dataSource: any[];
  loading?: boolean;
  unreadMap?: Record<string, number>;
  renderActions?: (r: any) => React.ReactNode;
  onWorkWechatSaved?: (order: any, workWechatId: string, workWechatName: string) => void;
  extraColumns?: any[];
}

const OrderTable: React.FC<Props> = ({ dataSource, loading, renderActions, onWorkWechatSaved, extraColumns }) => (
  <Table
    size="middle"
    dataSource={dataSource}
    rowKey="id"
    loading={loading}
    pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 条`, size: 'default' }}
    columns={[
      {
        title: '客户编号', dataIndex: 'customerCode', key: 'customerCode', width: 80, align: 'center' as const,
        render: (_: any, r: any) => <Text>{r.customer?.customerCode || '-'}</Text>,
      },
      {
        title: '微信', key: 'wechatId', width: 90, align: 'center' as const,
        render: (_: any, r: any) => {
          const wx = r.customFields?.customerWechat || r.customer?.wechatId;
          const csAdded = r.customFields?.csCultivated === true;
          return (
            <Space size={2} direction="vertical" style={{ gap: 0 }}>
              {wx ? <Text ellipsis style={{ maxWidth: 90 }}>{wx}</Text> : r.customFields?.customerWechatQr ? <Text style={{ color: '#1677ff' }}>📷 二维码</Text> : <Text>-</Text>}
              {csAdded && <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>已加客服微信</Tag>}
            </Space>
          );
        },
      },
      {
        title: '订单', key: 'order', width: 140,
        render: (_: any, r: any) => {
          const cf = r.customFields || {};
          return (
            <div style={{ lineHeight: 1.4 }}>
              <div style={{ fontWeight: 500, marginBottom: 2 }}>{r.gameName}</div>
              <Space size={4} wrap>
                <Tag color={orderTypeConfig[r.type]?.color} style={{ fontSize: 11, margin: 0 }}>{orderTypeConfig[r.type]?.label || r.type}</Tag>
                <Text style={{ fontSize: 12 }}>¥{Number(r.amount).toFixed(0)}</Text>
                {r.duration > 0 && <Text type="secondary" style={{ fontSize: 11 }}>{r.duration}h</Text>}
              </Space>
            </div>
          );
        },
      },
      {
        title: '来源', key: 'source', width: 80, align: 'center' as const,
        render: (_: any, r: any) => {
          const cf = r.customFields || {};
          return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              {cf.urgency === 'later'
                ? <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>预约</Tag>
                : <Tag color="green" style={{ fontSize: 10, margin: 0 }}>即时</Tag>}
              {cf.customerSource && <Tag style={{ fontSize: 10, margin: 0 }}>{cf.customerSource}</Tag>}
              {cf.billingMode && <Tag style={{ fontSize: 10, margin: 0 }}>{cf.billingMode === 'round' ? '按局' : '按时'}</Tag>}
            </div>
          );
        },
      },
      {
        title: '状态', dataIndex: 'status', key: 'status', width: 70, align: 'center' as const,
        render: (s: string) => <Tag color={orderStatusConfig[s]?.color || 'default'}>{orderStatusConfig[s]?.label || s}</Tag>,
      },
      {
        title: '计时', key: 'timer', width: 90, align: 'center' as const,
        render: (_: any, r: any) => {
          const active = (r.sessions || []).find((s: any) => s.status === 'ACTIVE' && s.startedAt);
          return active ? <ServiceTimer startedAt={active.startedAt} /> : <Text type="secondary">-</Text>;
        },
      },
      {
        title: '陪玩', key: 'companion', width: 90, align: 'center' as const,
        render: (_: any, r: any) =>
          r.coCompanion ? (
            <Text>{r.companion?.user?.username || '-'}<Text type="secondary" style={{ fontSize: 11 }}> +{r.coCompanion?.user?.username || ''}</Text></Text>
          ) : (
            <Text>{r.companion?.user?.username || '-'}</Text>
          ),
      },
      { title: '工作微信', key: 'workWechat', width: 90, align: 'center' as const, render: (_: any, r: any) => <EditableWorkWechat order={r} onSaved={(wid, name) => onWorkWechatSaved?.(r, wid, name)} /> },
      {
        title: '认领客服', key: 'claimedCs', width: 90, align: 'center' as const,
        render: (_: any, r: any) => <Text>{r.claimedCsUser?.username || (r.claimedCsUserId ? '已认领' : '-')}</Text>,
      },
      {
        title: '认领微信', key: 'csWorkWechat', width: 100, align: 'center' as const,
        render: (_: any, r: any) => <Text ellipsis style={{ maxWidth: 100 }}>{r.csWorkWechatName || '-'}</Text>,
      },
      {
        title: '收款去向', key: 'customerPaidTo', width: 110, align: 'center' as const,
        render: (_: any, r: any) => {
          const cfg = customerPaidToConfig[r.customerPaidTo];
          return (
            <Space size={2} direction="vertical" style={{ gap: 0 }}>
              {cfg ? <Tag color={cfg.color} style={{ margin: 0 }}>{cfg.label}</Tag> : <Text>{r.customerPaidTo || '-'}</Text>}
              {r.customerPaymentAccountName && (
                <Text type="secondary" style={{ fontSize: 11 }}>{r.customerPaymentAccountName}</Text>
              )}
            </Space>
          );
        },
      },
      {
        title: '金额', key: 'amount', width: 90, align: 'center' as const,
        render: (_: any, r: any) => <Text strong style={{ color: '#EF4444' }}>¥{Number(r.amount || 0).toFixed(0)}</Text>,
      },
      {
        title: '备注', key: 'notes', width: 110, align: 'center' as const,
        render: (_: any, r: any) => (
          <Space size={2} wrap style={{ justifyContent: 'center' }}>
            {r.screenshotUrl && <Image src={r.screenshotUrl} width={20} height={20} style={{ borderRadius: 4, cursor: 'pointer' }} preview={{ mask: '查看' }} />}
            {r.contactStatus === 'not_accepted' && <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>待审</Tag>}
            {r.contactStatus === 'added' && !r.customFields?.csContactEvidenceUrl && <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>未传凭证</Tag>}
            {(r.customFields?.deltaNote || r.notes || '').includes('补单') && <Tag color="red" style={{ fontSize: 10, margin: 0 }}>补单</Tag>}
            <Text ellipsis style={{ fontSize: 11, maxWidth: 60 }}>{(r.notes || r.customFields?.deltaNote || '').slice(0, 12)}</Text>
          </Space>
        ),
      },
      ...(extraColumns || []),
      ...(renderActions
        ? [{ title: '操作', key: 'actions', width: 220, render: (_: any, r: any) => <Space size={4} wrap>{renderActions(r)}</Space> }]
        : []),
    ]}
  />
);

export default memo(OrderTable);
