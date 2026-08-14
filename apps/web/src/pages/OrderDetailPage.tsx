// craftsman-ignore: TS001,TS002,TS003
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Table, Button, Tag, Space, Typography, message, Modal, InputNumber, Select, Row, Col, Upload } from 'antd';
import { ArrowLeftOutlined, PlusOutlined, PlayCircleOutlined, StopOutlined, PauseCircleOutlined, CameraOutlined } from '@ant-design/icons';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import { monitorApi } from '../api/monitor';
import { companionStatusConfig } from '../constants';

const { Text, Title } = Typography;

interface Session {
  id: string; seq: number; companionId: string; coCompanionId?: string;
  amount: number; coAmount?: number; duration: number; status: string; createdAt: string;
  startedAt?: string; pausedAt?: string;
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

  // ── 开始服务：口供 + 转账截图 ──
  const [startTarget, setStartTarget] = useState<Session | null>(null);
  const [claimMode, setClaimMode] = useState<string>('机密');
  const [claimPrice, setClaimPrice] = useState<number>(35);
  const [transferUrl, setTransferUrl] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [endTarget, setEndTarget] = useState<Session | null>(null);
  const [endTransferTotal, setEndTransferTotal] = useState<number | undefined>(undefined);
  const [ending, setEnding] = useState(false);

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

  const openStartModal = (r: Session) => {
    setStartTarget(r);
    setClaimMode('机密');
    setClaimPrice(35);
    setTransferUrl('');
  };

  const handleUploadTransfer = async (file: File) => {
    setUploading(true);
    try {
      const res: any = await monitorApi.uploadTransferScreenshot(file);
      const url = res.data?.data?.url;
      if (url) { setTransferUrl(url); message.success('转账截图已上传'); }
      else message.error('上传失败');
    } catch { message.error('上传失败'); }
    setUploading(false);
    return false; // 阻止 antd 自动上传
  };

  const handleStartService = async () => {
    if (!startTarget) return;
    if (!transferUrl) { message.warning('请先上传客户转账截图'); return; }
    setStarting(true);
    try {
      await ordersApi.startSession(startTarget.id, {
        claimedMode: claimMode,
        claimedPrice: claimPrice,
        transferScreenshotUrl: transferUrl,
      });
      // 通知 Electron 开始工作记录截图
      (window as any).electronAPI?.sessionWatch?.(startTarget.id);
      message.success('服务已开始，工作记录已开启');
      setStartTarget(null);
      fetch();
    } catch { message.error('开始失败'); }
    setStarting(false);
  };

  const handleEndService = async (r: Session) => {
    setEndTarget(r);
    setEndTransferTotal(undefined);
  };

  const confirmEndService = async () => {
    if (!endTarget) return;
    // 先停截图并等待全部截图上传完成
    try { await (window as any).electronAPI?.sessionWatchStop?.(); } catch {}
    setEnding(true);
    try {
      await ordersApi.finishSession(endTarget.id, { transferTotalYuan: endTransferTotal });
      message.success('已结束');
      setEndTarget(null);
      fetch();
    } catch { message.error('结束失败'); }
    setEnding(false);
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
        {!r.startedAt ? <Button size="small" type="primary" icon={<CameraOutlined />} onClick={() => openStartModal(r)}>开始服务</Button> : null}
        {r.startedAt && !r.pausedAt ? <Button size="small" icon={<PauseCircleOutlined />} onClick={async () => { await ordersApi.pauseSession(r.id); fetch(); message.success('已暂停'); }}>暂停</Button> : null}
        {r.pausedAt ? <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={async () => { await ordersApi.resumeSession(r.id); fetch(); message.success('已继续'); }}>继续</Button> : null}
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

      {/* 开始服务：口供 + 转账截图 */}
      <Modal
        title="开始服务"
        open={!!startTarget}
        onOk={handleStartService}
        onCancel={() => setStartTarget(null)}
        confirmLoading={starting}
        okText="开始服务并开启工作记录"
      >
        <Row gutter={12} align="middle">
          <Col span={12}>
            <Text>游戏模式</Text>
            <Select style={{ width: '100%' }} value={claimMode} onChange={setClaimMode}>
              <Select.Option value="机密">机密</Select.Option>
              <Select.Option value="绝密">绝密</Select.Option>
            </Select>
          </Col>
          <Col span={12}>
            <Text>单价（元/小时）</Text>
            <InputNumber min={0} style={{ width: '100%' }} value={claimPrice} onChange={(v) => setClaimPrice(v || 0)} prefix="¥" />
          </Col>
        </Row>
        <div style={{ marginTop: 12 }}>
          <Text>客户转账截图（必传）</Text>
          <div style={{ marginTop: 4 }}>
            <Upload
              beforeUpload={handleUploadTransfer}
              showUploadList={false}
              accept="image/*"
            >
              <Button icon={<CameraOutlined />} loading={uploading}>
                {transferUrl ? '重新上传转账截图' : '上传转账截图'}
              </Button>
            </Upload>
            {transferUrl && (
              <a href={transferUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>
                查看已上传截图
              </a>
            )}
          </div>
        </div>
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          服务期间将自动开启工作记录（随机截图），请保持客户端运行。
        </Text>
      </Modal>

      {/* 结束服务：实收转账合计 */}
      <Modal
        title="结束服务"
        open={!!endTarget}
        onOk={confirmEndService}
        onCancel={() => setEndTarget(null)}
        confirmLoading={ending}
        okText="确认结束"
      >
        <Text>请填写客户本次实际转账合计（微信 + 支付宝，元）</Text>
        <div style={{ marginTop: 8 }}>
          <InputNumber
            min={0}
            step={10}
            precision={2}
            style={{ width: '100%' }}
            value={endTransferTotal}
            onChange={(v) => setEndTransferTotal(v ?? undefined)}
            prefix="¥"
            placeholder="留空则记为待核对"
          />
        </div>
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          转账合计低于「填写时长 × 单价」将被标记异常，供管理端复核。
        </Text>
      </Modal>
    </div>
  );
};

export default OrderDetailPage;
