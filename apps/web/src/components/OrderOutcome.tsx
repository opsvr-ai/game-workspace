// craftsman-ignore: TS001,TS002
import React, { memo, useEffect, useState } from 'react';
import { Modal, Radio, Input, Typography, message, Space, Upload, Button } from 'antd';
import { ordersApi } from '../api/orders';
import http from '../api/client';
import { extractErrorMessage } from '../utils/error-handler';
import PasteImageBox from './PasteImageBox';

const { Text } = Typography;

/**
 * 线上 / 桥接单的结果反馈（老板 2026-09-29）：
 * 「并不是订单派出去了、被抢走了就计算了……线上不好判定，需要接单者给我反馈，
 * 比如派给桥接俱乐部一个订单，对方对陪玩不满意，那么这单就不成功。」
 *
 * 口径与后端 `common/order-outcome.ts` 完全一致：
 *  - 本店线下的单**不用**反馈 —— 陪玩点「开始首单」就算成功；
 *  - 桥接 / 线上单只有接单方反馈「成功」才算成功，没反馈 = 待反馈（不计提成）；
 *  - 不成功要把原因写清楚（**备注必填**）+ 贴截图；**没有固定原因选项**了 ——
 *    老板 2026-10-06：「那些不成功的原因全部删除吧，只留备注必填，让他们自己填，
 *    因为很多奇奇怪怪的原因，如果乱写管理端给驳回就行了」。
 *    他填的内容直接当成原因存进 `Order.outcomeReason`（管理端「成交核对」看的还是这个字段）。
 */

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
 * 状态格里那行小字的纯文本（「 · 成功」/「 · 不成功」/「 · 待反馈」），线下单返回空串。
 * 订单管理的状态列只有 46px（3 个字，老板 2026-09-30 让收窄的），这行小字经常放不下、
 * 被单元格的省略号吃掉，所以 orderColumns.tsx 把结果拼进 title —— 鼠标悬停照样看全。
 */
