import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Tag, Space, Typography, message, Popconfirm, Spin, Statistic, Row, Col } from 'antd';
import { ReloadOutlined, CloudUploadOutlined, CheckCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { agentApi } from '../../api/agent';

const { Text, Title } = Typography;

interface CompanionVersion {
  companionId: string;
  name: string;
  status: string;
  agentVersion: string;
  lastHeartbeat: string | null;
  isLatest: boolean;
}

interface VersionStatus {
  latestVersion: string;
  onlineCount: number;
  upToDateCount: number;
  pendingCount: number;
  list: CompanionVersion[];
}

const statusColors: Record<string, string> = {
  AVAILABLE: 'green',
  BUSY: 'red',
  ENTERTAINMENT: 'gold',
  RESTING: 'orange',
  OFFLINE: 'default',
  ONLINE: 'blue',
};

const statusLabels: Record<string, string> = {
  AVAILABLE: '空闲',
  BUSY: '接单中',
  ENTERTAINMENT: '娱乐',
  RESTING: '休息',
  OFFLINE: '离线',
  ONLINE: '在线',
};

const AgentVersionPage: React.FC = () => {
  const [versionStatus, setVersionStatus] = useState<VersionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await agentApi.getVersionStatus();
      setVersionStatus(data.data as VersionStatus);
    } catch {
      message.error('加载版本状态失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleBuildAndPush = async () => {
    setBuilding(true);
    try {
      const { data } = await agentApi.buildAndPush();
      if (data.code === 200) {
        message.success(data.message || '构建成功，已推送');
        fetchStatus();
      } else {
        message.error(data.data?.output || data.message || '构建失败');
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || '构建请求失败');
    } finally {
      setBuilding(false);
    }
  };

  const columns = [
    {
      title: '陪玩',
      dataIndex: 'name',
      key: 'name',
      width: 140,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (s: string) => (
        <Tag color={statusColors[s] || 'default'}>{statusLabels[s] || s}</Tag>
      ),
    },
    {
      title: '当前版本',
      dataIndex: 'agentVersion',
      key: 'agentVersion',
      width: 100,
    },
    {
      title: '版本状态',
      key: 'versionStatus',
      width: 100,
      render: (_: unknown, r: CompanionVersion) =>
        r.isLatest ? (
          <Tag color="green" icon={React.createElement(CheckCircleOutlined)}>最新</Tag>
        ) : (
          <Tag color="orange" icon={React.createElement(SyncOutlined)}>待更新</Tag>
        ),
    },
    {
      title: '最后心跳',
      dataIndex: 'lastHeartbeat',
      key: 'lastHeartbeat',
      width: 160,
      render: (hb: string | null) => {
        if (!hb) return <Text type="secondary">-</Text>;
        const dt = new Date(hb);
        const diff = Date.now() - dt.getTime();
        const online = diff < 120000;
        return (
          <Space size={4}>
            <span style={{ color: online ? '#52c41a' : '#d9d9d9', fontSize: 12 }}>●</span>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {dt.toLocaleString('zh-CN')}
            </Text>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>版本管理</Title>
          <Text type="secondary">管理陪玩客户端版本，一键构建并推送更新</Text>
        </div>
        <Space>
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetchStatus} loading={loading}>刷新</Button>
          <Popconfirm
            title="确认构建并推送？"
            description="将执行 git pull + 构建，完成后自动推送到所有在线陪玩"
            onConfirm={handleBuildAndPush}
            okText="确认"
            cancelText="取消"
          >
            <Button type="primary" icon={React.createElement(CloudUploadOutlined)} loading={building}>
              构建并推送
            </Button>
          </Popconfirm>
        </Space>
      </div>

      {/* Stat Cards */}
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="最新版本" value={versionStatus?.latestVersion || '-'} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="在线陪玩" value={versionStatus?.onlineCount || 0} suffix="人" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="已是最新" value={versionStatus?.upToDateCount || 0} valueStyle={{ color: '#52c41a' }} suffix="人" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="待更新" value={versionStatus?.pendingCount || 0} valueStyle={{ color: '#faad14' }} suffix="人" />
          </Card>
        </Col>
      </Row>

      {/* Version Table */}
      <Card
        title="陪玩版本分布"
        extra={<Text type="secondary">共 {versionStatus?.list?.length || 0} 条记录</Text>}
      >
        <Table
          columns={columns}
          dataSource={versionStatus?.list || []}
          rowKey="companionId"
          loading={loading}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 位陪玩` }}
          locale={{ emptyText: '暂无数据' }}
        />
      </Card>
    </div>
  );
};

export default AgentVersionPage;
