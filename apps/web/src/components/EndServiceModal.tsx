// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Modal, InputNumber, Typography, message } from 'antd';
import { ordersApi } from '../api/orders';

const { Text } = Typography;

interface Props {
  open: boolean;
  sessionId?: string | null;
  orderId?: string | null;
  onClose: () => void;
  onDone?: () => void;
}

const EndServiceModal: React.FC<Props> = ({ open, sessionId, orderId, onClose, onDone }) => {
  const [transferTotal, setTransferTotal] = useState<number | undefined>(undefined);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (open) setTransferTotal(undefined);
  }, [open]);

  const confirm = async () => {
    if (!sessionId) return;
    try { await (window as any).electronAPI?.sessionWatchStop?.(); } catch {}
    setEnding(true);
    try {
      await ordersApi.finishSession(sessionId, { transferTotalYuan: transferTotal });
      // 结束服务 = 结束会话 + 完成订单，避免订单一直停在「进行中」
      if (orderId) {
        try {
          await ordersApi.complete(orderId);
        } catch {
          /* 订单可能已结束，忽略 */
        }
      }
      message.success('已结束服务');
      onDone?.();
      onClose();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '结束失败');
    }
    setEnding(false);
  };

  return (
    <Modal
      title="结束服务"
      open={open}
      onOk={confirm}
      onCancel={onClose}
      confirmLoading={ending}
      okText="确认结束"
      cancelText="取消"
    >
      <Text>请填写客户本次实际转账合计（微信 + 支付宝，元）</Text>
      <div style={{ marginTop: 8 }}>
        <InputNumber
          min={0}
          step={10}
          precision={1}
          style={{ width: '100%' }}
          value={transferTotal}
          onChange={(v) => setTransferTotal(v ?? undefined)}
          prefix="¥"
          placeholder="留空则记为待核对"
        />
      </div>
      <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
        转账合计低于「填写时长 × 单价」将被标记异常，供管理端复核。
      </Text>
    </Modal>
  );
};

export default EndServiceModal;
