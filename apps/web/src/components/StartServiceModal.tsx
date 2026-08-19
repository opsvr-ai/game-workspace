// craftsman-ignore: TS001,TS002,TS003
import React, { useEffect, useState } from 'react';
import { Modal, Select, InputNumber, Button, Row, Col, Radio, message, Upload, Typography } from 'antd';
import { CameraOutlined } from '@ant-design/icons';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import { monitorApi } from '../api/monitor';
import { useAuthStore } from '../stores/authStore';

const { Text } = Typography;

interface Props {
  open: boolean;
  orderId: string | null;
  customerId?: string | null;
  gameName?: string;
  initialValues?: {
    dual?: boolean;
    coId?: string;
    coPrice?: number | null;
    claimMode?: string;
    claimPrice?: number | null;
    claimDuration?: number;
  };
  onClose: () => void;
  onDone: () => void;
}

const StartServiceModal: React.FC<Props> = ({ open, orderId, customerId, gameName, initialValues, onClose, onDone }) => {
  const user = useAuthStore((s) => s.user);
  const [dual, setDual] = useState(false);
  const [partnerMode, setPartnerMode] = useState<'assign' | 'broadcast'>('assign');
  const [coId, setCoId] = useState<string | undefined>();
  const [coPrice, setCoPrice] = useState<number | null>(null);
  const [companions, setCompanions] = useState<any[]>([]);
  const [claimMode, setClaimMode] = useState('机密');
  const [claimPrice, setClaimPrice] = useState<number | null>(35);
  const [claimDuration, setClaimDuration] = useState<number>(1);
  const [transferUrl, setTransferUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);

  const loadCompanions = async () => {
    try {
      const { data } = await companionsApi.list({ includeBridged: true });
      setCompanions((data.data || []).filter((c: any) => c.status === 'AVAILABLE'));
    } catch {
      setCompanions([]);
    }
  };

  useEffect(() => {
    if (open) {
      setDual(initialValues?.dual ?? false);
      setCoId(initialValues?.coId);
      setCoPrice(initialValues?.coPrice ?? null);
      setClaimMode(initialValues?.claimMode ?? '机密');
      setClaimPrice(initialValues?.claimPrice ?? 35);
      setClaimDuration(initialValues?.claimDuration ?? 1);
      setPartnerMode('assign');
      setTransferUrl('');
      loadCompanions();
    }
  }, [open]);

  const uploadTransfer = async (file: File) => {
    setUploading(true);
    try {
      const res: any = await monitorApi.uploadTransferScreenshot(file);
      const url = res.data?.data?.url;
      if (url) {
        setTransferUrl(url);
        message.success('转账截图已上传');
      } else {
        message.error('上传失败');
      }
    } catch (e: any) {
      message.error(`上传失败：${e?.response?.data?.message || e?.message || '未知错误'}`);
    }
    setUploading(false);
    return false;
  };

  const handleStart = async () => {
    if (!orderId && !customerId) return;
    if (!transferUrl) return message.warning('请先上传客户转账截图');
    if (!claimDuration || claimDuration <= 0) return message.warning('请填写有效时长');
    if (claimPrice == null || claimPrice <= 0) return message.warning('请填写单价');
    if (dual && partnerMode === 'assign' && !coId) return message.warning('双陪请选择搭档');
    if (dual && (coPrice == null || coPrice <= 0)) return message.warning('双陪请填写搭档单价');

    const price = claimPrice;
    setStarting(true);
    try {
      let sessionId: string | undefined;
      if (customerId && !orderId) {
        // 复购：先创建直接派单（会自动建会话），再开始会话
        const orderRes: any = await ordersApi.create({
          type: 'REPURCHASE',
          dispatchType: 'DIRECT',
          companionId: user?.companionId,
          customerId,
          gameName: gameName || '三角洲行动',
          amount: price * claimDuration,
          duration: claimDuration,
          coCompanionId: dual && partnerMode === 'assign' ? coId : undefined,
          coAmount: dual ? (coPrice ?? 0) * claimDuration : undefined,
          deltaMission: claimMode,
          deltaCount: dual ? '双' : '单',
        });
        const newOrder = orderRes?.data?.data;
        if (!newOrder?.id) {
          message.error('创建订单失败');
          setStarting(false);
          return;
        }
        const sessionsRes: any = await ordersApi.getSessions(newOrder.id);
        sessionId = sessionsRes?.data?.data?.[0]?.id;
      } else {
        const res: any = await ordersApi.addSession(orderId!, {
          amount: price * claimDuration,
          duration: claimDuration,
          coCompanionId: dual && partnerMode === 'assign' ? coId : undefined,
          coAmount: dual ? (coPrice ?? 0) * claimDuration : undefined,
          claimedMode: claimMode,
          claimedPrice: price,
          transferScreenshotUrl: transferUrl,
        });
        sessionId = res?.data?.data?.id || res?.data?.id;
      }
      if (!sessionId) {
        message.error('创建会话失败');
        setStarting(false);
        return;
      }
      if (dual) {
        if (partnerMode === 'broadcast') {
          await ordersApi.broadcastPartnerInvite(sessionId);
          message.success('已广播找搭档，等待搭档接受');
        } else {
          message.success('已邀请搭档，等待对方确认后开始计时');
        }
      } else {
        await ordersApi.startSession(sessionId, {
          claimedMode: claimMode,
          claimedPrice: price,
          duration: claimDuration,
          transferScreenshotUrl: transferUrl,
        });
        (window as any).electronAPI?.sessionWatch?.(sessionId);
        message.success('服务已开始，工作记录已开启');
      }
      onDone();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '开始失败');
    }
    setStarting(false);
  };

  return (
    <Modal
      open={open}
      title={`首单${gameName ? ` · ${gameName}` : ''}`}
      onOk={handleStart}
      onCancel={onClose}
      confirmLoading={starting}
      okText="开始首单并开启工作记录"
      cancelText="取消"
      width={480}
      destroyOnClose
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
          <InputNumber min={0} style={{ width: '100%' }} value={claimPrice ?? undefined} onChange={(v) => setClaimPrice(v ?? null)} prefix="¥" placeholder="？/人/h" />
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
              <Text>找搭档方式</Text>
              <div>
                <Radio.Group size="small" value={partnerMode} onChange={(e) => setPartnerMode(e.target.value)}>
                  <Radio.Button value="assign">👤 指定</Radio.Button>
                  <Radio.Button value="broadcast">📣 广播</Radio.Button>
                </Radio.Group>
              </div>
            </Col>
            <Col span={12}>
              <Text>搭档单价（元/小时）</Text>
              <InputNumber min={0} style={{ width: '100%' }} value={coPrice ?? undefined} onChange={(v) => setCoPrice(v ?? null)} prefix="¥" placeholder="？/人/h" />
            </Col>
          </Row>
          {partnerMode === 'assign' && (
            <Row gutter={12} align="middle" style={{ marginTop: 8 }}>
              <Col span={24}>
                <Text>搭档</Text>
                <Select style={{ width: '100%' }} value={coId} onChange={setCoId} placeholder="选择搭档" allowClear>
                  {companions.filter((c: any) => c.id !== user?.companionId).map((c: any) => (
                    <Select.Option key={c.id} value={c.id}>{c.user?.displayName || c.user?.username}</Select.Option>
                  ))}
                </Select>
              </Col>
            </Row>
          )}
        </>
      )}
      <div style={{ marginTop: 12 }}>
        <Text>客户转账截图（必传）</Text>
        <div style={{ marginTop: 4 }}>
          <Upload beforeUpload={uploadTransfer} showUploadList={false} accept="image/*">
            <Button icon={<CameraOutlined />} loading={uploading}>
              {transferUrl ? '重新上传转账截图' : '上传转账截图'}
            </Button>
          </Upload>
          {transferUrl && <a href={transferUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>查看已上传截图</a>}
        </div>
      </div>
      <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
        服务期间将自动开启工作记录（随机截图），请保持客户端运行。
      </Text>
    </Modal>
  );
};

export default StartServiceModal;
