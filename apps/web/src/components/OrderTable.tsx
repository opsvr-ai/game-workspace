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
      { title: '客户编号', key: 'code', width: 80,
        render: (_: any, r: any) => <Text style={{fontSize:11}}>{r.customer?.customerCode || '-'}</Text> },
      { title: '微信号', key: 'wx', width: 90,
        render: (_: any, r: any) => <Text style={{fontSize:11}}>{r.customFields?.customerWechat || r.customer?.wechatId || '-'}</Text> },
      { title: '最近订单', key: 'order', width: 160,
        render: (_: any, r: any) => (<Text style={{fontSize:11}}>
          {r.gameName}{' '}
          <Tag color={statusConfig[r.type]?.color || 'default'} style={{fontSize:9,margin:0}}>{(statusConfig[r.type] as any)?.label||r.type}</Tag>
          {' '}<span style={{color:'#FF4757',fontWeight:600}}>¥{Number(r.amount).toFixed(0)}</span>
          {r.duration>0&&<span style={{fontSize:9}}> {r.duration}h</span>}
        </Text>)},
      { title: '来源', key: 'source', width: 80,
        render: (_: any, r: any) => {
          const cf = r.customFields || {};
          return <><Text style={{fontSize:10}}>{cf.customerSource || '-'}</Text>{cf.urgency&&<br/>}{cf.urgency&&<Tag color={cf.urgency==='later'?'purple':'green'} style={{fontSize:9,margin:0}}>{cf.urgency==='later'?'📅预约':'⚡立即打'}</Tag>}</>;
        }},
      { title: '状态', dataIndex: 'status', width: 55,
        render: (s: string) => <Tag color={statusConfig[s]?.color||'default'} style={{fontSize:10,margin:0}}>{statusConfig[s]?.label||s}</Tag> },
      { title: '所用微信', key: 'workWx', width: 85,
        render: (_: any, r: any) => {
          const w = r.customFields?.workWechatName || r.customFields?.workWechatId;
          return w ? <Tag color="cyan" style={{fontSize:10,margin:0}}>📱{w}</Tag> : <Text type="secondary" style={{fontSize:10}}>-</Text>;
        }},
      { title: '备注', key: 'note', width: 80,
        render: (_: any, r: any) => <Text style={{fontSize:11}}>{r.notes||r.customFields?.deltaNote||'-'}</Text> },
      ...(renderActions ? [{ title: '操作', key: 'act', width: 120, render: (_: any, r: any) => <Space size={0} wrap>{renderActions(r)}</Space> }] : []),
    ]}
  />
);

export default OrderTable;
