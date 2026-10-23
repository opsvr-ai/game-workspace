// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { InputNumber, Modal, Typography } from 'antd';
import { message } from '../utils/feedback';
import { ordersApi } from '../api/orders';

const { Text } = Typography;

interface Props {
  open: boolean;
  orderId: string | null;
  isDouble?: boolean;
  mainPrice?: number;
  coPrice?: number;
  onClose: () => void;
  onDone: () => void;
}

/**
 * 正在服务中「加时 / 继续」：不结束当前会话、不退出游戏。
 * 服务端把旧段按当前时刻结算，同一个订单立刻开下一段；两人都继续 BUSY。
 */
const ContinueServiceModal: React.FC<Props> = ({ open, orderId, isDouble, mainPrice, coPrice, onClose, onDone }) => {
  const [duration, setDuration] = useState(1);
  const [price, setPrice] = useState<number | undefined>();
  const [partnerPrice, setPartnerPrice] = useState<number | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDuration(1);
    setPrice(mainPrice && mainPrice > 0 ? Number(mainPrice) : undefined);
    setPartnerPrice(coPrice && coPrice > 0 ? Number(coPrice) : undefined);
  }, [open, mainPrice, coPrice]);

  const submit = async () => {
    if (!orderId) return;
    if (!duration || duration <= 0) return message.warning('请填写加时时长');
    if (price == null || price <= 0) return message.warning('请填写单价');
    if (isDouble && (partnerPrice == null || partnerPrice <= 0)) return message.warning('请填写搭档单价');
    setSaving(true);
    try {
      const res: any = await ordersApi.continueSession(orderId, {
        duration,
        price,
        coPrice: isDouble ? partnerPrice : undefined,
      });
      const data = res?.data?.data;
      if (data?.sessionId) {
        try { (window as any).electronAPI?.sessionWatch?.(data.sessionId); } catch {}
      }
      message.success('已加时，继续服务，不用退出游戏');
      onDone();
      onClose();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '加时失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="加时 / 继续服务"
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      okText="确认加时"
      cancelText="取消"
      width={420}
    >
      <Text>当前服务不结束，继续加时；双方都不会退出游戏。</Text>
      <div style={{ marginTop: 12 }}>
        <Text>加时时长</Text>
        <InputNumber min={0.5} step={0.5} style={{ width: '100%' }} value={duration} onChange={(v) => setDuration(Number(v) || 0)} suffix="小时" />
      </div>
      <div style={{ marginTop: 10 }}>
        <Text>{isDouble ? '主陪单价' : '单价'}</Text>
        <InputNumber min={0} style={{ width: '100%' }} value={price} onChange={(v) => setPrice(v ?? undefined)} suffix="元/小时" />
      </div>
      {isDouble && (
        <div style={{ marginTop: 10 }}>
          <Text>搭档单价</Text>
          <InputNumber min={0} style={{ width: '100%' }} value={partnerPrice} onChange={(v) => setPartnerPrice(v ?? undefined)} suffix="元/小时" />
        </div>
      )}
      <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
        加时的这一段照常计入业绩和时长；客户/KPI 仍归主陪。
      </Text>
    </Modal>
  );
};

export default ContinueServiceModal;
