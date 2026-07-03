import React, { useState, useEffect, useCallback } from 'react';
import { Table, Tag, Typography, Button, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import http from '../../api/client';

const { Text } = Typography;

const CustomersPage: React.FC = () => {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await http.get('/customers');
      setCustomers(data.data ?? []);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div><Text strong style={{ fontSize: 16 }}>客户管理</Text><br /><Text type="secondary">管理我的客户信息</Text></div>
        <Button icon={React.createElement(ReloadOutlined)} onClick={fetch} loading={loading}>刷新</Button>
      </div>
      <Table size="small" dataSource={customers} rowKey="id" loading={loading}
        columns={[
          { title: '客户编号', dataIndex: 'customerCode', width: 100 },
          { title: '微信号', dataIndex: 'wechatId', width: 150 },
          { title: '平台', dataIndex: 'platform', width: 80, render: (v: string) => v ? <Tag>{v}</Tag> : '-' },
          { title: '平台账号', dataIndex: 'platformAccount', width: 120, render: (v: string) => v || '-' },
          { title: '累计消费', dataIndex: 'totalSpent', width: 120, render: (v: number) => <span style={{ color: '#FF4757', fontWeight: 600 }}>¥{v?.toFixed(2) || '0.00'}</span> },
          { title: '状态', dataIndex: 'status', width: 90, render: (s: string) => {
            const m: Record<string,{color:string;label:string}> = { ACTIVE:{color:'green',label:'活跃'}, FOLLOW_UP:{color:'blue',label:'跟进'}, LOST:{color:'red',label:'流失'}, PENDING_DEVELOPMENT:{color:'orange',label:'待开发'} };
            return <Tag color={m[s]?.color}>{m[s]?.label||s}</Tag>;
          }},
          { title: '备注', dataIndex: 'notes', render: (v: string) => v || '-' },
        ]}
        pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 位客户` }}
      />
    </div>
  );
};

export default CustomersPage;
