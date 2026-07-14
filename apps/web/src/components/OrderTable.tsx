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
    tableLayout="fixed"
    pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 条`, size: 'small' }}
    columns={[
      { title: '游戏', width: 70, render: (_: any, r: any) => <Text style={{fontSize:10}}>{r.gameName}</Text> },
      { title: '客户', width: 80, render: (_: any, r: any) => <Text style={{fontSize:10}}>{r.customFields?.customerWechat || r.customer?.wechatId || '-'}</Text> },
      { title: '订单', width: 140, render: (_: any, r: any) => (
        <Text style={{fontSize:10}}>
          <Tag color={statusConfig[r.type]?.color||'default'} style={{fontSize:9,margin:0,padding:'0 3px'}}>{(statusConfig[r.type] as any)?.label||r.type}</Tag>
          {' '}<span style={{color:'#FF4757',fontWeight:600}}>¥{Number(r.amount).toFixed(0)}</span>
          {r.duration>0?<span> {r.duration}h</span>:null}
        </Text>)},
      { title: '来源', width: 60, render: (_: any, r: any) => {
        const cf = r.customFields || {};
        return <Text style={{fontSize:9}}>{cf.customerSource||'-'}{cf.urgency?<><br/><Tag color={cf.urgency==='later'?'purple':'green'} style={{fontSize:8,margin:0,padding:'0 2px'}}>{cf.urgency==='later'?'预约':'立即'}</Tag></>:null}</Text>;
      }},
      { title: '状态', dataIndex: 'status', width: 45,
        render: (s: string) => <Tag color={statusConfig[s]?.color||'default'} style={{fontSize:9,margin:0,padding:'0 3px'}}>{statusConfig[s]?.label||s}</Tag> },
      { title: '微信', width: 75, render: (_: any, r: any) => {
        const w = r.customFields?.workWechatName || r.customFields?.workWechatId;
        return w ? <Tag color="cyan" style={{fontSize:9,margin:0,padding:'0 3px'}}>{String(w).slice(0,6)}</Tag> : <Text style={{fontSize:9}}>-</Text>;
      }},
      { title: '备注', width: 55, render: (_: any, r: any) => <Text style={{fontSize:9}}>{(r.notes||r.customFields?.deltaNote||'-').slice(0,6)}</Text> },
      ...(renderActions ? [{ title: '操作', width: 260, render: (_: any, r: any) => <Space size={2} wrap>{renderActions(r)}</Space> }] : []),
    ]}
  />
);

export default OrderTable;
