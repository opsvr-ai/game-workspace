// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Modal, InputNumber, Space, Button, Typography, notification, message } from 'antd';
import { ordersApi } from '../api/orders';

const { Text } = Typography;

interface Props {
  open: boolean;
  sessionId?: string | null;
  orderId?: string | null;
  order?: any;
  onClose: () => void;
  onRenew?: (order?: any) => void;
  onDone?: () => void;
}

const EndServiceModal: React.FC<Props> = ({ open, sessionId, orderId, order, onClose, onRenew, onDone }) => {
  const [transferTotal, setTransferTotal] = useState<number | undefined>(undefined);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (open) setTransferTotal(undefined);
  }, [open]);

  const completeOrder = async () => {
    if (!orderId) return;
    try {
      await ordersApi.complete(orderId);
      message.success('本单已结束服务');
      onDone?.();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '结束服务失败');
    }
  };

  const confirm = async () => {
    if (!sessionId) return;
    try { await (window as any).electronAPI?.sessionWatchStop?.(); } catch {}
    setEnding(true);
    try {
      await ordersApi.finishSession(sessionId, { transferTotalYuan: transferTotal });
      message.success('已结束');
      onDone?.();
      onClose();
      const nk = `renew-${sessionId}`;
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
              onClick={() => {
                notification.destroy(nk);
                onRenew?.(order);
              }}
            >
              续单
            </Button>
            <Button
              size="small"
              onClick={() => {
                notification.destroy(nk);
                completeOrder();
              }}
            >
              结束服务
            </Button>
          </Space>
        ),
      });
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
