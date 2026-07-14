import React from 'react';
import { Table, Tag, Typography, Space } from 'antd';
import { orderStatusConfig } from '../constants';

const { Text } = Typography;
const S = { fontSize: 10 };
const T = (s: string) => <Text style={S}>{s}</Text>;

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
      { title: '客户编号', width: 80, render: (_: any, r: any) => T(r.customer?.customerCode || '-') },
      { title: '微信号', width: 90, render: (_: any, r: any) => T(r.customFields?.customerWechat || r.customer?.wechatId || '-') },
      { title: '最近订单', width: 170, render: (_: any, r: any) => (
        <Text style={S}>{r.gameName}{' '}
          <Tag color={statusConfig[r.type]?.color||'default'} style={{fontSize:9,margin:0,padding:'0 4px'}}>{(statusConfig[r.type] as any)?.label||r.type}</Tag>
          {' '}<span style={{color:'#FF4757',fontWeight:600,fontSize:10}}>¥{Number(r.amount).toFixed(0)}</span>
          {r.duration>0?<span style={S}> {r.duration}h</span>:null}
        </Text>)},
      { title: '来源', width: 70, render: (_: any, r: any) => {
        const cf = r.customFields || {};
        return (<>{cf.customerSource?T(cf.customerSource):T('-')}
          {cf.urgency?<><br/><Tag color={cf.urgency==='later'?'purple':'green'} style={{fontSize:9,margin:0,padding:'0 4px'}}>{cf.urgency==='later'?'📅':'⚡'}</Tag></>:null}
        </>);
      }},
      { title: '状态', dataIndex: 'status', width: 50,
        render: (s: string) => <Tag color={statusConfig[s]?.color||'default'} style={{fontSize:9,margin:0,padding:'0 4px'}}>{statusConfig[s]?.label||s}</Tag> },
      { title: '微信', width: 80, render: (_: any, r: any) => {
        const w = r.customFields?.workWechatName || r.customFields?.workWechatId;
        return w ? <Tag color="cyan" style={{fontSize:9,margin:0,padding:'0 4px'}}>{String(w).slice(0,8)}</Tag> : T('-');
      }},
      { title: '备注', width: 70, render: (_: any, r: any) => T((r.notes||r.customFields?.deltaNote||'-').slice(0,8)) },
      ...(renderActions ? [{ title: '操作', width: 90, render: (_: any, r: any) => <Space size={0} wrap>{renderActions(r)}</Space> }] : []),
    ]}
  />
);

export default OrderTable;
