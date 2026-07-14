import React, { useEffect, useState, useCallback } from 'react';
import {
  Table,
  Button,
  Space,
  Typography,
  Tag,
  message,
  Segmented,
  Input,
} from 'antd';
import {
  CheckOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { UserRole } from '@chunlv/shared';
import { employeesApi } from '../../api/employees';
import { authApi } from '../../api/client';

const { Text } = Typography;

const roleLabel: Record<string, string> = {
  [UserRole.ADMIN]: '管理员',
  [UserRole.CS]: '客服',
  [UserRole.COMPANION]: '陪玩',
};

const roleColor: Record<string, string> = {
  [UserRole.ADMIN]: '#1677ff',
  [UserRole.CS]: '#08979c',
  [UserRole.COMPANION]: '#722ed1',
};

interface Employee {
  id: string;
  username: string;
  role: string;
  isAuthorized: boolean;
  createdAt: string;
  studio?: { id: string; name: string };
}

const AuthorizationsPage: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('pending');
  const [searchText, setSearchText] = useState('');
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set());

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await employeesApi.list();
      const list: Employee[] = (data.data as any[]) ?? [];
      setEmployees(list);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '加载员工列表失败';
      setError(msg);
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const handleApprove = async (userId: string) => {
    setApprovingIds((prev) => new Set(prev).add(userId));
    try {
      await authApi.authorizeUser(userId);
      message.success('审核通过');
      fetchEmployees();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '操作失败';
      message.error(msg);
    } finally {
      setApprovingIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const filteredEmployees = employees.filter((e) => {
    const matchAuth = filter === 'pending' ? !e.isAuthorized : e.isAuthorized;
    const matchSearch = !searchText
      || (e.username || '').toLowerCase().includes(searchText.toLowerCase())
      || (roleLabel[e.role] || '').includes(searchText)
      || (e.studio?.name || '').toLowerCase().includes(searchText.toLowerCase());
    return matchAuth && matchSearch;
  });

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 100,
      render: (role: string) => (
        <Tag color={roleColor[role] || 'default'}>
          {roleLabel[role] || role}
        </Tag>
      ),
    },
    {
      title: '工作室',
      key: 'studio',
      render: (_: unknown, record: Employee) =>
        record.studio?.name ?? <Text type="secondary">未分配</Text>,
    },
    {
      title: '注册时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (val: string) => (val ? new Date(val).toLocaleString('zh-CN') : '-'),
    },
    ...(filter === 'pending'
      ? [
          {
            title: '操作',
            key: 'actions',
            width: 140,
            render: (_: unknown, record: Employee) => (
              <Button
                type="primary"
                size="small"
                icon={React.createElement(CheckOutlined)}
                loading={approvingIds.has(record.id)}
                onClick={() => handleApprove(record.id)}
              >
                通过审核
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <Text strong style={{ fontSize: 16 }}>
          客户端授权
        </Text>
        <Space>
          <Input.Search
            placeholder="搜索用户名/角色/工作室"
            allowClear
            style={{ width: 220 }}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            prefix={React.createElement(SearchOutlined)}
          />
          <Segmented
            options={[
              { label: '待审核', value: 'pending' },
              { label: '已授权', value: 'authorized' },
            ]}
            value={filter}
            onChange={(val) => setFilter(val as string)}
          />
          <Button
            icon={React.createElement(ReloadOutlined)}
            onClick={fetchEmployees}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>

      {error && (
        <div
          style={{
            color: '#ff4d4f',
            background: '#fff2f0',
            border: '1px solid #ffccc7',
            borderRadius: 6,
            padding: '8px 12px',
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      <Table
        columns={columns}
        dataSource={filteredEmployees}
        rowKey="id"
        loading={loading}
        locale={{ emptyText: filter === 'pending' ? '暂无待审核用户' : '暂无已授权用户' }}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
        }}
      />
    </div>
  );
};

export default AuthorizationsPage;
