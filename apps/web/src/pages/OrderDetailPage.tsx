// craftsman-ignore: TS001,TS002,TS003
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, Table, Button, Tag, Space, Typography, message, Modal, InputNumber, Select, Row, Col, Upload, notification } from 'antd';
import { ArrowLeftOutlined, PlayCircleOutlined, StopOutlined, PauseCircleOutlined, CameraOutlined } from '@ant-design/icons';
import { ordersApi } from '../api/orders';
import { monitorApi } from '../api/monitor';
import { companionsApi } from '../api/companions';
import { useAuthStore } from '../stores/authStore';

const { Text, Title } = Typography;

interface Session {
  id: string; seq: number; companionId: string; coCompanionId?: string;
  amount: number; coAmount?: number; duration: number; status: string; createdAt: string;
  startedAt?: string; pausedAt?: string;
  claimedMode?: string; claimedPrice?: number;
  companion?: any; coCompanion?: any;
}

const OrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<any>(null);

  // ── 开始服务：口供 + 转账截图 ──
  const [startTarget, setStartTarget] = useState<Session | null>(null);
  const [isRenew, setIsRenew] = useState(false);
  const [dual, setDual] = useState(false);
  const [coId, setCoId] = useState<string | undefined>(undefined);
  const [coPrice, setCoPrice] = useState<number | null>(null);
  const [companions, setCompanions] = useState<any[]>([]);
  const [claimMode, setClaimMode] = useState<string>('机密');
  const [claimPrice, setClaimPrice] = useState<number | null>(35);
  const [claimDuration, setClaimDuration] = useState<number>(1);
  const [transferUrl, setTransferUrl] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [callingPartner, setCallingPartner] = useState(false);
  const [endTarget, setEndTarget] = useState<Session | null>(null);
  const [endTransferTotal, setEndTransferTotal] = useState<number | undefined>(undefined);
  const [ending, setEnding] = useState(false);
  const autoOpened = useRef(false);

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

  useEffect(() => { fetch(); }, [fetch]);

  const last = sessions[sessions.length - 1];
  const loadCompanions = async () => {
    try {
      const { data } = await companionsApi.list();
      setCompanions((data.data || []).filter((c: any) => c.status === 'AVAILABLE'));
    } catch {
      setCompanions([]);
    }
  };

  const openRenew = () => {
    // 续单：时长/模式沿用首单，单价留空让陪玩重新填
    setStartTarget(null);
    setIsRenew(true);
    setDual(false);
    setCoId(undefined);
    setCoPrice(null);
    setClaimMode(last?.claimedMode || '机密');
    setClaimPrice(null);
    setClaimDuration(last?.duration || 1);
    setTransferUrl('');
    loadCompanions();
  };

  const openStartModal = (r: Session | null) => {
    setStartTarget(r);
    setIsRenew(false);
    setDual(false);
    setCoId(undefined);
    setCoPrice(null);
    setClaimMode('机密');
    setClaimPrice(35);
    setClaimDuration(r?.duration || 1);
    setTransferUrl('');
    loadCompanions();
  };

  // 从客户管理「开始服务」跳转时自动弹出开始服务弹窗
  useEffect(() => {
    if (searchParams.get('start') === '1' && !loading && !autoOpened.current) {
      autoOpened.current = true;
      openStartModal(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading]);

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

  const handleCallPartner = async () => {
    if (!id) return;
    setCallingPartner(true);
    try {
      await ordersApi.callPartner(id);
      message.success('已向工作室发出找搭档请求，等待搭档接受');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '呼叫搭档失败');
    }
    setCallingPartner(false);
  };

  const handleStartService = async () => {
    if (!transferUrl) { message.warning('请先上传客户转账截图'); return; }
    if (!claimDuration || claimDuration <= 0) { message.warning('请填写有效时长'); return; }
    if (claimPrice == null || claimPrice <= 0) { message.warning('请填写单价'); return; }
    if (dual && !coId) { message.warning('双陪请先选择搭档，或点击下方「呼叫搭档」寻找搭档'); return; }
    if (dual && (coPrice == null || coPrice <= 0)) { message.warning('双陪请填写搭档单价'); return; }
    const price = claimPrice;
    setStarting(true);
    try {
      let targetId = startTarget?.id;
      if (!targetId) {
        const res: any = await ordersApi.addSession(id!, {
          amount: price * claimDuration,
          duration: claimDuration,
          coCompanionId: dual ? coId : undefined,
          coAmount: dual ? (coPrice ?? 0) * claimDuration : undefined,
        });
        targetId = res?.data?.data?.id || res?.data?.id;
      }
      if (!targetId) {
        message.error('创建会话失败');
        setStarting(false);
        return;
      }
      await ordersApi.startSession(targetId, {
        claimedMode: claimMode,
        claimedPrice: price,
        duration: claimDuration,
        transferScreenshotUrl: transferUrl,
      });
      // 通知 Electron 开始工作记录截图
      (window as any).electronAPI?.sessionWatch?.(targetId);
      if (isRenew) {
        notification.success({
          message: '🎉 祝贺你续单成功',
          description: '新的服务时段已开启，工作记录同步启动。',
          placement: 'bottomRight',
          duration: 4,
        });
      } else {
        message.success('服务已开始，工作记录已开启');
      }
      setStartTarget(null);
      setIsRenew(false);
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
      const nk = `renew-${endTarget.id}`;
      notification.success({
        key: nk,
        message: '🙌 祝你续单',
        placement: 'bottomRight',
        duration: 0,
        btn: (
          <Space>
            <Button
              size="small"
              type="primary"
              onClick={() => { notification.destroy(nk); openRenew(); }}
            >
              续单
            </Button>
            <Button
              size="small"
              onClick={() => { notification.destroy(nk); completeOrder(); }}
            >
              结束服务
            </Button>
          </Space>
        ),
      });
    } catch { message.error('结束失败'); }
    setEnding(false);
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
      <Card
        extra={
          last?.status !== 'ACTIVE'
            ? <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => openStartModal(null)}>开始服务</Button>
            : null
        }
      >
        <Table columns={cols} dataSource={sessions} rowKey="id" loading={loading} size="small" pagination={false} />
      </Card>
      {/* 开始服务：口供 + 转账截图 */}
      <Modal
        title={isRenew ? '续单' : '开始服务'}
        open={!!startTarget || isRenew}
        onOk={handleStartService}
        onCancel={() => { setStartTarget(null); setIsRenew(false); }}
        confirmLoading={starting}
        okText={isRenew ? '确认续单' : '开始服务并开启工作记录'}
      >
        <Row gutter={12} align="middle" style={{ marginBottom: 8 }}>
          <Col span={12}>
            <Text>单/双陪</Text>
            <div>
              <Button size="small" type={!dual ? 'primary' : 'default'} onClick={() => setDual(false)} style={{ marginRight: 8 }}>单陪</Button>
              <Button size="small" type={dual ? 'primary' : 'default'} onClick={() => setDual(true)}>双陪</Button>
            </div>
          </Col>
          <Col span={12}>
            <Text>游戏模式</Text>
            <Select style={{ width: '100%' }} value={claimMode} onChange={setClaimMode}>
              <Select.Option value="机密">机密</Select.Option>
              <Select.Option value="绝密">绝密</Select.Option>
            </Select>
          </Col>
        </Row>
        <Row gutter={12} align="middle">
          <Col span={12}>
            <Text>单价（元/小时）</Text>
            <InputNumber min={0} style={{ width: '100%' }} value={claimPrice ?? undefined} onChange={(v) => setClaimPrice(v ?? null)} prefix="¥" placeholder={isRenew ? '续单价格会变，请重新填写' : ''} />
          </Col>
          <Col span={12}>
            <Text>实际时长（小时）</Text>
            <InputNumber min={0.5} step={0.5} style={{ width: '100%' }} value={claimDuration} onChange={(v) => setClaimDuration(v || 0)} placeholder="至少 0.5 小时" />
          </Col>
        </Row>
        {dual && (
          <>
            <Row gutter={12} align="middle" style={{ marginTop: 8 }}>
              <Col span={12}>
                <Text>搭档</Text>
                <Select
                  style={{ width: '100%' }}
                  value={coId}
                  onChange={setCoId}
                  placeholder="选择搭档"
                  allowClear
                >
                  {companions
                    .filter((c: any) => c.id !== user?.companionId)
                    .map((c: any) => (
                      <Select.Option key={c.id} value={c.id}>
                        {c.user?.displayName || c.user?.username}
                      </Select.Option>
                    ))}
                </Select>
              </Col>
              <Col span={12}>
                <Text>搭档单价（元/小时）</Text>
                <InputNumber min={0} style={{ width: '100%' }} value={coPrice ?? undefined} onChange={(v) => setCoPrice(v ?? null)} prefix="¥" placeholder="？/人/h" />
              </Col>
            </Row>
            <div style={{ marginTop: 8 }}>
              <Button block size="small" loading={callingPartner} onClick={handleCallPartner}>
                📣 呼叫搭档（找不到搭档时点这里）
              </Button>
            </div>
          </>
        )}
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
