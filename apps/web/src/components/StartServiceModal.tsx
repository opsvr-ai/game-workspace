// craftsman-ignore: TS001,TS002,TS003
import React, { useEffect, useState } from 'react';
import { Modal, Select, InputNumber, Button, Row, Col, Radio, Switch, notification, Typography } from 'antd';
import { message } from '../utils/feedback';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import { useAuthStore } from '../stores/authStore';
import { isCompanionUpdateScheduled } from '../utils/companionUpdate';

const { Text } = Typography;

interface Props {
  open: boolean;
  orderId: string | null;
  customerId?: string | null;
  gameName?: string;
  mode?: 'first' | 'renew' | 'repurchase';
  /** 客户当前还没打完的存单余额（> 0 时默认按存单付款） */
  depositBalance?: number;
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
  /** 开始成功后立刻回调，客户管理先用本地会话把计时/结束按钮显示出来，不等整页刷新。 */
  onStarted?: (data: { orderId: string; sessionId: string; customerId?: string; startedAt: string }) => void;
}

const StartServiceModal: React.FC<Props> = ({ open, orderId, customerId, gameName, mode = 'first', depositBalance = 0, initialValues, onClose, onDone, onStarted }) => {
  const user = useAuthStore((s) => s.user);
  const [mainId, setMainId] = useState<string | undefined>(undefined);
  const [dual, setDual] = useState(false);
  const [proxyMode, setProxyMode] = useState(false);
  const [partnerMode, setPartnerMode] = useState<'assign' | 'broadcast'>('assign');
  const [coId, setCoId] = useState<string | undefined>();
  const [coPrice, setCoPrice] = useState<number | null>(null);
  const [companions, setCompanions] = useState<any[]>([]);
  const [claimMode, setClaimMode] = useState('机密');
  const [claimPrice, setClaimPrice] = useState<number | null>(35);
  const [claimDuration, setClaimDuration] = useState<number>(1);
  const [useDeposit, setUseDeposit] = useState(false);
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
      setProxyMode(false);
      setCoId(initialValues?.coId);
      setCoPrice(initialValues?.coPrice ?? null);
      setClaimMode(initialValues?.claimMode ?? '机密');
      setClaimPrice(initialValues?.claimPrice ?? 35);
      setClaimDuration(initialValues?.claimDuration ?? 1);
      setPartnerMode('assign');
      // 老板 2026-10-04：「老客户还剩存单没打完……打的时候去消耗存单金额就可以了」——
      // 客户有存单余额就默认按存单付款（结束时按实际时长扣），没余额就是普通付款、开关无效。
      // 双陪开新单也走同一套（老板：有时候确实会喊搭档一起来打这个存单，一起消耗）。
      setUseDeposit(Number(depositBalance) > 0);
      loadCompanions();
    }
  }, [open]);

  // 这个客户还带着没打完的存单，是不是就默认走存单扣款（双陪开新单也一样能扣）
  const hasDepositBalance = Number(depositBalance) > 0;

  const handleStart = async () => {
    if (starting) return; // 防连点：同一张单第二次点击直接忽略
    if (!orderId && !customerId) return;
    if (isCompanionUpdateScheduled()) {
      message.warning('软件正在更新，请稍等');
      return;
    }
    if (!claimDuration || claimDuration <= 0) return message.warning('请填写有效时长');
    if (claimPrice == null || claimPrice <= 0) return message.warning('请填写单价');
    if (dual && partnerMode === 'assign' && !coId) return message.warning('双陪请选择搭档');
    if (dual && (coPrice == null || coPrice <= 0)) return message.warning('双陪请填写搭档单价');

    const price = claimPrice;
    setStarting(true);
    // 老板 2026-10-25：点了开始首单、游戏刚启动时，客户端还拿着「空闲杀三角洲」的旧名单，
    // 几秒内就被看门狗杀掉。先把本机状态切 BUSY（同时让服务端推空名单），再发开始的请求。
    const api = (window as any).electronAPI;
    let previousStatus = 'AVAILABLE';
    let statusPaused = false;
    if (!dual && api?.onStatusChanged) {
      try { previousStatus = (await api.storeGet?.('lastStatus')) || 'AVAILABLE'; } catch { /* ignore */ }
      api.onStatusChanged('BUSY');
      statusPaused = true;
    }
    try {
      let sessionId: string | undefined;
      let startedOrderId = orderId || '';
      if (customerId && !orderId) {
        // 陪玩自己录入的客户：先创建直接派单（会自动建会话），再开始会话 ——
        //   开始首单 = NEW，续单 = RENEW，复购 = REPURCHASE。
        const directType = mode === 'first' ? 'NEW' : mode === 'renew' ? 'RENEW' : 'REPURCHASE';
        const orderRes: any = await ordersApi.create({
          type: directType,
          dispatchType: 'DIRECT',
          companionId: mainId || user?.companionId,
          customerId,
          gameName: gameName || '三角洲行动',
          amount: price * claimDuration,
          duration: claimDuration,
          coCompanionId: dual && partnerMode === 'assign' ? coId : undefined,
          coAmount: dual ? (coPrice ?? 0) * claimDuration : undefined,
          proxyMode: proxyMode === true,
          deltaMission: claimMode,
          deltaCount: dual ? '双' : '单',
          useDeposit,
        });
        const newOrder = orderRes?.data?.data;
        if (!newOrder?.id) {
          message.error('创建订单失败');
          setStarting(false);
          return;
        }
        startedOrderId = newOrder.id;
        const sessionsRes: any = await ordersApi.getSessions(newOrder.id);
        sessionId = sessionsRes?.data?.data?.[0]?.id;
      } else {
        const res: any = await ordersApi.addSession(orderId!, {
          companionId: mainId || user?.companionId,
          amount: price * claimDuration,
          duration: claimDuration,
          coCompanionId: dual && partnerMode === 'assign' ? coId : undefined,
          coAmount: dual ? (coPrice ?? 0) * claimDuration : undefined,
          proxyMode: proxyMode === true,
          claimedMode: claimMode,
          claimedPrice: price,
          useDeposit,
          // 单陪：服务端 addSession 直接写 startedAt，避免「创建了但没开始」的半截会话；
          // 双陪（指定 / 广播）必须等搭档接受，不能抢跑。
          autoStart: !dual,
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
            description: '等待搭档接受，3 分钟内接受有效',
            placement: 'bottomRight',
            duration: 5,
          });
        } else {
          const partnerName = companions.find((c: any) => c.id === coId)?.user?.displayName
            || companions.find((c: any) => c.id === coId)?.user?.username
            || '对方';
          notification.info({
            message: `🤝 已邀请 ${partnerName} 搭档`,
            description: '等待对方确认后开始计时，3 分钟内接受有效',
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
          useDeposit,
        });
        if (!isHandoff) {
          (window as any).electronAPI?.sessionWatch?.(sessionId);
        }
        onStarted?.({
          orderId: startedOrderId,
          sessionId,
          customerId: customerId || undefined,
          startedAt: new Date().toISOString(),
        });
        message.success(isHandoff ? '已交给对方接单' : '服务已开始，工作记录已开启');
      }
      onDone();
    } catch (e: any) {
      if (statusPaused) api?.onStatusChanged?.(previousStatus);
      message.error(e?.response?.data?.message || '开始失败');
    }
    setStarting(false);
  };

  return (
    <Modal
      open={open}
      title={`开始服务${gameName ? ` · ${gameName}` : ''}`}
      onOk={handleStart}
      onCancel={onClose}
      confirmLoading={starting}
      okText="开始服务并开启工作记录"
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
            <Button size="small" type={!dual ? 'primary' : 'default'} onClick={() => { setDual(false); setProxyMode(false); }} style={{ marginRight: 8 }}>单陪</Button>
            <Button
              size="small"
              type={dual ? 'primary' : 'default'}
              onClick={() => setDual(true)}
            >
              双陪
            </Button>
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
      <Row gutter={12} align="middle" style={{ marginTop: 8 }}>
        <Col span={24}>
          <Switch
            checked={proxyMode}
            onChange={(v) => {
              setProxyMode(v);
              if (v) {
                setDual(true);
                setPartnerMode('assign');
              }
            }}
          />
          <Text style={{ marginLeft: 8 }}>
            让搭档代打（我不参与，客户和 KPI 仍归我，只算搭档的业绩和时长）
          </Text>
        </Col>
      </Row>
      <Row gutter={12} align="middle">
        <Col span={12}>
          <Text>单价</Text>
          <InputNumber min={0} style={{ width: '100%' }} value={claimPrice ?? undefined} onChange={(v) => setClaimPrice(v ?? null)} suffix="元/小时" placeholder="？/人/h" />
        </Col>
        <Col span={12}>
          <Text>实际时长</Text>
          <InputNumber min={0.5} step={0.5} style={{ width: '100%' }} value={claimDuration} onChange={(v) => setClaimDuration(v || 0)} suffix="小时" placeholder="至少 0.5 小时" />
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
              <Text>搭档单价</Text>
              <InputNumber min={0} style={{ width: '100%' }} value={coPrice ?? undefined} onChange={(v) => setCoPrice(v ?? null)} suffix="元/小时" placeholder="？/人/h" />
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
        <Switch checked={useDeposit} onChange={setUseDeposit} disabled={!hasDepositBalance} />
        <Text style={{ marginLeft: 8 }}>用存单支付（结束时按实际计时从客户存单余额扣款）</Text>
        {Number(depositBalance) > 0 ? (
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            客户存单还剩 <Text strong style={{ color: '#FF4757' }}>¥{Number(depositBalance).toFixed(2)}</Text>，这单默认走存单扣款。
          </Text>
        ) : (
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            这个客户没有未打完的存单余额。
          </Text>
        )}
      </div>
      <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
        服务期间将自动开启工作记录（随机截图），请保持客户端运行。
      </Text>
    </Modal>
  );
};

export default StartServiceModal;