export function outcomeSuffixText(order: any): string {
  if (orderChannelOf(order) === 'offline') return '';
  const cfg = STATE_STYLE[outcomeStateOf(order)];
  return cfg ? ` · ${cfg.label}` : '';
}

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
    ? '点这里记结果：成功 / 不成功（不成功要把原因写清楚 + 贴截图）'
    : state === 'PENDING'
      ? '线上 / 桥接单要等接单方反馈「成功 / 不成功」'
      : undefined;
  const failText = order?.outcomeReason || order?.outcomeNote;
  if (state === 'FAILED' && failText) {
    return (
      <span
        style={common}
        title={clickable ? `${title}｜现在记的是：不成功（${failText}）` : `不成功说明：${failText}`}
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
  const [outcome, setOutcome] = useState<'SUCCESS' | 'FAILED'>('SUCCESS');
  const [note, setNote] = useState('');
  // 报「不成功」必须粘贴截图（老板 2026-10-06）：店长要凭这个定责，谁的问题找谁。
  const [evidence, setEvidence] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const channel = channelProp || orderChannelOf(order);
  // 本店线下单还没点「开始首单」= 这单没打成：只能报「不成功」，走截图 + 店长定责。
  const offlineNotStarted = channel === 'offline';

  useEffect(() => {
    if (!open) return;
    setOutcome(order?.outcome === 'FAILED' || offlineNotStarted ? 'FAILED' : 'SUCCESS');
    setNote(order?.outcomeReason || order?.outcomeNote || '');
    setEvidence(Array.isArray(order?.outcomeEvidence) ? order.outcomeEvidence : []);
  }, [open, order, offlineNotStarted]);

  /** 一次收多张（Ctrl+V 粘贴 / 拖进来 / 多选文件都走这里），最多留 6 张。 */
  const uploadEvidenceFiles = async (files: File[]) => {
    const list = (files || []).filter(Boolean).slice(0, 6);
    if (!list.length) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of list) {
        const fd = new FormData();
        fd.append('file', file);
        const { data } = await http.post('/upload/screenshot', fd);
        const url = data?.data?.url || data?.url || '';
        if (url) urls.push(url);
      }
      if (!urls.length) throw new Error('no url');
      setEvidence((prev) => [...prev, ...urls].slice(0, 6));
      message.success(urls.length > 1 ? `已上传 ${urls.length} 张截图` : '截图已上传');
    } catch {
      message.error('截图上传失败，再传一次');
    } finally {
      setUploading(false);
    }
  };

  /** antd Upload 的 beforeUpload：收单张，返回 false 表示自己传、不走它内置的请求。 */
  const beforeUploadEvidence = (file: File) => {
    void uploadEvidenceFiles([file]);
    return false;
  };

  const submit = async () => {
    if (!order?.id) return;
    if (outcome === 'FAILED' && !note.trim()) {
      message.warning('报「不成功」要把原因写清楚（写清楚为什么没打成，乱写会被管理端驳回）');
      return;
    }
    if (outcome === 'FAILED' && !evidence.length) {
      message.warning('报「不成功」要粘贴截图（店长得凭这个定责）');
      return;
    }
    setSaving(true);
    try {
      await ordersApi.recordOutcome(order.id, {
        outcome,
        // 老板 2026-10-06 起不成功只有一个自由填写的「备注」：内容直接当成原因存，
        // 管理端「成交核对」看的还是 outcomeReason，展示不用改。
        reason: note.trim() || undefined,
        evidence: outcome === 'FAILED' ? evidence : undefined,
      });
      message.success(
        outcome === 'SUCCESS'
          ? '已记为成功，已推给发单者计入考核'
          : '已记为不成功：已连截图推给发单者 + 店长，等店长拍板定责',
      );
      onClose();
      onSaved?.();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

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
        {offlineNotStarted
          ? '这张单还没点「开始首单」——点了才算成功。没打成（添加失败 / 客户没同意 / 暂时不打 / 价格或单双陪谈不拢…）就报「不成功」：**原因自己在下面写清楚（备注必填）+ 粘贴截图**，单子会同时推给发单客服和店长，店长拍板到底是谁的问题（谁的问题找谁）。'
          : `${channel === 'online' ? '线上俱乐部' : '桥接工作室'}接的单：报「成功」直接推给发单者、计入考核；报「不成功」要把原因写清楚（备注必填）并粘贴截图，同时推给发单者 + 店长，由店长拍板定责。成功的不用重点追查，失败的重点追。`}
      </Text>
      <div style={{ marginTop: 14 }}>
        <Text strong>结果</Text>
        <div style={{ marginTop: 8 }}>
          <Radio.Group
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            optionType="button"
            buttonStyle="solid"
            disabled={offlineNotStarted}
          >
            {!offlineNotStarted && <Radio.Button value="SUCCESS">成功</Radio.Button>}
            <Radio.Button value="FAILED">不成功</Radio.Button>
          </Radio.Group>
        </div>
      </div>
      {outcome === 'FAILED' && (
        <div style={{ marginTop: 14 }}>
          <Text strong>截图（必传，至少 1 张）</Text>
          {/* 老板 2026-10-06：「上传截图的时候能不能做个输入框？直接粘贴？」——
              这里以前只有一个「选文件」按钮，跟旁边写着的「粘贴截图」对不上（全站别的截图框
              早就换成 PasteImageBox 了，就这一处漏了）。现在跟它们同一套：点一下框内 Ctrl+V 直接粘，
              可一次粘多张（微信 / QQ 截图都行），也能把图片拖进来；原来的「上传截图」按钮留着。 */}
          <PasteImageBox
            onFiles={uploadEvidenceFiles}
            disabled={uploading}
            style={{ marginTop: 8 }}
            hint="点一下这里，直接 Ctrl+V 粘贴截图（可一次粘多张，也能把图片拖进来）"
          >
            {evidence.map((url) => (
              <div
                key={url}
                style={{ display: 'inline-flex', alignItems: 'center', marginRight: 8, marginBottom: 8 }}
              >
                <img
                  src={url}
                  alt="失败凭据"
                  style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 6, border: '1px solid #E2E8F0', cursor: 'pointer' }}
                  onClick={() => window.open(url, '_blank')}
                />
                <Button
                  size="small"
                  type="link"
                  danger
                  onClick={() => setEvidence((prev) => prev.filter((u) => u !== url))}
                >
                  删
                </Button>
              </div>
            ))}
            <Upload
              beforeUpload={beforeUploadEvidence}
              showUploadList={false}
              accept="image/*"
              multiple
              disabled={uploading}
            >
              <Button size="small" loading={uploading}>
                上传截图
              </Button>
            </Upload>
          </PasteImageBox>
          <Text type="secondary" style={{ fontSize: 11 }}>
            截图会一起推给发单客服和店长，店长凭它定责（到底是谁的问题、谁的问题找谁）。
          </Text>
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          <Text strong>{outcome === 'FAILED' ? '备注 / 原因（必填）' : '备注（可不填）'}</Text>
          <Input.TextArea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              outcome === 'FAILED'
                ? '自己写清楚为什么没打成（原因没有选项了；管理端会看，乱写会被驳回）'
                : '例如：客户满意，下把还来'
            }
          />
        </Space>
      </div>
    </Modal>
  );
};

export default memo(OrderOutcomeModal);
