import React from 'react';
import { Table, Tag, Typography, Space } from 'antd';
import { orderTypeConfig, orderStatusConfig } from '../constants';

const { Text } = Typography;

const typeConfig = orderTypeConfig;
const statusConfig = orderStatusConfig;

interface Props {
  dataSource: any[]; loading?: boolean;
  unreadMap?: Record<string, number>;
  renderActions?: (r: any) => React.ReactNode;
  showCompanion?: boolean;
}

const OrderTable: React.FC<Props> = ({ dataSource, loading, renderActions, showCompanion }) => (
  <Table size="small" dataSource={dataSource} rowKey="id" loading={loading}
    pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 条` }}
    columns={[
      { title: '游戏', dataIndex: 'gameName', width: 80 },
      { title: '类型', dataIndex: 'type', width: 60, render: (t: string) => <Tag color={typeConfig[t]?.color} style={{fontSize:11}}>{typeConfig[t]?.label || t}</Tag> },
      { title: '金额', dataIndex: 'amount', width: 70, render: (v: number) => <span style={{ color: '#FF4757', fontWeight: 600, fontSize: 12 }}>¥{Number(v).toFixed(0)}</span> },
      { title: '客户', key: 'wx', width: 100, render: (_: any, r: any) => r.customFields?.customerWechat || r.customer?.wechatId || '-' },
      { title: '所用微信', key: 'workWechat', width: 90, render: (_: any, r: any) => {
        const wx = r.customFields?.workWechatName || r.customFields?.workWechatId;
        return wx ? <Tag color="cyan" style={{fontSize:10,margin:0}}>📱{wx}</Tag> : <Text type="secondary" style={{fontSize:10}}>-</Text>;
      }},
      { title: '状态', key: 'status', width: 70, render: (_: any, r: any) => <Tag color={statusConfig[r.status]?.color} style={{fontSize:11}}>{statusConfig[r.status]?.label||r.status}</Tag> },
      ...(showCompanion ? [{ title: '接单人', key: 'c', width: 70, render: (_: any, r: any) => r.companion?.user?.username || '-' }] : []),
      { title: '来源/时间', key: 'source', width: 100, render: (_: any, r: any) => {
        const cf = r.customFields;
        return <>{cf?.customerSource ? <Tag color="orange" style={{fontSize:10,margin:'0 0 2px 0'}}>{cf.customerSource}</Tag> : null}<br /><Text type="secondary" style={{fontSize:10}}>{r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-'}</Text></>;
      }},
      ...(renderActions ? [{ title: '操作', key: 'action', width: 160, render: (_: any, r: any) => <Space size="small" wrap>{renderActions(r)}</Space> }] : []),
    ]}
  />
);

export default OrderTable;
