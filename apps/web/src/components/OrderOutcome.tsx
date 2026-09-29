// craftsman-ignore: TS001,TS002
import React, { memo, useEffect, useState } from 'react';
import { Modal, Radio, Select, Input, Typography, message, Space } from 'antd';
import { ordersApi } from '../api/orders';
import { configApi } from '../api/config';
import { extractErrorMessage } from '../utils/error-handler';

const { Text } = Typography;

/**
 * 线上 / 桥接单的结果反馈（老板 2026-09-29）：
 * 「并不是订单派出去了、被抢走了就计算了……线上不好判定，需要接单者给我反馈，
 * 比如派给桥接俱乐部一个订单，对方对陪玩不满意，那么这单就不成功。」
 *
 * 口径与后端 `common/order-outcome.ts` 完全一致：
 *  - 本店线下的单**不用**反馈 —— 陪玩点「开始首单」就算成功；
 *  - 桥接 / 线上单只有接单方反馈「成功」才算成功，没反馈 = 待反馈（不计提成）；
 *  - 不成功要选原因，原因在「选项字典 → 反馈不成功的原因」里能改。
 */

export const OUTCOME_FAIL_REASONS_FALLBACK = [
  '客户对陪玩不满意',
  '陪玩没接、放鸽子',
  '时间对不上',
  '价格没谈拢',
  '客户临时取消',
  '其他',
];

/** 这张单是哪种渠道：线下（本店）/ 桥接（别家直营店）/ 线上（租赁俱乐部）。 */
export function orderChannelOf(order: any): 'offline' | 'bridge' | 'online' {
  const compStudio = order?.companion?.studio;
  if (compStudio?.type === 'RENTAL') return 'online';
  if (compStudio?.id && order?.studioId && compStudio.id !== order.studioId) return 'bridge';
  return 'offline';
}

/** 这张单现在的结果：成功 / 不成功 / 待反馈 / 不适用（线下或还没人接）。 */
export function outcomeStateOf(order: any): 'SUCCESS' | 'FAILED' | 'PENDING' | 'NONE' {
  const channel = orderChannelOf(order);
  const refunded = !!order?.refundedAt;
  if (refunded || order?.status === 'CANCELLED') return 'NONE';
  if (channel === 'offline') {
    const started = order?.status === 'DONE' || (order?.sessions || []).some((s: any) => !!s.startedAt);
    return started ? 'SUCCESS' : 'NONE';
  }
  if (order?.outcome === 'SUCCESS') return 'SUCCESS';
  if (order?.outcome === 'FAILED') return 'FAILED';
  return order?.companionId ? 'PENDING' : 'NONE';
}

const STATE_STYLE: Record<string, { label: string; color: string }> = {
  SUCCESS: { label: '成功', color: '#15803D' },
  FAILED: { label: '不成功', color: '#DC2626' },
  PENDING: { label: '待反馈', color: '#B45309' },
};

/**
 * 状态格里缀在状态后面的小字（线下单不显示 —— 线下看「进行中 / 已完成」就够了）。
 * 传了 `onClick` 就能点：客服 / 店长点一下直接记「成功 / 不成功」。
 */
export function OutcomeSuffix({ order, onClick }: { order: any; onClick?: () => void }) {
  if (orderChannelOf(order) === 'offline') return null;
  const state = outcomeStateOf(order);
  const cfg = STATE_STYLE[state];
  if (!cfg) return null;
  const clickable = !!onClick;
  const common: React.CSSProperties = {
    color: cfg.color,
    marginLeft: 6,
    cursor: clickable ? 'pointer' : 'default',
    textDecoration: clickable ? 'underline dotted' : undefined,
  };
  const title = clickable
    ? '点这里记结果：成功 / 不成功（不成功要选原因）'
    : state === 'PENDING'
      ? '线上 / 桥接单要等接单方反馈「成功 / 不成功」'
      : undefined;
  if (state === 'FAILED' && order?.outcomeReason) {
    return (
      <span
        style={common}
        title={clickable ? `${title}｜现在记的是：不成功（${order.outcomeReason}）` : `不成功原因：${order.outcomeReason}`}
        onClick={onClick}
      >
        · {cfg.label}
      </span>
    );
  }
  return (
    <span style={common} title={title} onClick={onClick}>
      · {cfg.label}
    </span>
  );
}

export function useOutcomeReasons(): string[] {
  const [reasons, setReasons] = useState<string[]>(OUTCOME_FAIL_REASONS_FALLBACK);
  useEffect(() => {
    configApi
      .getAll()
      .then((res: any) => {
        const list = res?.data?.data?.['options.outcome_fail_reasons'];
        if (Array.isArray(list) && list.length) setReasons(list.map((x: any) => String(x)));
      })
      .catch(() => {});
  }, []);
  return reasons;
}

interface Props {
  open: boolean;
  order: any;
  onClose: () => void;
  onSaved?: () => void;
  /**
   * 直接指定渠道。今日看板点开的明细行自己就知道渠道（后端算好的），
   * 行里没有 `companion.studio`，靠 `orderChannelOf` 认不出来，所以允许直接传。
   */
  channel?: 'offline' | 'bridge' | 'online';
}

const OrderOutcomeModal: React.FC<Props> = ({ open, order, onClose, onSaved, channel: channelProp }) => {
  const reasons = useOutcomeReasons();
  const [outcome, setOutcome] = useState<'SUCCESS' | 'FAILED'>('SUCCESS');
  const [reason, setReason] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOutcome(order?.outcome === 'FAILED' ? 'FAILED' : 'SUCCESS');
    setReason(order?.outcomeReason || undefined);
    setNote(order?.outcomeNote || '');
  }, [open, order]);

  const submit = async () => {
    if (!order?.id) return;
    if (outcome === 'FAILED' && !reason) {
      message.warning('请选一个不成功的原因');
      return;
    }
    setSaving(true);
    try {
      await ordersApi.recordOutcome(order.id, { outcome, reason, note: note.trim() || undefined });
      message.success(outcome === 'SUCCESS' ? '已记为成功' : '已记为不成功');
      onClose();
      onSaved?.();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const channel = channelProp || orderChannelOf(order);
  return (
    <Modal
      title="这张单成不成？"
      open={open}
      onOk={submit}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      destroyOnClose
    >
      <Text type="secondary" style={{ fontSize: 12 }}>
        {channel === 'online' ? '线上俱乐部' : '桥接工作室'}接的单：只有反馈「成功」才算客服提成，
        不成功不计提成、也不扣钱，但会留记录（谁、哪单、什么原因）。
      </Text>
      <div style={{ marginTop: 14 }}>
        <Text strong>结果</Text>
        <div style={{ marginTop: 8 }}>
          <Radio.Group
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="SUCCESS">成功</Radio.Button>
            <Radio.Button value="FAILED">不成功</Radio.Button>
          </Radio.Group>
        </div>
      </div>
      {outcome === 'FAILED' && (
        <div style={{ marginTop: 14 }}>
          <Text strong>不成功的原因</Text>
          <Select
            style={{ width: '100%', marginTop: 8 }}
            placeholder="选一个原因"
            value={reason}
            onChange={(v) => setReason(v)}
            options={reasons.map((r) => ({ label: r, value: r }))}
          />
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          <Text strong>备注（可不填）</Text>
          <Input.TextArea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：对方说客户嫌价格高，没谈拢"
          />
        </Space>
      </div>
    </Modal>
  );
};

export default memo(OrderOutcomeModal);
