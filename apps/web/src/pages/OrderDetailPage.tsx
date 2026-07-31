import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Table, Button, Tag, Space, Typography, message, Modal, InputNumber, Select, Row, Col } from 'antd';
import { ArrowLeftOutlined, PlusOutlined, PlayCircleOutlined, StopOutlined } from '@ant-design/icons';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import { companionStatusConfig } from '../constants';

const { Text, Title } = Typography;

interface Session {
  id: string; seq: number; companionId: string; coCompanionId?: string;
  amount: number; coAmount?: number; duration: number; status: string; createdAt: string;
  companion?: any; coCompanion?: any;
}

const OrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<any>(null);
  const [companions, setCompanions] = useState<any[]>([]);
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewAmount, setRenewAmount] = useState(0);
  const [renewCoAmount, setRenewCoAmount] = useState<number | undefined>(undefined);
  const [renewCoId, setRenewCoId] = useState<string | undefined>(undefined);
  const [renewing, setRenewing] = useState(false);

  const fetch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [sRes, oRes] = await Promise.all([
        ordersApi.getSessions(id),
        ordersApi.list({ page: 1, pageSize: 1 }),
      ]);
      setSessions((sRes.data as any).data || []);
      setOrder((oRes.data as any).data?.[0] || { gameName: '?', id });
    } catch { /* */ }
    setLoading(false);
  }, [id]);

  useEffect(() => { fetch(); companionsApi.list().then((r: any) => setCompanions(r.data?.data || [])).catch(()=>{}); }, [fetch]);

  const last = sessions[sessions.length - 1];
  const openRenew = () => {
    if (last) {
      setRenewAmount(last.amount);
      setRenewCoAmount(last.coAmount || undefined);
      setRenewCoId(last.coCompanionId || undefined);
    }
    setRenewOpen(true);
  };

  const handleRenew = async () => {
    if (!id) return;
    setRenewing(true);
    try {
      await ordersApi.addSession(id, {
        amount: renewAmount, coAmount: renewCoAmount, coCompanionId: renewCoId, duration: 1,
      });
      message.success('续费成功');
      setRenewOpen(false);
      fetch();
    } catch { message.error('续费失败'); }
    setRenewing(false);
  };

  const cols = [
    { title: '#', dataIndex: 'seq', width: 40 },
    { title: '主陪', render: (_: any, r: Session) => r.companion?.user?.displayName || r.companion?.user?.username || '-' },
    { title: '搭档', render: (_: any, r: Session) => r.coCompanion?.user?.displayName || r.coCompanion?.user?.username || '-' },
    { title: '金额', render: (_: any, r: Session) => r.coAmount ? `¥${r.amount}+¥${r.coAmount}` : `¥${r.amount}` },
    { title: '时长', dataIndex: 'duration', render: (v: number) => `${v}h` },
    { title: '状态', dataIndex: 'status', render: (s: string) => <Tag color={s === 'ACTIVE' ? 'blue' : 'green'}>{s === 'ACTIVE' ? '进行中' : '已完成'}</Tag> },
    { title: '时间', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString('zh-CN') },
    { title: '操作', render: (_: any, r: Session) => r.status === 'ACTIVE' ? (
      <Space>
        {!r.startedAt ? <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={async () => { await ordersApi.startSession(r.id); fetch(); message.success('计时开始'); }}>开始</Button> : null}
        {r.startedAt && !r.endedAt ? <Button size="small" danger icon={<StopOutlined />} onClick={async () => { await ordersApi.endSession(r.id); fetch(); message.success('已结束'); }}>结束</Button> : null}
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
      <Card extra={last?.status === 'ACTIVE' ? <Button type="primary" icon={<PlusOutlined />} onClick={openRenew}>续费一小时</Button> : null}>
        <Table columns={cols} dataSource={sessions} rowKey="id" loading={loading} size="small" pagination={false} />
      </Card>
      <Modal title="续费一小时" open={renewOpen} onOk={handleRenew} onCancel={() => setRenewOpen(false)} confirmLoading={renewing} okText="确认续费">
        <Row gutter={12}>
          <Col span={12}>
            <Text>主陪金额</Text>
            <InputNumber min={0} style={{ width: '100%' }} value={renewAmount} onChange={(v) => setRenewAmount(v || 0)} prefix="¥" />
          </Col>
          <Col span={12}>
            <Text>搭档</Text>
            <Select style={{ width: '100%' }} value={renewCoId} onChange={(v) => { setRenewCoId(v); if (!v) setRenewCoAmount(undefined); }} allowClear placeholder="无搭档">
              {companions.map((c: any) => <Select.Option key={c.id} value={c.id}>{c.user?.displayName || c.user?.username}</Select.Option>)}
            </Select>
          </Col>
        </Row>
        {renewCoId && (
          <Row style={{ marginTop: 8 }}>
            <Col span={12}>
              <Text>搭档金额</Text>
              <InputNumber min={0} style={{ width: '100%' }} value={renewCoAmount} onChange={(v) => setRenewCoAmount(v || undefined)} prefix="¥" />
            </Col>
          </Row>
        )}
      </Modal>
    </div>
  );
};

export default OrderDetailPage;
