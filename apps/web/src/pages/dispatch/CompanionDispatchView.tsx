// craftsman-ignore: TS001,TS002
import React, { useState, useCallback, useEffect } from 'react';
import {
  Button,
  Select,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ordersApi } from '../../api/orders';
import OrderTable from '../../components/OrderTable';
import { orderStatusConfig } from '../../constants';

const { Text } = Typography;
const { Option } = Select;

const CompanionDispatchView: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { all: 'true' };
      if (statusFilter) params.status = statusFilter;
      const { data } = await ordersApi.list(params);
      setOrders(data.data?.items ?? data.data ?? []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <Text strong style={{ fontSize: 16 }}>
            派单记录
          </Text>
          <br />
          <Text type="secondary">查看全部派单历史</Text>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            placeholder="全部状态"
            allowClear
            value={statusFilter || undefined}
            onChange={(v) => setStatusFilter(v || '')}
            style={{ width: 120 }}
          >
            {Object.entries(orderStatusConfig).map(([k, v]) => (
              <Option key={k} value={k}>
                {v.label}
              </Option>
            ))}
          </Select>
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetch} loading={loading}>
            刷新
          </Button>
        </div>
      </div>
      <OrderTable dataSource={orders} loading={loading} />{' '}
    </div>
  );
};

export default CompanionDispatchView;
