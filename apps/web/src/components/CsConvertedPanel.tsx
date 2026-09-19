// craftsman-ignore: TS001,TS002
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Space, Tag, message, Modal, InputNumber, Select, Typography, Popconfirm } from 'antd';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import { useAuthStore } from '../stores/authStore';
import { extractErrorMessage } from '../utils/error-handler';
import OrderRow from './OrderRow';
import { visibleInterval } from '../hooks/usePolling';

const { Text } = Typography;

interface Props {
  refreshSignal?: number;
}

const CsConvertedPanel: React.FC<Props> = ({ refreshSignal }) => {
  const role = useAuthStore((s) => s.user?.role);
  const canClearBalance = role === 'ADMIN' || role === 'OWNER';

  const [items, setItems] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({ monthTotal: 0, yearTotal: 0, allTotal: 0 });
  const [people, setPeople] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [flowOrder, setFlowOrder] = useState<any>(null);
  const [inAmount, setInAmount] = useState<number>(0);
  const [outAmount, setOutAmount] = useState<number>(0);
  const [outTargetId, setOutTargetId] = useState<string | undefined>();
  const [flowSaving, setFlowSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [convRes, balRes] = await Promise.all([
        ordersApi.csConverted(),
        ordersApi.csWechatBalances(),
      ]);
      setItems(convRes.data.data || []);
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
    const t = visibleInterval(load, 120000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (refreshSignal) load();
  }, [refreshSignal]);

  const balanceByWechat = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of balances) m.set(b.wechatId, b.balance || 0);
    return m;
  }, [balances]);

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

  const renderMoneyDetail = (r: any) => {
    const cf = r.customFields || {};
    const csName = r.csUser?.displayName || r.csUser?.username || '-';
    const csWechat = cf.csWorkWechatName || '-';
    const wechatBalance = balanceByWechat.get(csWechat);

    // 只显示客服实际记录的流水，不推算、不猜。
    const moneyIn = Number(r.moneyIn || 0);

    const moneyOut = Number(r.moneyOut || 0);
    const feePaid = r.companionFeeStatus === 'PAID';
    const feeAmount = Number(r.companionFeeAmount || 0);
    let outText = '未转';
    let outIsPaid = false;
    if (moneyOut > 0) {
      outText = `¥${moneyOut.toFixed(1)}`;
      outIsPaid = true;
    } else if (feePaid && feeAmount > 0) {
      outText = `¥${feeAmount.toFixed(1)}`;
      outIsPaid = true;
    }

    const paidTo = r.customerPaidTo;
    const paidToLabel =
      paidTo === 'CS_WECHAT'
        ? '已进客服微信'
        : paidTo === 'COMPANION_WECHAT'
          ? '客户直接转陪玩'
          : paidTo === 'STUDIO_ACCOUNT'
            ? '客户转工作室'
            : '收款去向未填';

    return (
      <div
        style={{
          marginTop: 6,
          padding: '8px 10px',
          background: '#F8FAFC',
          borderRadius: 6,
          fontSize: 12,
          lineHeight: 2,
          color: '#334155',
        }}
      >
        <div>
          客服：<Text strong>{csName}</Text> ｜ 客服微信：<Text strong>{csWechat}</Text>
        </div>
        <div>
          客户转入：
          <Text strong style={{ color: moneyIn > 0 ? '#1677ff' : '#94A3B8' }}>
            {moneyIn > 0 ? `¥${moneyIn.toFixed(1)}` : '未记录'}
          </Text>
          <Text type="secondary" style={{ marginLeft: 6 }}>
            {paidToLabel}
            {r.customerPaidAccount ? ` · ${r.customerPaidAccount}` : ''}
          </Text>
        </div>
        <div>
          已转给陪玩：
          <Text strong style={{ color: outIsPaid ? '#16A34A' : '#94A3B8' }}>
            {outText}
          </Text>
        </div>
        <div>
          去向：<Text>{r.destination || '-'}</Text>
        </div>
        {wechatBalance !== undefined && (
          <div>
            该客服微信当前累计余额：
            <Text strong style={{ color: wechatBalance < 0 ? '#cf1322' : '#16A34A' }}>
              ¥{wechatBalance.toFixed(1)}
            </Text>
          </div>
        )}
      </div>
    );
  };

  const renderActions = (r: any) => (
    <Space size={4} wrap>
      {r.contactStatus === 'added' ? (
        <Tag color="green">已添加</Tag>
      ) : r.contactStatus === 'not_accepted' ? (
        <Button
          size="small"
          type="primary"
          style={{ background: '#16A34A', borderColor: '#16A34A' }}
          onClick={() => markContact(r, 'added')}
        >
          客户已同意
        </Button>
      ) : r.status === 'GRABBED' || r.status === 'CONFIRMED' ? (
        <>
          <Button
            size="small"
            type="primary"
            style={{ background: '#16A34A', borderColor: '#16A34A' }}
            onClick={() => markContact(r, 'added')}
          >
            ✅ 添加成功
          </Button>
          <Button size="small" danger onClick={() => markContact(r, 'not_accepted')}>
            ❌ 添加失败
          </Button>
        </>
      ) : null}
      <Button size="small" onClick={() => openFlow(r)}>
        记流水
      </Button>
    </Space>
  );

  return (
    <Card size="small" style={{ marginBottom: 12, borderColor: '#13c2c2' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>🎯 管理端直添客户流转明细</div>
        <Button size="small" onClick={load} loading={loading}>
          刷新
        </Button>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((r, idx) => (
          <div key={r.id} style={{ border: '1px solid #E8E9EB', borderRadius: 8, padding: 8 }}>
            <OrderRow order={r} index={idx} renderActions={renderActions} />
            {renderMoneyDetail(r)}
          </div>
        ))}
      </div>

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
    </Card>
  );
};

export default CsConvertedPanel;
