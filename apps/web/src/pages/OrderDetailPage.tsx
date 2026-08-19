// craftsman-ignore: TS001,TS002,TS003
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Table, Button, Tag, Space, Typography, message } from 'antd';
import { ArrowLeftOutlined, StopOutlined, PauseCircleOutlined } from '@ant-design/icons';
import { ordersApi } from '../api/orders';
import ServiceTimer from '../components/ServiceTimer';
import EndServiceModal from '../components/EndServiceModal';

const { Text, Title } = Typography;

interface Session {
  id: string; seq: number; companionId: string; coCompanionId?: string;
  amount: number; coAmount?: number; duration: number; status: string; createdAt: string;
  startedAt?: string; pausedAt?: string;
  claimedMode?: string; claimedPrice?: number;
  companion?: any; coCompanion?: any;
}

// 订单详情页已简化为「查看会话 + 结束服务」，不再从这里开始服务。
// 开始服务（首单/续单/复购）统一走客户管理里的弹窗。
const OrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<any>(null);
  const [endTarget, setEndTarget] = useState<{ sessionId: string; orderId?: string } | null>(null);

  const fetch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [sRes, oRes] = await Promise.all([
        ordersApi.getSessions(id),
        ordersApi.getOrder(id),
      ]);
      setSessions((sRes.data as any).data || []);
      setOrder((oRes.data as any).data || { gameName: '?', id });
    } catch { /* */ }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetch(); }, [fetch]);

  // 搭档邀请 20 秒未接受自动取消后，刷新会话列表让「取消邀请」按钮消失
  useEffect(() => {
    const onExpired = () => fetch();
    window.addEventListener('chunlv:dual-invite-expired', onExpired);
    return () => window.removeEventListener('chunlv:dual-invite-expired', onExpired);
  }, [fetch]);

  const handleEndService = (r: Session) => {
    setEndTarget({ sessionId: r.id, orderId: id });
  };

  const cancelPendingSession = async (r: Session) => {
    try {
      await ordersApi.endSession(r.id);
      message.success('已取消搭档邀请');
      fetch();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '取消失败');
    }
  };

  const completeOrder = async () => {
    if (!id) return;
    try {
      await ordersApi.complete(id);
      message.success('本单已结束服务');
      fetch();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '结束服务失败');
    }
  };

  const last = sessions[sessions.length - 1];

  const cols = [
    { title: '#', dataIndex: 'seq', width: 40 },
    { title: '主陪', render: (_: any, r: Session) => r.companion?.user?.displayName || r.companion?.user?.username || '-' },
    { title: '搭档', render: (_: any, r: Session) => r.coCompanion?.user?.displayName || r.coCompanion?.user?.username || '-' },
    { title: '金额', render: (_: any, r: Session) => r.coAmount ? `¥${r.amount}+¥${r.coAmount}` : `¥${r.amount}` },
    { title: '时长', dataIndex: 'duration', render: (v: number) => `${v}h` },
    { title: '状态', dataIndex: 'status', render: (s: string, r: Session) => (
      <Space size={4}>
        <Tag color={s === 'ACTIVE' ? 'blue' : 'green'}>{s === 'ACTIVE' ? '进行中' : '已完成'}</Tag>
        {s === 'ACTIVE' && r.startedAt && <ServiceTimer startedAt={r.startedAt} />}
      </Space>
    ) },
    { title: '时间', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString('zh-CN') },
    { title: '操作', render: (_: any, r: Session) => r.status === 'ACTIVE' ? (
      <Space>
        {!r.startedAt ? <Button size="small" danger onClick={() => cancelPendingSession(r)}>取消邀请</Button> : null}
        {r.startedAt && !r.pausedAt ? <Button size="small" icon={<PauseCircleOutlined />} onClick={async () => { await ordersApi.pauseSession(r.id); fetch(); message.success('已暂停'); }}>暂停</Button> : null}
        {r.pausedAt ? <Button size="small" type="primary" icon={<PauseCircleOutlined />} onClick={async () => { await ordersApi.resumeSession(r.id); fetch(); message.success('已继续'); }}>继续</Button> : null}
        {r.startedAt && !r.pausedAt ? <Button size="small" danger icon={<StopOutlined />} onClick={() => handleEndService(r)}>结束</Button> : null}
      </Space>
    ) : <Text type="secondary">{r.startedAt ? new Date(r.startedAt).toLocaleTimeString('zh-CN') : '-'}</Text> },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => nav(-1)}>返回</Button>
        <Title level={4} style={{ margin: 0 }}>订单详情</Title>
        <Text type="secondary">{order?.gameName}</Text>
      </Space>
      <Card
        extra={
          last?.status !== 'ACTIVE' && order?.status === 'CONFIRMED'
            ? <Button danger onClick={() => completeOrder()}>结束服务</Button>
            : null
        }
      >
        <Table columns={cols} dataSource={sessions} rowKey="id" loading={loading} size="small" pagination={false} />
      </Card>

      <EndServiceModal
        open={!!endTarget}
        sessionId={endTarget?.sessionId}
        orderId={endTarget?.orderId}
        onClose={() => setEndTarget(null)}
        onDone={() => fetch()}
      />
    </div>
  );
};

export default OrderDetailPage;
