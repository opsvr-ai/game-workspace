// craftsman-ignore: TS001,TS002
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Space, message, Modal, InputNumber, Select, Typography, Popconfirm, Upload } from 'antd';
import { ordersApi } from '../api/orders';
import http from '../api/client';
import { companionsApi } from '../api/companions';
import { useAuthStore } from '../stores/authStore';
import { extractErrorMessage } from '../utils/error-handler';
import OrderTable, { noteSub, NOTE_SEP } from './OrderTable';
import { visibleInterval } from '../hooks/usePolling';
import {
  CELL_ONE_LINE,
  DATA_SUB_FONT_SIZE,
  FIELD_WIDTH,
  LEDGER_FIELD_WIDTH,
} from '../constants/datasetColumns';
import { ORDER_FIELD_LABELS, ORDER_SEARCH_PLACEHOLDER } from '../constants/orderFields';
import { orderMatchesSearch } from '../utils/orderPool';
import { dueFollowUpAtOf, lastFollowUpOf, mmddhhmm } from '../utils/followUp';
import FollowUpModal from './FollowUpModal';
import PasteImageBox from './PasteImageBox';
import { BRAND, TEXT } from '../styles/tokens';

const { Text } = Typography;

interface Props {
  refreshSignal?: number;
  /** 客户谈好了，「直接派单」把这张单重新发给陪玩（走 CSDispatchView 的 handleDispatch） */
  onDispatch?: (item: any) => void;
}

/**
 * 管理端直添客户流转明细 —— 客服加过工作微信的客户，只有这一份台账。
 *
 * 老板 2026-09-30：「把客服跟进台账删除，把他的功能合并到管理端直添客户流转明细」。
 * 以前是两页：单独的「客服跟进台账」（还没派出去的客户）和这一页（已经派出去被陪玩接的）。
 * 同一批客户在两个页面上各显示一遍、列法还不一样，客服自己得拼着看 —— 老板的原话是
 * 「显示的不一样 显得乱七八糟的」。现在合成一页，两种情况在**同一张表**里上下排开：
 *
 *  - 还没派出去的（客户先加到了客服工作微信上）：看「添加情况 / 最后跟进 / 下次跟进」，
 *    点「记跟进」写客户档案（客户管理里能看到同一条），谈好了点「直接派单」发给陪玩，
 *    谈崩了点「处理完成」收起来；
 *  - 已经派出去、陪玩接了的：看「收款情况」（转入 / 转出 / 去向 / 客服微信余额），
 *    账不对点「记流水」补记。
 *
 * 客户信息那五列（来源 / 引流账号 / 客户昵称 / 客户账号ID / 客户联系方式）直接调订单表
 * 那一份（orderColumns.tsx 的 buildCustomerInfoColumns），和数据、列宽、字号和订单管理 /
 * 订单池流转失败明细 / 派单工作台一模一样 —— 这一页不再自己写一套标签。
 */
