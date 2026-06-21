import React, { useEffect, useState, useCallback } from 'react';
import { Table, Tag, Typography, Button, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { CompanionStatus } from '@chunlv/shared';
import { companionsApi } from '../../api/companions';

const { Text } = Typography;

const statusConfig: Record<
  CompanionStatus,
  { color: string; label: string }
> = {
  [CompanionStatus.ONLINE]: { color: 'red', label: '在线' },
  [CompanionStatus.IDLE]: { color: 'green', label: '空闲' },
  [CompanionStatus.BUSY]: { color: 'gold', label: '忙碌' },
  [CompanionStatus.OFFLINE]: { color: 'default', label: '离线' },
};

interface Companion {
  id: string;
  username: string;
  status: CompanionStatus;
  games?: string[];
  monthlyIncome?: number;
}

const CompanionsStatusPage: React.FC = () => {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCompanions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await companionsApi.list();
      setCompanions(data.data ?? []);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || '加载陪玩状态失败';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompanions();
  }, [fetchCompanions]);

  const columns = [
    {
      title: '姓名',
      dataIndex: 'username',
      key: 'username',
      width: 120,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: CompanionStatus) => {
        const cfg = statusConfig[status];
        return <Tag color={cfg?.color}>{cfg?.label ?? status}</Tag>;
      },
    },
    {
      title: '擅长游戏',
      dataIndex: 'games',
      key: 'games',
      render: (games: string[] | undefined) =>
        games && games.length > 0 ? (
          <Space size={4} wrap>
            {games.map((g) => (
              <Tag key={g}>{g}</Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '当月收入',
      dataIndex: 'monthlyIncome',
      key: 'monthlyIncome',
      width: 130,
      render: (val: number | undefined) =>
        val != null ? `¥${val.toFixed(2)}` : '-',
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Text strong style={{ fontSize: 16 }}>
          陪玩状态
        </Text>
        <Button
          icon={React.createElement(ReloadOutlined)}
          onClick={fetchCompanions}
          loading={loading}
        >
          刷新
        </Button>
      </div>

      {error && (
        <div
          style={{
            color: '#ff4d4f',
            background: '#fff2f0',
            border: '1px solid #ffccc7',
            borderRadius: 6,
            padding: '8px 12px',
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <Table
        columns={columns}
        dataSource={companions}
        rowKey="id"
        loading={loading}
        locale={{ emptyText: '暂无陪玩数据' }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 位陪玩` }}
      />
    </div>
  );
};

export default CompanionsStatusPage;
