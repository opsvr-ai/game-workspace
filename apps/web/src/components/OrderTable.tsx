import React from 'react';
import { Table, Tag, Typography, Space } from 'antd';
import { orderTypeConfig, orderStatusConfig } from '../constants';
import EditableWorkWechat from './EditableWorkWechat';

const { Text } = Typography;

interface Props {
  dataSource: any[]; loading?: boolean;
  unreadMap?: Record<string, number>;
  renderActions?: (r: any) => React.ReactNode;
}

const OrderTable: React.FC<Props> = ({ dataSource, loading, renderActions }) => (
  <Table size="small" dataSource={dataSource} rowKey="id" loading={loading}
    tableLayout="fixed"
    pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 条`, size: 'small' }}
    columns={[
      { title: '客户编号', dataIndex: 'customerCode', key: 'customerCode', width: 60,
        render: (_: any, r: any) => <Text>{r.customer?.customerCode || '-'}</Text> },
      { title: '微信号', key: 'wechatId', width: 70, render: (_: any, r: any) => <Text>{r.customFields?.customerWechat || r.customer?.wechatId || '-'}</Text> },
      { title: '最近订单', key: 'lastOrder', width: 110, render: (_: any, r: any) => {
        const cf = r.customFields || {};
        return (<>
          <Text strong>{r.gameName}</Text>
          <br /><Text type="secondary" style={{ fontSize: 11 }}>
            <Tag color={orderTypeConfig[r.type]?.color} style={{ fontSize: 10, margin: 0 }}>{orderTypeConfig[r.type]?.label || r.type}</Tag>
            {' '}¥{Number(r.amount).toFixed(0)}
            {cf.deltaMission && <Tag color="red" style={{ fontSize: 10, margin: '0 0 0 4px' }}>{cf.deltaMission}</Tag>}
            {cf.deltaCount && <Tag style={{ fontSize: 10, margin: '0 0 0 4px' }}>{cf.deltaCount}</Tag>}
            {cf.billingMode === 'round' && <Tag style={{ fontSize: 10, margin: '0 0 0 4px' }}>🎯{r.duration||cf.deltaCount||'?'}局</Tag>}
            {r.duration > 0 && cf.billingMode !== 'round' && <Text style={{ fontSize: 10 }}> · {r.duration}h</Text>}
          </Text>
        </>);
      }},
      { title: '来源/时间', key: 'source', width: 50, render: (_: any, r: any) => {
        const cf = r.customFields || {};
        return (<>
          {cf.customerSource && <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>📡{cf.customerSource}</Tag>}
          {cf.urgency === 'later' ? <Tag color="purple" style={{ fontSize: 10, margin: '2px 0' }}>📅预约</Tag> : <Tag color="green" style={{ fontSize: 10, margin: '2px 0' }}>⚡立即打</Tag>}
          {cf.billingMode && <Tag style={{ fontSize: 10, margin: 0 }}>{cf.billingMode==='round'?'按局':'按小时'}</Tag>}
        </>);
      }},
      { title: '状态', dataIndex: 'status', key: 'status', width: 45,
        render: (s: string) => <Tag color={orderStatusConfig[s]?.color||'default'}>{orderStatusConfig[s]?.label||s}</Tag> },
      { title: '所用微信', key: 'workWechat', width: 90, render: (_: any, r: any) => <EditableWorkWechat order={r} /> },
      { title: '陪玩', key: 'companion', width: 45, render: (_: any, r: any) => r.companion?.user?.username || <Text type="secondary">-</Text> },
      { title: '最近跟进', key: 'followUp', width: 50, render: () => <Tag color="orange" style={{fontSize:10}}>-</Tag> },
      { title: '累计消费', key: 'totalSpent', width: 55,
        render: (_: any, r: any) => <span style={{ color: '#FF4757', fontWeight: 600 }}>¥{Number(r.amount||0).toFixed(2)}</span> },
      { title: '备注', key: 'notes', width: 60, render: (_: any, r: any) => <Text style={{fontSize:12}}>{r.notes||r.customFields?.deltaNote||'-'}</Text> },
      ...(renderActions ? [{ title: '操作', key: 'actions', width: 270, render: (_: any, r: any) => <Space size={2} wrap>{renderActions(r)}</Space> }] : []),
    ]}
  />
);

export default OrderTable;
