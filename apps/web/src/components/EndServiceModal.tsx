// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Modal, InputNumber, Typography} from 'antd';
import { message } from '../utils/feedback';
import { ordersApi } from '../api/orders';

const { Text } = Typography;

interface Props {
  open: boolean;
  sessionId?: string | null;
  orderId?: string | null;
  /** 这一段是不是「用存单支付」的 —— 是才显示「本次从存单扣款」 */
  paidByDeposit?: boolean;
  /** 客户当前存单余额（元） */
  depositBalance?: number;
  /** 系统按计时算出来的建议扣款额（元） */
  suggestedDeduct?: number;
  onClose: () => void;
  onDone?: () => void;
}

const EndServiceModal: React.FC<Props> = ({
  open,
  sessionId,
  orderId,
  paidByDeposit,
  depositBalance,
  suggestedDeduct,
  onClose,
  onDone,
}) => {
  const [transferTotal, setTransferTotal] = useState<number | undefined>(undefined);
  const [depositDeduct, setDepositDeduct] = useState<number | undefined>(undefined);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (open) {
      setTransferTotal(undefined);
      // 预填系统算出来的数，陪玩觉得不对直接改（老板 2026-10-04：以他填的为准）
      setDepositDeduct(
        suggestedDeduct != null && suggestedDeduct > 0 ? Number(suggestedDeduct.toFixed(2)) : undefined,
      );
    }
  }, [open, suggestedDeduct]);

  const confirm = async () => {
    if (!sessionId) return;
    try { await (window as any).electronAPI?.sessionWatchStop?.(); } catch {}
    setEnding(true);
    try {
      await ordersApi.finishSession(sessionId, {
        transferTotalYuan: transferTotal,
        depositDeductYuan: paidByDeposit ? depositDeduct : undefined,
      });
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
      <Text>请填写客户本次实际转账合计（微信 + 支付宝）</Text>
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
      {paidByDeposit && (
        <>
          <Text style={{ display: 'block', marginTop: 16 }}>本次从客户存单扣款（元）</Text>
          <div style={{ marginTop: 8 }}>
            <InputNumber
              min={0}
              max={Math.max(0, Number(depositBalance) || 0)}
              step={10}
              precision={2}
              style={{ width: '100%' }}
              value={depositDeduct}
              onChange={(v) => setDepositDeduct(v ?? undefined)}
              prefix="¥"
              placeholder="按实际打了多少钱的存单填"
            />
          </div>
          <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
            系统按计时算出的是 ¥{suggestedDeduct ?? 0}，跟实际不一样就改成你自己的数 ——{' '}
            <Text strong>以你填的为准</Text>（不填才用系统算的）。
            这个客户存单还剩 ¥{(Number(depositBalance) || 0).toFixed(2)}，最多扣到余额为 0。
          </Text>
        </>
      )}
    </Modal>
  );
};

export default EndServiceModal;
