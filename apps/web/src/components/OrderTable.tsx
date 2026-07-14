import React from 'react';
import { Table, Tag, Typography, Space } from 'antd';
import { orderStatusConfig } from '../constants';

const { Text } = Typography;

const statusConfig = orderStatusConfig;

interface Props {
  dataSource: any[]; loading?: boolean;
  unreadMap?: Record<string, number>;
  renderActions?: (r: any) => React.ReactNode;
}

const OrderTable: React.FC<Props> = ({ dataSource, loading, renderActions }) => (
  <Table size="small" dataSource={dataSource} rowKey="id" loading={loading}
    pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 条` }}
    columns={[
      { title: '客户编号', key: 'customerCode', width: 150,
        render: (_: any, r: any) => <Text>{r.customer?.customerCode || '-'}</Text> },
      { title: '微信号', key: 'wechatId', render: (_: any, r: any) => r.customFields?.customerWechat || r.customer?.wechatId || '-' },
      { title: '最近订单', key: 'lastOrder', width: 220, render: (_: any, r: any) => {
        return (<>
          <Text strong>{r.gameName}</Text>
          <br /><Text type="secondary" style={{ fontSize: 11 }}>
            <Tag color={statusConfig[r.type]?.color || 'default'} style={{ fontSize: 10, margin: 0 }}>{(statusConfig[r.type] as any)?.label || r.type}</Tag>
            {' '}¥{Number(r.amount).toFixed(0)}
            {r.duration > 0 && <Text style={{ fontSize: 10 }}> · {r.duration}h</Text>}
          </Text>
        </>);
      }},
      { title: '来源/时间', key: 'source', width: 110, render: (_: any, r: any) => {
        const cf = r.customFields || {};
        return (<>
          {cf.customerSource && <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>📡{cf.customerSource}</Tag>}
          {cf.urgency === 'later' ? <Tag color="purple" style={{ fontSize: 10, margin: '2px 0' }}>📅预约</Tag> : <Tag color="green" style={{ fontSize: 10, margin: '2px 0' }}>⚡立即打</Tag>}
          {cf.billingMode === 'round' ? <Tag style={{ fontSize: 10, margin: 0 }}>按局</Tag> : <Tag style={{ fontSize: 10, margin: 0 }}>按小时</Tag>}
        </>);
      }},
      { title: '状态', dataIndex: 'status', key: 'status', width: 90,
        render: (s: string) => <Tag color={statusConfig[s]?.color || 'default'}>{statusConfig[s]?.label || s}</Tag> },
      { title: '所用微信', key: 'workWechat', width: 100, render: (_: any, r: any) => {
        const wo = r.customFields || {};
        if (wo.workWechatName) return <Tag color="cyan" style={{fontSize:11,margin:0}}>📱{wo.workWechatName}</Tag>;
        if (wo.workWechatId) return <Tag color="cyan" style={{fontSize:11,margin:0}}>📱{wo.workWechatId?.slice(0,8)}</Tag>;
        return <Text type="secondary" style={{fontSize:11}}>-</Text>;
      }},
      { title: '陪玩', key: 'companion', width: 80, render: (_: any, r: any) => r.companion?.user?.username || '-' },
      { title: '最近跟进', key: 'followUp', width: 120, render: () => {
        return <Tag color="orange" style={{fontSize:10}}>-</Tag>;
      }},
      { title: '累计消费', key: 'totalSpent', width: 120,
        render: (_: any, r: any) => <span style={{ color: '#FF4757', fontWeight: 600 }}>¥{Number(r.amount || 0).toFixed(2)}</span> },
      { title: '备注', key: 'notes', width: 200, render: (_: any, r: any) => <Text style={{fontSize:12}}>{r.notes || r.customFields?.deltaNote || '-'}</Text> },
      ...(renderActions ? [{ title: '操作', key: 'action', width: 160, render: (_: any, r: any) => <Space size="small" wrap>{renderActions(r)}</Space> }] : []),
    ]}
  />
);

export default OrderTable;
