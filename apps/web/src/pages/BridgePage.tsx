// craftsman-ignore: TS002
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Tag, Tabs, message, Modal, Select, Space, Typography } from 'antd';
import { LinkOutlined, CheckOutlined, CloseOutlined, DisconnectOutlined } from '@ant-design/icons';
import { bridgeApi, BridgeInfo } from '../api/bridge';
import { studiosApi } from '../api/studios';
import { useAuthStore } from '../stores/authStore';

const { Text } = Typography;

export default function BridgePage() {
  const [bridges, setBridges] = useState<{ active: BridgeInfo[]; pending: BridgeInfo[] }>({ active: [], pending: [] });
  const [loading, setLoading] = useState(false);
  const [proposeVisible, setProposeVisible] = useState(false);
  const [targetStudioId, setTargetStudioId] = useState<string | null>(null);
  const [studios, setStudios] = useState<Array<{ id: string; name: string }>>([]);
  const user = useAuthStore((s) => s.user);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [bridgeRes, studioRes] = await Promise.all([bridgeApi.list(), studiosApi.list()]);
      setBridges(bridgeRes.data.data);
      setStudios(studioRes.data.data || []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePropose = async () => {
    if (!targetStudioId) return;
    try {
      await bridgeApi.propose(targetStudioId);
      message.success('桥接申请已发送');
      setProposeVisible(false);
      setTargetStudioId(null);
      fetchData();
    } catch {
      message.error('申请失败');
    }
  };

  const handleRespond = async (bridgeId: string, accept: boolean) => {
    try {
      await bridgeApi.respond(bridgeId, accept);
      message.success(accept ? '已同意桥接' : '已拒绝');
      fetchData();
    } catch {
      message.error('操作失败');
    }
  };

  const handleRemove = async (bridgeId: string) => {
    Modal.confirm({
      title: '断开桥接',
      content: '断开后将不再共享抢单池和聊天，确定继续？',
      onOk: async () => {
        try {
          await bridgeApi.remove(bridgeId);
          message.success('已断开桥接');
          fetchData();
        } catch {
          message.error('操作失败');
        }
      },
    });
  };

  const pendingColumns = [
    {
      title: '申请工作室',
      key: 'studio',
      render: (_: unknown, r: BridgeInfo) => {
        const isIncoming = r.studioBId === user?.studioId || r.studioAId === user?.studioId;
        const otherName = r.studioAId === user?.studioId ? r.studioB.name : r.studioA.name;
        return (
          <Text>
            {otherName} {isIncoming ? <Tag color="blue">待我处理</Tag> : <Tag>已发出</Tag>}
          </Text>
        );
      },
    },
    { title: '时间', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, r: BridgeInfo) => {
        const isIncoming =
          r.studioBId === user?.studioId || (r.studioAId === user?.studioId && r.proposedBy !== user?.id);
        if (!isIncoming) return <Tag>等待对方</Tag>;
        return (
          <Space>
            <Button
              size="small"
              type="primary"
              icon={React.createElement(CheckOutlined as any)}
              onClick={() => handleRespond(r.id, true)}
            >
              同意
            </Button>
            <Button
              size="small"
              danger
              icon={React.createElement(CloseOutlined as any)}
              onClick={() => handleRespond(r.id, false)}
            >
              拒绝
            </Button>
          </Space>
        );
      },
    },
  ];

  const activeColumns = [
    {
      title: '桥接工作室',
      key: 'studio',
      render: (_: unknown, r: BridgeInfo) => {
        const otherName = r.studioAId === user?.studioId ? r.studioB.name : r.studioA.name;
        return (
          <Text strong>
            <LinkOutlined /> {otherName}
          </Text>
        );
      },
    },
    { title: '开通时间', dataIndex: 'acceptedAt', render: (v: string) => (v ? new Date(v).toLocaleString() : '-') },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, r: BridgeInfo) => (
        <Button
          size="small"
          danger
          icon={React.createElement(DisconnectOutlined as any)}
          onClick={() => handleRemove(r.id)}
        >
          断开
        </Button>
      ),
    },
  ];

  // Filter out already-bridged studios from proposal list
  const bridgedIds = new Set(bridges.active.flatMap((b) => [b.studioAId, b.studioBId]));
  const pendingIds = new Set(bridges.pending.flatMap((b) => [b.studioAId, b.studioBId]));
  const availableStudios = studios.filter(
    (s) => s.id !== user?.studioId && !bridgedIds.has(s.id) && !pendingIds.has(s.id),
  );

  return (
    <Card title="工作室桥接管理">
      <Tabs
        tabBarExtraContent={
          <Button
            type="primary"
            icon={React.createElement(LinkOutlined as any)}
            onClick={() => setProposeVisible(true)}
          >
            申请桥接
          </Button>
        }
        items={[
          {
            key: 'active',
            label: `活跃桥接 (${bridges.active.length})`,
            children: <Table rowKey="id" columns={activeColumns} dataSource={bridges.active} loading={loading} />,
          },
          {
            key: 'pending',
            label: `待处理 (${bridges.pending.length})`,
            children: <Table rowKey="id" columns={pendingColumns} dataSource={bridges.pending} loading={loading} />,
          },
        ]}
      />
      <Modal
        title="申请工作室桥接"
        open={proposeVisible}
        onOk={handlePropose}
        onCancel={() => setProposeVisible(false)}
      >
        <Select
          style={{ width: '100%' }}
          placeholder="选择目标工作室"
          value={targetStudioId}
          onChange={setTargetStudioId}
          options={availableStudios.map((s) => ({ label: s.name, value: s.id }))}
        />
      </Modal>
    </Card>
  );
}