const CsConvertedPanel: React.FC<Props> = ({ refreshSignal, onDispatch }) => {
  const role = useAuthStore((s) => s.user?.role);
  const canClearBalance = role === 'ADMIN' || role === 'OWNER';

  const [items, setItems] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({ monthTotal: 0, yearTotal: 0, allTotal: 0 });
  const [people, setPeople] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  // 「到点该跟进了」要用当前时间比，所以每 30 秒自己走一下表（列表本身每 60 秒刷一次）
  const [now, setNow] = useState(Date.now());
  const [followTarget, setFollowTarget] = useState<any>(null);
  const [flowOrder, setFlowOrder] = useState<any>(null);
  const [inAmount, setInAmount] = useState<number>(0);
  const [outAmount, setOutAmount] = useState<number>(0);
  const [outTargetId, setOutTargetId] = useState<string | undefined>();
  const [flowSaving, setFlowSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      // 一张台账，两半数据：cs-converted = 已经派出去被陪玩接了的（带收款），
      // cs-followup = 还没派出去的（带最后一条跟进记录）。按订单 id 合成一页。
      const [convRes, followRes, balRes] = await Promise.all([
        ordersApi.csConverted(),
        ordersApi.csFollowup(),
        ordersApi.csWechatBalances(),
      ]);
      const converted = convRes.data.data || [];
      const following = followRes.data.data || [];
      const byId = new Map<string, any>();
      for (const r of converted) byId.set(r.id, { ...r, _converted: true });
      for (const r of following) {
        const prev = byId.get(r.id);
        // 正常不会撞 id（派出去是另外新发的一张单）；真撞上就以带收款信息的那条为准，
        // 只把跟进记录补进去。
        byId.set(r.id, prev ? { ...prev, ...r, _converted: true } : { ...r, _converted: false });
      }
      setItems(Array.from(byId.values()));
      setBalances(balRes.data.data || []);

      if (canClearBalance) {
        ordersApi
          .csWechatBalanceSummary()
          .then(({ data }) => setSummary(data.data || { monthTotal: 0, yearTotal: 0, allTotal: 0 }))
          .catch(() => {});
      }
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const loadPeople = async () => {
    try {
      const { data } = await companionsApi.listPersonnel({ includeBridged: true });
      setPeople(data.data || []);
    } catch {
      // 人员列表加载失败不阻塞资金流水功能
    }
  };

  useEffect(() => {
    load();
    loadPeople();
    const tick = setInterval(() => setNow(Date.now()), 30000);
    const timer = visibleInterval(load, 60000);
    return () => {
      clearInterval(tick);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (refreshSignal) load();
  }, [refreshSignal]);

  const balanceByWechat = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of balances) m.set(b.wechatId, b.balance || 0);
    return m;
  }, [balances]);

  // 搜索走和订单池 / 订单管理 / 订单池流转失败明细同一个口径（utils/orderPool）：
  // 一个框搜客户、游戏、客服、陪玩，空格分隔多个词。
  const filtered = useMemo(() => {
    const matched = search.trim() ? items.filter((r) => orderMatchesSearch(r, search)) : items;
    // 到点该跟进的排最上面（最早该跟的排最前）——老板 2026-09-29：「下次跟进时间到了，这页红字置顶」；
    // 其余的还是「还没派出去的在前、已经流转出去的在后」，读起来就是客服的一天。
    return [...matched].sort((a, b) => {
      const at = dueFollowUpAtOf(a, now);
      const bt = dueFollowUpAtOf(b, now);
      if (at !== null && bt !== null) return at - bt;
      if (at !== null) return -1;
      if (bt !== null) return 1;
      return (a._converted ? 1 : 0) - (b._converted ? 1 : 0);
    });
  }, [items, search, now]);

  const dueRows = useMemo(
    () => filtered.filter((r) => dueFollowUpAtOf(r, now) !== null),
    [filtered, now],
  );

  /** 添加情况：待添加 / 已添加 / 客户已同意 / 添加失败 / 已派单（跟客服有关的那几步，没有「无人接单」） */
  const stageOf = (r: any): { text: string; color: string } => {
    switch (r.contactStatus) {
      case 'dispatched':
        return { text: '已派单', color: BRAND.primary };
      case 'agreed':
        return { text: '客户已同意', color: '#15803D' };
      case 'added':
        return { text: '已添加', color: '#15803D' };
      case 'not_accepted':
        return { text: '添加失败', color: '#B45309' };
      case 'pending':
        return { text: '待添加', color: '#B45309' };
      default:
        // 没标过添加结果、但已经派出去被陪玩接了的老数据
        return r._converted ? { text: '已派单', color: BRAND.primary } : { text: '待添加', color: '#B45309' };
    }
  };

  const workWechatOf = (r: any): string =>
    (r.customFields || {}).csWorkWechatName ||
    ((r.customer || {}).followUps || [])[0]?.workWechatName ||
    '';

  const mark = async (item: any, status: string, addResult?: 'passed' | 'failed', done?: string) => {
    try {
      await ordersApi.markCsContact(item.id, status, undefined, addResult ? { addResult } : undefined);
      message.success(done || '已记录');
      load();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '操作失败'));
    }
  };

  const markContact = async (r: any, status: 'added' | 'not_accepted') => {
    try {
      await ordersApi.updateContact(r.id, {
        contactStatus: status,
        ...(status === 'not_accepted' ? { notes: '客户一直没同意' } : {}),
      });
      message.success(status === 'added' ? '已标记添加成功' : '已标记添加失败');
      load();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '操作失败'));
    }
  };

  // 客服点「添加失败」也要能贴证据（老板 2026-10-06）：以前一点就直接提交、没地方粘
  // 「客户没同意」的截图。现在弹窗**只填备注（必填）+ 粘贴截图（可选）** ——
  // 老板同一天说「那些不成功的原因全部删除吧，只留备注必填，让他们自己填，
  // 因为很多奇奇怪怪的原因，如果乱写管理端给驳回就行了」，所以不再给固定原因选项；
  // 备注内容直接当原因存，截图存进订单，这一行能看到缩略图，方便跟发单者 / 店长核对。
  const [failTarget, setFailTarget] = useState<{ item: any; viaCsContact: boolean } | null>(null);
  const [failNote, setFailNote] = useState('');
  const [failEvidence, setFailEvidence] = useState<string[]>([]);
  const [failUploading, setFailUploading] = useState(false);
  const [failSaving, setFailSaving] = useState(false);

  const openFail = (item: any, viaCsContact: boolean) => {
    setFailTarget({ item, viaCsContact });
    setFailNote('');
    setFailEvidence([]);
  };

  /** 一次收多张（Ctrl+V 粘贴 / 拖进来 / 多选文件都走这里），最多留 3 张。 */
  const uploadFailFiles = async (files: File[]) => {
    const list = (files || []).filter(Boolean).slice(0, 3);
    if (!list.length) return;
    setFailUploading(true);
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
      setFailEvidence((prev) => [...prev, ...urls].slice(0, 3));
      message.success(urls.length > 1 ? `已上传 ${urls.length} 张截图` : '截图已上传');
    } catch {
      message.error('截图上传失败，再传一次');
    } finally {
      setFailUploading(false);
    }
  };

  const submitFail = async () => {
    if (!failTarget) return;
    const note = failNote.trim();
    if (!note) {
      message.warning('把为什么添加失败写清楚（原因没有选项了，自己填；乱写会被管理端驳回）');
      return;
    }
    setFailSaving(true);
    try {
      const evidenceUrl = failEvidence[0] || undefined;
      if (failTarget.viaCsContact) {
        // 还没派出去的跟进单：订单还不是 GRABBED / CONFIRMED，走 /cs-contact 才写得了
        await ordersApi.markCsContact(failTarget.item.id, 'added', evidenceUrl, {
          addResult: 'failed',
          failReason: note,
          note,
        });
      } else {
        await ordersApi.updateContact(failTarget.item.id, {
          contactStatus: 'not_accepted',
          notes: note,
          failReason: note,
          screenshotUrl: evidenceUrl,
        });
      }
      message.success('已标记添加失败');
      setFailTarget(null);
      load();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '操作失败'));
    } finally {
      setFailSaving(false);
    }
  };

  const handleDone = async (item: any) => {
    try {
      await ordersApi.markPoolHandled(item.id);
      message.success('已从这份台账里收起来');
      load();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '操作失败'));
    }
  };

  // ── 收款情况（老板 2026-09-28：一张单原来要在下面叠 5 行小字，现在压成一行，长了鼠标悬停看全）──
  // 一行里先说**钱**（转入 / 转出 / 收款去向），再说单子去向和人；这一格窄，
  // 后面几项看不全就省略号 + 鼠标悬停（这一列的 title 拼的是同一串，一个字都不丢）。
  const paidToLabelOf = (r: any) => {
    const paidTo = r.customerPaidTo;
    if (paidTo === 'CS_WECHAT') return '已进客服微信';
    if (paidTo === 'COMPANION_WECHAT') return '客户直接转陪玩';
    if (paidTo === 'STUDIO_ACCOUNT') return '客户转工作室';
    return '收款去向未填';
  };

  const moneyBits = (r: any) => {
    const cf = r.customFields || {};
    const csName = r.csUser?.displayName || r.csUser?.username || '-';
    const csWechat = cf.csWorkWechatName || '-';
    const wechatBalance = balanceByWechat.get(csWechat);
    const moneyIn = Number(r.moneyIn || 0);
    const moneyOut = Number(r.moneyOut || 0);
    const feePaid = r.companionFeeStatus === 'PAID';
    const feeAmount = Number(r.companionFeeAmount || 0);
    let outText = '未转陪玩';
    if (moneyOut > 0) outText = `转陪玩 ¥${moneyOut.toFixed(1)}`;
    else if (feePaid && feeAmount > 0) outText = `转陪玩 ¥${feeAmount.toFixed(1)}`;

    const paidToLabel = paidToLabelOf(r);
    const bits = [
      moneyIn > 0 ? `转入 ¥${moneyIn.toFixed(1)}` : '未记转入',
      outText,
      paidToLabel,
      `去向 ${r.destination || '-'}`,
      r.companion?.user?.username ? `主陪 ${r.companion.user.username}` : '',
      `客服 ${csName} · 微信 ${csWechat}`,
    ];
    if (wechatBalance !== undefined) bits.push(`该微信累计余额 ¥${wechatBalance.toFixed(1)}`);
    return bits;
  };

  /** 收款情况那一格的鼠标悬停全文：跟格子里同一串，只多了「客户从哪个号转的」这一项 */
  const moneyTitleOf = (r: any) => {
    const account = r.customerPaidAccount ? String(r.customerPaidAccount) : '';
    return [moneyStateOf(r).text, ...moneyBits(r), account ? `收款账号 ${account}` : '']
      .filter(Boolean)
      .join(NOTE_SEP);
  };

  // 一行字能看出来的收款进度
  const moneyStateOf = (r: any) => {
    const moneyIn = Number(r.moneyIn || 0);
    const moneyOut = Number(r.moneyOut || 0);
    const feePaid = r.companionFeeStatus === 'PAID';
    const feeAmount = Number(r.companionFeeAmount || 0);
    const out = moneyOut > 0 || (feePaid && feeAmount > 0);
    if (moneyIn > 0 && out) return { text: '已收已转', color: '#15803D' };
    if (moneyIn > 0) return { text: '已收未转', color: '#B45309' };
    if (out) return { text: '未记转入', color: '#B45309' };
    return { text: '未记流水', color: TEXT.tertiary };
  };

  const openFlow = (r: any) => {
    setFlowOrder(r);
    setInAmount(0);
    setOutAmount(0);
    // 默认转给该订单的接单陪玩
    setOutTargetId(r.companionId || r.companion?.id || undefined);
  };

  const addFlow = async () => {
    if (!flowOrder) return;
    const tasks: Promise<unknown>[] = [];

    if (inAmount > 0) {
      tasks.push(
        ordersApi.addMoneyFlow(flowOrder.id, {
          direction: 'IN',
          amount: inAmount,
          counterpart: '客户',
          note: '客户转入',
        }),
      );
    }

    if (outAmount > 0) {
      if (!outTargetId) {
        message.warning('请选择客服转给谁');
        return;
      }
      const target = people.find((p) => p.id === outTargetId || p.companionId === outTargetId);
      const targetName = target?.displayName || target?.username || target?.id || '对方';
      const targetRefId = target?.companionId || target?.id || outTargetId;
      tasks.push(
        ordersApi.addMoneyFlow(flowOrder.id, {
          direction: 'OUT',
          amount: outAmount,
          counterpart: targetName,
          counterpartId: targetRefId,
          note: '客服转出',
        }),
      );
    }

    if (tasks.length === 0) {
      message.warning('请至少填写一笔金额');
      return;
    }

    setFlowSaving(true);
    try {
      await Promise.all(tasks);
      message.success('已记录');
      // 记完后立刻校验这单账，仍有异常会提醒对应客服去改。
      ordersApi.checkCsAnomaly(flowOrder.id).catch(() => {});
      setFlowOrder(null);
      setInAmount(0);
      setOutAmount(0);
      setOutTargetId(undefined);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '记录失败');
    } finally {
      setFlowSaving(false);
    }
  };

  const clearBalance = async (b: any) => {
    try {
      await ordersApi.clearCsWechatBalance(b.id, '店长转走余额清零');
      message.success('余额已清零');
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '清零失败');
    }
  };

  /**
   * 操作按钮分两套（同一张表里的两种行）：
   *  - 还没派出去的（跟进中）：添加成功 / 添加失败 / 客户已同意 / 直接派单 / 处理完成 + 记跟进；
   *  - 已经派出去被陪玩接的：补「添加成功 / 添加失败」+ 记跟进 / 记流水。
   */
  const renderActions = (r: any) => {
    const st = r.contactStatus;
    const buttons: React.ReactNode[] = [];
    if (!r._converted) {
      if (st === 'dispatched') {
        buttons.push(
          <Button key="done" size="small" onClick={() => handleDone(r)}>
            处理完成
          </Button>,
        );
      } else if (st === 'agreed') {
        buttons.push(
          <Button key="dispatch" size="small" type="primary" onClick={() => onDispatch?.(r)}>
            直接派单
          </Button>,
        );
      } else if (st === 'added') {
        buttons.push(
          <Button key="agree" size="small" onClick={() => mark(r, 'agreed', undefined, '已标记：客户同意打了')}>
            客户已同意
          </Button>,
        );
        buttons.push(
          <Button key="dispatch" size="small" type="primary" onClick={() => onDispatch?.(r)}>
            直接派单
          </Button>,
        );
      } else if (st === 'not_accepted') {
        buttons.push(
          <Button
            key="passed"
            size="small"
            type="primary"
            style={{ background: '#16A34A', borderColor: '#16A34A' }}
            onClick={() => mark(r, 'added', 'passed', '已标记添加成功')}
          >
            加上了
          </Button>,
        );
        buttons.push(
          <Button key="agree" size="small" onClick={() => mark(r, 'agreed', undefined, '已标记：客户同意打了')}>
            客户已同意
          </Button>,
        );
      } else {
        buttons.push(
          <Button
            key="passed"
            size="small"
            type="primary"
            style={{ background: '#16A34A', borderColor: '#16A34A' }}
            onClick={() => mark(r, 'added', 'passed', '已标记添加成功')}
          >
            添加成功
          </Button>,
        );
        buttons.push(
          <Button key="failed" size="small" danger onClick={() => openFail(r, true)}>
            添加失败
          </Button>,
        );
      }
    } else if (st === 'not_accepted') {
      buttons.push(
        <Button
          key="agree"
          size="small"
          type="primary"
          style={{ background: '#16A34A', borderColor: '#16A34A' }}
          onClick={() => markContact(r, 'added')}
        >
          客户已同意
        </Button>,
      );
    } else if ((r.status === 'GRABBED' || r.status === 'CONFIRMED') && st !== 'added') {
      buttons.push(
        <Button
          key="passed"
          size="small"
          type="primary"
          style={{ background: '#16A34A', borderColor: '#16A34A' }}
          onClick={() => markContact(r, 'added')}
        >
          添加成功
        </Button>,
      );
      buttons.push(
        <Button key="failed" size="small" danger onClick={() => openFail(r, false)}>
          添加失败
        </Button>,
      );
    }
    buttons.push(
      <Button key="follow" size="small" onClick={() => setFollowTarget(r)}>
        记跟进
      </Button>,
    );
    if (r._converted) {
      buttons.push(
        <Button key="flow" size="small" onClick={() => openFlow(r)}>
          记流水
        </Button>,
      );
    }
    // 客服留过「添加失败」截图的话，在这一行的按钮前面挂个缩略图，点开看大图（老板 2026-10-06）
    const contactEvidence = (r.customFields || {}).csContactEvidenceUrl;
    if (contactEvidence) {
      buttons.unshift(
        <img
          key="fail-evidence"
          src={contactEvidence}
          alt="添加失败截图"
          title="点开看「添加失败」时留的截图"
          style={{ width: 22, height: 22, objectFit: 'cover', borderRadius: 4, border: '1px solid #E2E8F0', cursor: 'pointer' }}
          onClick={() => window.open(contactEvidence, '_blank')}
        />,
      );
    }
    return <Space size={4}>{buttons}</Space>;
  };

  /** 这一页特有的四列：客服工作微信 / 添加情况 / 最后跟进 / 下次跟进（原跟进台账那几列） */
  const extraColumns: any[] = [
    {
      title: ORDER_FIELD_LABELS.workWechat,
      key: 'workWechat',
      width: LEDGER_FIELD_WIDTH.workWechat,
      render: (_: unknown, r: any) => {
        const wx = workWechatOf(r);
        return (
          <div style={CELL_ONE_LINE} title={wx}>
            {wx || <span style={{ color: TEXT.tertiary }}>-</span>}
          </div>
        );
      },
    },
    {
      title: '添加情况',
      key: 'stage',
      width: LEDGER_FIELD_WIDTH.stage,
      render: (_: unknown, r: any) => {
        const st = stageOf(r);
        return (
          <div style={CELL_ONE_LINE} title={st.text}>
            <span style={{ color: st.color }}>{st.text}</span>
          </div>
        );
      },
    },
    {
      title: '最后跟进',
      key: 'lastFollow',
      width: LEDGER_FIELD_WIDTH.lastFollow,
      render: (_: unknown, r: any) => {
        const last = lastFollowUpOf(r);
        if (!last) return <span style={{ color: TEXT.tertiary }}>还没记过跟进</span>;
        const text = `${mmddhhmm(last.createdAt)} · ${last.content || ''}`;
        return (
          <div style={CELL_ONE_LINE} title={text}>
            <span style={{ color: TEXT.tertiary }}>{mmddhhmm(last.createdAt)}</span>
            <span style={{ color: TEXT.disabled }}> · </span>
            <span>{last.content}</span>
          </div>
        );
      },
    },
    {
      title: '下次跟进',
      key: 'nextFollow',
      width: LEDGER_FIELD_WIDTH.nextFollow,
      render: (_: unknown, r: any) => {
        const at = lastFollowUpOf(r)?.nextFollowUpAt;
        if (!at) return <span style={{ color: TEXT.tertiary }}>-</span>;
        // 到点了就红字加粗、后面缀「该跟进了」；没到点是紫色
        const due = dueFollowUpAtOf(r, now) !== null;
        return (
          <span
            style={{ color: due ? '#DC2626' : '#7C3AED', fontWeight: due ? 600 : 400 }}
            title={due ? `${mmddhhmm(at)} 到点了，该跟进了` : mmddhhmm(at)}
          >
            {mmddhhmm(at)}
            {due ? ' 该跟进了' : ''}
          </span>
        );
      },
    },
  ];

  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 8,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontWeight: 600 }}>
            管理端直添客户流转明细
            {dueRows.length > 0 && (
              <span style={{ color: '#DC2626', marginLeft: 8 }}>
                有 {dueRows.length} 位客户到点该跟进了（已红字排在最上面）
              </span>
            )}
          </div>
          <div style={{ fontSize: DATA_SUB_FONT_SIZE, color: TEXT.tertiary }}>
            客户先加到客服工作微信上、慢慢聊；谈得差不多了点「直接派单」发给陪玩。已经派出去的在下面，看「收款情况」记流水。
          </div>
        </div>
        <Space size={8}>
          {search && (
            <Text type="secondary" style={{ fontSize: DATA_SUB_FONT_SIZE }}>
              筛选结果 {filtered.length}/{items.length}
            </Text>
          )}
          <Input
            allowClear
            placeholder={ORDER_SEARCH_PLACEHOLDER}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 300 }}
            size="small"
          />
          <Button size="small" onClick={load} loading={loading}>
            刷新
          </Button>
        </Space>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {balances.length === 0 ? (
          <Text type="secondary" style={{ fontSize: 12 }}>暂无客服工作微信</Text>
        ) : (
          balances.map((b) => (
            <div
              key={b.id}
              style={{
                padding: '5px 10px',
                background: '#F0FDF4',
                border: '1px solid #BBF7D0',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Text style={{ fontSize: 12 }}>{b.wechatId}</Text>
              <Text strong style={{ fontSize: 12, color: b.balance < 0 ? '#cf1322' : '#16A34A' }}>
                ¥{b.balance.toFixed(1)}
              </Text>
              {canClearBalance && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  已转走 ¥{Number(b.withdrawn || 0).toFixed(1)}
                </Text>
              )}
              {canClearBalance && (
                <Popconfirm
                  title={`确认将 ${b.wechatId} 余额清零？`}
                  description="将按当前余额记录一笔转走，清零后不可撤销"
                  onConfirm={() => clearBalance(b)}
                  okText="清零"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" danger type="text">
                    清零
                  </Button>
                </Popconfirm>
              )}
            </div>
          ))
        )}
      </div>
      {canClearBalance && (
        <div
          style={{
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            marginBottom: 10,
            padding: '6px 10px',
            background: '#F5F3FF',
            border: '1px solid #DDD6FE',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <Text>店长转走统计：</Text>
          <Text>本月 <Text strong>¥{Number(summary.monthTotal || 0).toFixed(1)}</Text></Text>
          <Text>今年 <Text strong>¥{Number(summary.yearTotal || 0).toFixed(1)}</Text></Text>
          <Text>累计 <Text strong>¥{Number(summary.allTotal || 0).toFixed(1)}</Text></Text>
        </div>
      )}

      <OrderTable
        orders={filtered}
        hideStudio
        loading={loading}
        extraColumns={extraColumns}
        actionsWidth={FIELD_WIDTH.orderActions}
        renderActions={renderActions}
        // 到点该跟进的那一行整行淡红底（老板 2026-09-29：「红字置顶」）
        rowStyle={(r: any) => (dueFollowUpAtOf(r, now) !== null ? { background: '#FFF1F2' } : undefined)}
        emptyText={items.length === 0 ? '还没有直添客户流转记录：派单工作台点「直接添加客户」开始登记。' : `没有匹配「${search}」的客户。`}
        noteColumn={{
          title: '收款情况',
          width: LEDGER_FIELD_WIDTH.receipt,
          render: (r: any) => {
            // 还没派出去的这一半：钱还没到，写清楚，别让人以为漏记了
            if (!r._converted) return <span style={{ color: TEXT.tertiary }}>还没派出去</span>;
            const st = moneyStateOf(r);
            return (
              <>
                <span style={{ color: st.color }}>{st.text}</span>
                <span style={noteSub}>
                  {NOTE_SEP}
                  {moneyBits(r).join(NOTE_SEP)}
                </span>
              </>
            );
          },
          titleText: (r: any) => (r._converted ? moneyTitleOf(r) : '还没派出去'),
        }}
      />

      <FollowUpModal
        open={!!followTarget}
        item={followTarget}
        onClose={() => setFollowTarget(null)}
        onSaved={load}
      />

      <Modal
        title="记资金流水"
        open={!!flowOrder}
        onOk={addFlow}
        onCancel={() => setFlowOrder(null)}
        confirmLoading={flowSaving}
        okText="保存"
        cancelText="取消"
        width={520}
      >
        <div style={{ marginTop: 16 }}>
          {flowOrder && (
            (() => {
              const csWechat = flowOrder.customFields?.csWorkWechatName || '-';
              const bal = balanceByWechat.get(csWechat);
              return (
                <div
                  style={{
                    marginBottom: 14,
                    padding: '8px 12px',
                    background: '#F0FDF4',
                    border: '1px solid #BBF7D0',
                    borderRadius: 6,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text>
                    客服微信：<Text strong>{csWechat}</Text>
                  </Text>
                  <Text>
                    当前余额：
                    <Text strong style={{ color: bal != null && bal < 0 ? '#cf1322' : '#16A34A' }}>
                      ¥{bal != null ? bal.toFixed(1) : '0.0'}
                    </Text>
                  </Text>
                </div>
              );
            })()
          )}
          <div style={{ marginBottom: 16 }}>
            <Text strong>① 客户转入</Text>
            <InputNumber
              value={inAmount}
              onChange={(v) => setInAmount(v || 0)}
              min={0}
              prefix="¥"
              style={{ width: '100%', marginTop: 6 }}
              placeholder="客户转入金额"
            />
          </div>
          <div>
            <Text strong>② 客服转出</Text>
            <InputNumber
              value={outAmount}
              onChange={(v) => setOutAmount(v || 0)}
              min={0}
              prefix="¥"
              style={{ width: '100%', marginTop: 6 }}
              placeholder="客服转出金额"
            />
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择转给谁"
              value={outTargetId}
              onChange={setOutTargetId}
              style={{ width: '100%', marginTop: 6 }}
            >
              {people.map((p) => {
                const name = p.displayName || p.username || p.id;
                const value = p.companionId || p.id;
                return (
                  <Select.Option key={value} value={value} label={name}>
                    {name}
                  </Select.Option>
                );
              })}
            </Select>
          </div>
        </div>
      </Modal>
      {/* 客服点「添加失败」时的弹窗：选原因 + 粘贴截图（可选）+ 备注（老板 2026-10-06） */}
      <Modal
        title="标记「添加失败」"
        open={!!failTarget}
        onOk={submitFail}
        onCancel={() => setFailTarget(null)}
        okText="确认添加失败"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={failSaving}
        destroyOnClose
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          为什么加不上，自己写清楚就行（没有固定原因选项了）；能贴上「客户没同意 / 没通过验证」的截图更好 ——
          之后跟发单者 / 店长核对、定责时都看得到。
        </Text>
        <div style={{ marginTop: 14 }}>
          <Text strong>截图（可选，建议贴一张）</Text>
          <PasteImageBox
            onFiles={uploadFailFiles}
            disabled={failUploading}
            style={{ marginTop: 8 }}
            hint="点一下这里，直接 Ctrl+V 粘贴截图（可一次粘多张，也能把图片拖进来）"
          >
            {failEvidence.map((url) => (
              <div
                key={url}
                style={{ display: 'inline-flex', alignItems: 'center', marginRight: 8, marginBottom: 8 }}
              >
                <img
                  src={url}
                  alt="添加失败凭据"
                  style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 6, border: '1px solid #E2E8F0', cursor: 'pointer' }}
                  onClick={() => window.open(url, '_blank')}
                />
                <Button
                  size="small"
                  type="link"
                  danger
                  onClick={() => setFailEvidence((prev) => prev.filter((u) => u !== url))}
                >
                  删
                </Button>
              </div>
            ))}
            <Upload
              beforeUpload={(f) => {
                void uploadFailFiles([f]);
                return false;
              }}
              showUploadList={false}
              accept="image/*"
              multiple
              disabled={failUploading}
            >
              <Button size="small" loading={failUploading}>
                上传截图
              </Button>
            </Upload>
          </PasteImageBox>
        </div>
        <div style={{ marginTop: 14 }}>
          <Text strong>备注（必填）</Text>
          <Input.TextArea
            rows={3}
            value={failNote}
            onChange={(e) => setFailNote(e.target.value)}
            placeholder="自己写清楚为什么添加失败（管理端会看，乱写会被驳回）"
            style={{ marginTop: 8 }}
          />
        </div>
      </Modal>
    </Card>
  );
};

export default CsConvertedPanel;
