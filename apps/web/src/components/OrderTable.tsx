import React from 'react';
import { Table, Tag, Typography, Space } from 'antd';
import { orderTypeConfig, orderStatusConfig, serviceTypeConfig } from '../constants';

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
      { title: '订单信息', key: 'info', width: 180, render: (_: any, r: any) => (<>
        <Text strong>{r.gameName}</Text>
        <br /><Text type="secondary" style={{ fontSize: 11 }}>
          {typeConfig[r.type]?.label || r.type} · ¥{Number(r.amount).toFixed(0)} · {r.duration}h
        </Text>
        <br /><Text type="secondary" style={{ fontSize: 10 }}>发布:{r.csUser?.username || '?'}</Text>
      </>)},
      { title: '客户信息', key: 'customer', width: 90, render: (_: any, r: any) => (<>
        <Text style={{ fontSize: 12 }}>{r.customFields?.customerWechat || r.customer?.wechatId || '-'}</Text>
        {r.customer?.customerCode && <><br /><Text type="secondary" style={{ fontSize: 10 }}>{r.customer.customerCode}</Text></>}
        {r.customFields?.workWechatId && <><br /><Tag color="cyan" style={{ fontSize: 10, margin: "2px 0" }}>📱{r.customFields.workWechatName || r.customFields.workWechatId}</Tag></>}
        {r.customFields?.customerSource && <><br /><Tag color="orange" style={{fontSize:10,margin:0}}>{r.customFields.customerSource}</Tag></>}
      </>)},
      { title: '标注', key: 'tags', width: 90, render: (_: any, r: any) => (<>
        {r.customFields?.urgency === 'later' ? <Tag color="purple" style={{fontSize:10,margin:'2px 0'}}>📅预约</Tag> : <Tag color="green" style={{fontSize:10,margin:'2px 0'}}>⚡立即打</Tag>}
        {r.customFields?.billingMode === 'round' && <Tag style={{fontSize:10,margin:'2px 0'}}>按局</Tag>}
        {(r.serviceType || r.customFields?.serviceType) && (
          <Tag color={serviceTypeConfig[(r.serviceType || r.customFields?.serviceType)]?.color} style={{fontSize:10,margin:'2px 0'}}>
            {serviceTypeConfig[(r.serviceType || r.customFields?.serviceType)]?.label || r.serviceType || r.customFields?.serviceType}
          </Tag>
        )}
      </>)},
      ...(showCompanion ? [{ title: '陪玩', key: 'c', width: 80, render: (_: any, r: any) => r.companion?.user?.username || '-' }] : []),
      { title: '状态', key: 'status', width: 100, render: (_: any, r: any) => (<>
        <Tag color={statusConfig[r.status]?.color}>{statusConfig[r.status]?.label||r.status}</Tag>
        {r.contactStatus === 'added' && <Tag color="green" style={{fontSize:10}}>已添加</Tag>}
        {r.contactStatus === 'not_accepted' && <Tag color="orange" style={{fontSize:10}}>未同意</Tag>}
        {r.scheduledAt && <div><Text type="secondary" style={{ fontSize: 10 }}>📅{new Date(r.scheduledAt).toLocaleDateString('zh-CN')}</Text></div>}
      </>)},
      { title: '时间', key: 'time', width: 100, render: (_: any, r: any) => (<Text type="secondary" style={{ fontSize: 10 }}>
        抢:{r.grabbedAt ? new Date(r.grabbedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-'}
        <br />创:{new Date(r.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
      </Text>)},
      ...(renderActions ? [{ title: '操作', key: 'action', width: 160, render: (_: any, r: any) => <Space size="small" wrap>{renderActions(r)}</Space> }] : []),
    ]}
  />
);

export default OrderTable;
