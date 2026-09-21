// craftsman-ignore: TS001,TS002,TS003
import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, Card, Statistic, Row, Col, Spin, Typography, InputNumber, Input, Button, Space, Popconfirm, message } from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { financeApi } from '../../api/finance';
import { configApi } from '../../api/config';
import PageHeader from '../../components/PageHeader';

const { Text } = Typography;

const money = (v: number) => Number(v ?? 0).toFixed(1);

type ExpenseItem = { id: string; name: string; amount: number };

const ProfitCalendarPage: React.FC = () => {
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [profit, setProfit] = useState<any>({ daily: [], totals: {} });
  const [bridge, setBridge] = useState<any>({ daily: [], totals: {} });
  const [expenseItems, setExpenseItems] = useState<ExpenseItem[]>([]);
  const [bridgePrices, setBridgePrices] = useState({ secretPrice: 35, juejuNet: 30 });
  const [bridgeReturns, setBridgeReturns] = useState<any>({ records: [], total: 0 });
  const [returnAmount, setReturnAmount] = useState<number>(0);
  const [returnDate, setReturnDate] = useState<string>(dayjs().format('YYYY-MM-DD'));
  const [returnNote, setReturnNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingBridge, setSavingBridge] = useState(false);
  const [savingReturn, setSavingReturn] = useState(false);

  const load = async (m: Dayjs) => {
    setLoading(true);
    try {
      const [profitRes, bridgeRes, bridgeReturnsRes] = await Promise.all([
        financeApi.profitDaily(m.format('YYYY-MM')),
        financeApi.bridgeOnlineDaily(m.format('YYYY-MM')),
        financeApi.bridgeReturns.list(m.format('YYYY-MM')),
      ]);
      setProfit(profitRes.data.data || { daily: [], totals: {} });
      setBridge(bridgeRes.data.data || { daily: [], totals: {} });
      setBridgeReturns(bridgeReturnsRes.data.data || { records: [], total: 0 });
    } catch {
      setProfit({ daily: [], totals: {} });
      setBridge({ daily: [], totals: {} });
      setBridgeReturns({ records: [], total: 0 });
    } finally {
      setLoading(false);
    }
  };

  const loadExpenseItems = async () => {
    try {
      const { data } = await financeApi.expenseItems.list();
      setExpenseItems((data as any)?.data || []);
    } catch {
      /* ignore */
    }
  };

  const loadBridgePrices = async () => {
    try {
      const { data } = await configApi.get(['bridge.secret_price_yuan', 'bridge.jueju_net_yuan']);
      const cfg = (data as any)?.data || {};
      setBridgePrices({
        secretPrice: Number(cfg['bridge.secret_price_yuan'] ?? 35),
        juejuNet: Number(cfg['bridge.jueju_net_yuan'] ?? 30),
      });
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    load(month);
  }, [month]);

  useEffect(() => {
    loadExpenseItems();
    loadBridgePrices();
  }, []);

  const saveExpense = async () => {
    setSaving(true);
    try {
      await financeApi.expenseItems.save(expenseItems);
      message.success('支出项已保存');
      await Promise.all([load(month), loadExpenseItems()]);
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveBridgePrices = async () => {
    setSavingBridge(true);
    try {
      await configApi.update({
        'bridge.secret_price_yuan': bridgePrices.secretPrice,
        'bridge.jueju_net_yuan': bridgePrices.juejuNet,
      });
      message.success('桥接工作室结算已保存');
      await load(month);
    } catch {
      message.error('保存失败');
    } finally {
      setSavingBridge(false);
    }
  };

  const addBridgeReturn = async () => {
    if (returnAmount <= 0) {
      message.warning('请填写返还金额');
      return;
    }
    setSavingReturn(true);
    try {
      await financeApi.bridgeReturns.create({
        amount: returnAmount,
        date: returnDate,
        note: returnNote || undefined,
      });
      message.success('返还已记录');
      setReturnAmount(0);
      setReturnNote('');
      await load(month);
    } catch {
      message.error('记录失败');
    } finally {
      setSavingReturn(false);
    }
  };

  const removeBridgeReturn = async (id: string) => {
    try {
      await financeApi.bridgeReturns.remove(id);
      message.success('已删除');
      await load(month);
    } catch {
      message.error('删除失败');
    }
  };

  const profitMap = useMemo<Map<string, any>>(
    () => new Map((profit.daily || []).map((d: any) => [d.date, d] as [string, any])),
    [profit.daily],
  );
  const bridgeMap = useMemo<Map<string, any>>(
    () => new Map((bridge.daily || []).map((d: any) => [d.date, d] as [string, any])),
    [bridge.daily],
  );

  const calcDay = (p: any, b: any) => {
    const income = (p?.offline || 0) + (p?.bridgeProfit || 0) + (p?.online || 0);
    const pay =
      (p?.offlinePay || 0) +
      (p?.csCommission || 0) +
      (p?.onlinePay || 0) +
      (b?.returnAmount || 0);
    return { income, pay, net: income - pay };
  };

  const monthlyExpense = useMemo(() => {
    const fromTotals = profit.totals?.totalExpense;
    if (fromTotals !== undefined && fromTotals !== null) return Number(fromTotals);
    return expenseItems.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  }, [profit.totals, expenseItems]);

  const daysInMonth = month.daysInMonth();
  const dailyExpense = daysInMonth > 0 ? monthlyExpense / daysInMonth : 0;

  const dateCellRender = (value: Dayjs) => {
    const p: any = profitMap.get(value.format('YYYY-MM-DD'));
    const b: any = bridgeMap.get(value.format('YYYY-MM-DD'));
    if (!p && !b && dailyExpense <= 0) return null;
    const d = calcDay(p, b);
    const netAfter = d.net - dailyExpense;
    return (
      <div style={{ fontSize: 12, lineHeight: 1.55, whiteSpace: 'nowrap' }}>
        <div style={{ color: '#16A34A' }}>利润 ¥{money(d.income)}</div>
        <div style={{ color: '#cf1322' }}>应付 ¥{money(d.pay)}</div>
        <div style={{ color: '#B45309' }}>支出 ¥{money(dailyExpense)}</div>
        <div style={{ color: netAfter >= 0 ? '#3f8600' : '#cf1322' }}>净利 ¥{money(netAfter)}</div>
      </div>
    );
  };

  const pt = profit.totals || {};
  const bt = bridge.totals || {};
  const monthIncome = (pt.offline || 0) + (pt.bridgeProfit || 0) + (pt.online || 0);
  const monthPay =
    (pt.offlinePay || 0) +
    (pt.csCommission || 0) +
    (pt.csBaseSalary || 0) +
    (pt.onlinePay || 0) +
    (bt.returnAmount || 0);
  const monthNet = monthIncome - monthPay;
  const monthNetAfterExpense = monthNet - monthlyExpense;

  const updateItem = (id: string, patch: Partial<ExpenseItem>) => {
    setExpenseItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };
  const removeItem = (id: string) => {
    setExpenseItems((prev) => prev.filter((it) => it.id !== id));
  };
  const addItem = () => {
    setExpenseItems((prev) => [...prev, { id: `custom-${Date.now()}`, name: '', amount: 0 }]);
  };

  return (
    <div>
      <PageHeader title="💰 财务中心" subtitle="利润、应付、固定支出（平摊到天）与每日/月度净利润" />

      <Card size="small" title="本月利润（赚进来的）" style={{ marginBottom: 12 }}>
        <Row gutter={16}>
          <Col span={6}><Statistic title="线下利润" value={pt.offline || 0} prefix="¥" precision={1} /></Col>
          <Col span={6}><Statistic title="桥接利润（客服创造）" value={pt.bridgeProfit || 0} prefix="¥" precision={1} /></Col>
          <Col span={6}><Statistic title="线上利润" value={pt.online || 0} prefix="¥" precision={1} /></Col>
          <Col span={6}><Statistic title="利润合计" value={monthIncome} prefix="¥" precision={1} valueStyle={{ color: '#3f8600' }} /></Col>
        </Row>
      </Card>

      <Card size="small" title="本月应付（要发出去的）" style={{ marginBottom: 12 }}>
        <Row gutter={16}>
          <Col span={6}><Statistic title="线下陪玩" value={pt.offlinePay || 0} prefix="¥" precision={1} /></Col>
          <Col span={6}><Statistic title="客服（底薪+提成）" value={(pt.csCommission || 0) + (pt.csBaseSalary || 0)} prefix="¥" precision={1} /></Col>
          <Col span={6}><Statistic title="线上陪玩" value={pt.onlinePay || 0} prefix="¥" precision={1} /></Col>
          <Col span={6}><Statistic title="返还桥接" value={bt.returnAmount || 0} prefix="¥" precision={1} /></Col>
        </Row>
        <Row gutter={16} style={{ marginTop: 12 }}>
          <Col span={12}><Statistic title="应付合计" value={monthPay} prefix="¥" precision={1} valueStyle={{ color: '#cf1322' }} /></Col>
          <Col span={12}><Statistic title="本月净利（不含支出）" value={monthNet} prefix="¥" precision={1} valueStyle={{ color: monthNet >= 0 ? '#3f8600' : '#cf1322' }} /></Col>
        </Row>
      </Card>

      <Card
        size="small"
        title="本月固定支出（平摊到每天）"
        style={{ marginBottom: 12 }}
        extra={
          <Space>
            <Text type="secondary">每日平摊 ¥{money(dailyExpense)}</Text>
            <Button size="small" icon={<PlusOutlined />} onClick={addItem}>添加支出项</Button>
            <Button size="small" type="primary" icon={<SaveOutlined />} loading={saving} onClick={saveExpense}>保存</Button>
          </Space>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {expenseItems.map((it) => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Input
                value={it.name}
                placeholder="支出项名称"
                style={{ width: 200 }}
                onChange={(e) => updateItem(it.id, { name: e.target.value })}
              />
              <InputNumber
                value={it.amount}
                min={0}
                step={10}
                style={{ width: 160 }}
                addonBefore="¥"
                onChange={(v) => updateItem(it.id, { amount: Number(v || 0) })}
              />
              <Popconfirm title="删除该支出项？" onConfirm={() => removeItem(it.id)}>
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>
          ))}
        </div>
        <Row style={{ marginTop: 12 }}>
          <Col span={12}><Statistic title="本月支出合计" value={monthlyExpense} prefix="¥" precision={1} valueStyle={{ color: '#B45309' }} /></Col>
        </Row>
      </Card>

      <Card
        size="small"
        title="桥接工作室结算（付给桥接，非客服提成）"
        style={{ marginBottom: 12 }}
        extra={
          <Space>
            <Button size="small" type="primary" icon={<SaveOutlined />} loading={savingBridge} onClick={saveBridgePrices}>保存</Button>
          </Space>
        }
      >
        <Space size={16} wrap>
          <div>
            <Text>机密单价（元/人/时）</Text>
            <InputNumber
              min={0}
              step={1}
              value={bridgePrices.secretPrice}
              onChange={(v) => setBridgePrices((p) => ({ ...p, secretPrice: Number(v ?? 0) }))}
              style={{ width: 140, marginLeft: 8 }}
            />
          </div>
          <div>
            <Text>绝密净价（元/人/时）</Text>
            <InputNumber
              min={0}
              step={1}
              value={bridgePrices.juejuNet}
              onChange={(v) => setBridgePrices((p) => ({ ...p, juejuNet: Number(v ?? 0) }))}
              style={{ width: 140, marginLeft: 8 }}
            />
          </div>
        </Space>
        <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          这是老板付给桥接/线上工作室的服务费（机密 35 元、绝密 45−15=30 元），按人数 × 时长结算；客服提成在「客服设置」里单独按单量设置。
        </Text>
      </Card>

      <Card size="small" title="桥接返还台账（实际打给桥接/线上的钱）" style={{ marginBottom: 12 }}>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}><Statistic title="本月应返还" value={bt.returnAmount || 0} prefix="¥" precision={1} /></Col>
          <Col span={8}><Statistic title="本月已返还" value={bridgeReturns.total || 0} prefix="¥" precision={1} valueStyle={{ color: '#16A34A' }} /></Col>
          <Col span={8}><Statistic title="待返还" value={Math.max(0, (bt.returnAmount || 0) - (bridgeReturns.total || 0))} prefix="¥" precision={1} valueStyle={{ color: '#cf1322' }} /></Col>
        </Row>
        <Space wrap>
          <Text>返还金额</Text>
          <InputNumber min={0} step={10} value={returnAmount} onChange={(v) => setReturnAmount(Number(v || 0))} style={{ width: 140 }} />
          <Text>返还日期</Text>
          <Input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} style={{ width: 160 }} />
          <Text>备注</Text>
          <Input value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="备注（可选）" style={{ width: 180 }} />
          <Button type="primary" size="small" icon={<SaveOutlined />} loading={savingReturn} onClick={addBridgeReturn}>记录返还</Button>
        </Space>
        {bridgeReturns.records?.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {bridgeReturns.records.map((r: any) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Text style={{ width: 110 }}>{dayjs(r.date).format('YYYY-MM-DD')}</Text>
                <Text strong style={{ color: '#16A34A', width: 100 }}>¥{Number(r.amount || 0).toFixed(1)}</Text>
                <Text type="secondary" style={{ flex: 1 }}>{r.note || '-'}</Text>
                <Popconfirm title="删除这条返还记录？" onConfirm={() => removeBridgeReturn(r.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card size="small" style={{ marginBottom: 12, background: '#F0FDF4' }}>
        <Row gutter={16} align="middle">
          <Col span={12}>
            <Statistic
              title="本月净利润（利润 − 应付 − 支出）"
              value={monthNetAfterExpense}
              prefix="¥"
              precision={1}
              valueStyle={{ color: monthNetAfterExpense >= 0 ? '#16A34A' : '#cf1322', fontSize: 28 }}
            />
          </Col>
          <Col span={12}>
            <Text type="secondary">
              利润 ¥{money(monthIncome)} − 应付 ¥{money(monthPay)} − 支出 ¥{money(monthlyExpense)}
            </Text>
          </Col>
        </Row>
      </Card>

      <Card size="small">
        <Spin spinning={loading}>
          <Calendar value={month} onPanelChange={(v) => setMonth(v)} dateCellRender={dateCellRender} />
        </Spin>
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          📌 利润 = 线下利润 + 桥接利润（机密 35/人/时、绝密 30/人/时）+ 线上利润。
          应付 = 线下陪玩 + 客服 + 线上陪玩 + 返还桥接。固定支出按当月天数平摊到每天。
        </Text>
      </Card>
    </div>
  );
};

export default ProfitCalendarPage;
