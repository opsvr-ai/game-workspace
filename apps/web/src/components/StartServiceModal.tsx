// craftsman-ignore: TS001,TS002,TS003
import React, { useEffect, useState } from 'react';
import { Modal, Select, InputNumber, Button, Row, Col, Radio, Switch, message, notification, Upload, Typography } from 'antd';
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
  mode?: 'first' | 'renew' | 'repurchase';
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

const StartServiceModal: React.FC<Props> = ({ open, orderId, customerId, gameName, mode = 'first', initialValues, onClose, onDone }) => {
  const user = useAuthStore((s) => s.user);
  const [mainId, setMainId] = useState<string | undefined>(undefined);
  const [dual, setDual] = useState(false);
  const [partnerMode, setPartnerMode] = useState<'assign' | 'broadcast'>('assign');
  const [coId, setCoId] = useState<string | undefined>();
  const [coPrice, setCoPrice] = useState<number | null>(null);
  const [companions, setCompanions] = useState<any[]>([]);
  const [claimMode, setClaimMode] = useState('机密');
  const [claimPrice, setClaimPrice] = useState<number | null>(35);
  const [claimDuration, setClaimDuration] = useState<number>(1);
  const [transferUrl, setTransferUrl] = useState('');
  const [useDeposit, setUseDeposit] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);

  const loadCompanions = async () => {
    try {
      const { data } = await companionsApi.list({ includeBridged: true });
      setCompanions(data.data || []);
    } catch {
      setCompanions([]);
    }
  };

  useEffect(() => {
    if (open) {
      setMainId(user?.companionId || undefined);
      setDual(initialValues?.dual ?? false);
      setCoId(initialValues?.coId);
      setCoPrice(initialValues?.coPrice ?? null);
      setClaimMode(initialValues?.claimMode ?? '机密');
      setClaimPrice(initialValues?.claimPrice ?? 35);
      setClaimDuration(initialValues?.claimDuration ?? 1);
      setPartnerMode('assign');
      setTransferUrl('');
      setUseDeposit(false);
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
    if (!useDeposit && !transferUrl) return message.warning('请先上传客户转账截图，或选择用存单支付');
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
          companionId: mainId || user?.companionId,
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
          companionId: mainId || user?.companionId,
          amount: price * claimDuration,
          duration: claimDuration,
          coCompanionId: dual && partnerMode === 'assign' ? coId : undefined,
          coAmount: dual ? (coPrice ?? 0) * claimDuration : undefined,
          claimedMode: claimMode,
          claimedPrice: price,
          transferScreenshotUrl: transferUrl,
          useDeposit,
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
          notification.info({
            message: '📣 已广播找搭档',
            description: '等待搭档接受，20 秒未接受会自动取消',
            placement: 'bottomRight',
            duration: 5,
          });
        } else {
          const partnerName = companions.find((c: any) => c.id === coId)?.user?.displayName
            || companions.find((c: any) => c.id === coId)?.user?.username
            || '对方';
          notification.info({
            message: `🤝 已邀请 ${partnerName} 搭档`,
            description: '等待对方确认后开始计时，20 秒未接受会自动取消',
            placement: 'bottomRight',
            duration: 5,
          });
        }
      } else {
        const isHandoff = !!(mainId && mainId !== user?.companionId);
        await ordersApi.startSession(sessionId, {
          claimedMode: claimMode,
          claimedPrice: price,
          duration: claimDuration,
          transferScreenshotUrl: transferUrl,
          useDeposit,
        });
        if (!isHandoff) {
          (window as any).electronAPI?.sessionWatch?.(sessionId);
        }
        message.success(isHandoff ? '已交给对方接单' : '服务已开始，工作记录已开启');
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
      title={`${mode === 'renew' ? '续单' : mode === 'repurchase' ? '复购' : '首单'}${gameName ? ` · ${gameName}` : ''}`}
      onOk={handleStart}
      onCancel={onClose}
      confirmLoading={starting}
      okText={mode === 'renew' ? '确认续单' : mode === 'repurchase' ? '确认复购' : '开始首单并开启工作记录'}
      cancelText="取消"
      width={480}
      destroyOnClose
    >
      <Row gutter={12} align="middle" style={{ marginBottom: 8 }}>
        <Col span={24}>
          <Text>主陪（当前账号默认自己，可换人）</Text>
          <Select style={{ width: '100%' }} value={mainId} onChange={setMainId} placeholder="选择主陪" showSearch optionFilterProp="children">
            {companions.map((c: any) => (
              <Select.Option key={c.id} value={c.id}>{c.user?.displayName || c.user?.username}</Select.Option>
            ))}
          </Select>
        </Col>
      </Row>
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
                  {companions.filter((c: any) => c.id !== mainId).map((c: any) => (
                    <Select.Option key={c.id} value={c.id}>{c.user?.displayName || c.user?.username}</Select.Option>
                  ))}
                </Select>
              </Col>
            </Row>
          )}
        </>
      )}
      <div style={{ marginTop: 12 }}>
        <Switch checked={useDeposit} onChange={setUseDeposit} />
        <Text style={{ marginLeft: 8 }}>用存单支付（不传转账截图，结束后按实际计时从客户存单余额扣款）</Text>
      </div>
      {!useDeposit && (
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
      )}
      <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
        服务期间将自动开启工作记录（随机截图），请保持客户端运行。
      </Text>
    </Modal>
  );
};

export default StartServiceModal;
