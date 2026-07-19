// craftsman-ignore: TS001,TS002
import React, { memo } from 'react';
import { Table, Tag, Typography, Space, Image } from 'antd';
import { orderTypeConfig, orderStatusConfig } from '../constants';
import EditableWorkWechat from './EditableWorkWechat';

const { Text } = Typography;

interface Props {
  dataSource: any[];
  loading?: boolean;
  unreadMap?: Record<string, number>;
  renderActions?: (r: any) => React.ReactNode;
}

const OrderTable: React.FC<Props> = ({ dataSource, loading, renderActions }) => (
  <Table
    size="middle"
    dataSource={dataSource}
    rowKey="id"
    loading={loading}
    pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 条`, size: 'default' }}
    columns={[
      {
        title: '客户编号', dataIndex: 'customerCode', key: 'customerCode', width: 80,
        render: (_: any, r: any) => <Text>{r.customer?.customerCode || '-'}</Text>,
      },
      {
        title: '微信', key: 'wechatId', width: 90,
        render: (_: any, r: any) => <Text ellipsis style={{ maxWidth: 90 }}>{r.customFields?.customerWechat || r.customer?.wechatId || '-'}</Text>,
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
        title: '来源', key: 'source', width: 90,
        render: (_: any, r: any) => {
          const cf = r.customFields || {};
          return (
            <Space size={2} wrap>
              {cf.customerSource && <Tag style={{ fontSize: 10, margin: 0 }}>{cf.customerSource}</Tag>}
              {cf.urgency === 'later' ? <Tag color="purple" style={{ fontSize: 10, margin: 0 }}>预约</Tag> : <Tag color="green" style={{ fontSize: 10, margin: 0 }}>即时</Tag>}
              {cf.billingMode && <Tag style={{ fontSize: 10, margin: 0 }}>{cf.billingMode === 'round' ? '按局' : '按时'}</Tag>}
            </Space>
          );
        },
      },
      {
        title: '状态', dataIndex: 'status', key: 'status', width: 70,
        render: (s: string) => <Tag color={orderStatusConfig[s]?.color || 'default'}>{orderStatusConfig[s]?.label || s}</Tag>,
      },
      {
        title: '陪玩', key: 'companion', width: 90,
        render: (_: any, r: any) =>
          r.coCompanion ? (
            <Text>{r.companion?.user?.username || '-'}<Text type="secondary" style={{ fontSize: 11 }}> +{r.coCompanion?.user?.username || ''}</Text></Text>
          ) : (
            <Text>{r.companion?.user?.username || '-'}</Text>
          ),
      },
      { title: '工作微信', key: 'workWechat', width: 90, render: (_: any, r: any) => <EditableWorkWechat order={r} /> },
      {
        title: '金额', key: 'amount', width: 80, align: 'right' as const,
        render: (_: any, r: any) => <Text strong style={{ color: '#EF4444' }}>¥{Number(r.amount || 0).toFixed(0)}</Text>,
      },
      {
        title: '备注', key: 'notes', width: 100, ellipsis: true,
        render: (_: any, r: any) => (
          <Space size={2} wrap>
            {r.screenshotUrl && <Image src={r.screenshotUrl} width={20} height={20} style={{ borderRadius: 4, cursor: 'pointer' }} preview={{ mask: '查看' }} />}
            {r.contactStatus === 'not_accepted' && <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>待审</Tag>}
            {(r.customFields?.deltaNote || r.notes || '').includes('补单') && <Tag color="red" style={{ fontSize: 10, margin: 0 }}>补单</Tag>}
            <Text ellipsis style={{ fontSize: 11, maxWidth: 60 }}>{(r.notes || r.customFields?.deltaNote || '').slice(0, 12)}</Text>
          </Space>
        ),
      },
      ...(renderActions
        ? [{ title: '操作', key: 'actions', width: 220, render: (_: any, r: any) => <Space size={4} wrap>{renderActions(r)}</Space> }]
        : []),
    ]}
  />
);

export default memo(OrderTable);
