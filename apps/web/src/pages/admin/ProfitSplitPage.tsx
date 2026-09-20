import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Form, InputNumber, Row, Space, message, Switch, Tabs, Typography } from 'antd';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { profitSplitApi } from '../../api/profitSplit';
import { clampPercent, complementPercent, FULL_PERCENT, isFullPercentTotal, sumPercentRounded } from '../../utils/percent';

const { Title, Text } = Typography;

const COLORS = ['#2563EB', '#F59E0B', '#10B981', '#8B5CF6'];
const KEYS = ['studio', 'admin', 'cs', 'companion'] as const;
const LABELS: Record<string, string> = { studio: '工作室', admin: '店长', cs: '客服', companion: '陪玩' };
const MODES = [
  { key: 'offline', label: '线下工作室' },
  { key: 'online', label: '线上俱乐部' },
  { key: 'bridge', label: '桥接工作室' },
];

// 阶梯的「陪玩% / 工作室%」是一对，必须刚好 100%：陪玩是真正算钱的那一栏，工作室拿剩余份额。
const normalizeTiers = (tiers: any[]) =>
  tiers.map((t) => {
    const companion = clampPercent(t?.companion);
    return { ...t, companion, studio: complementPercent(companion) };
  });

const ProfitSplitPage: React.FC = () => {
  const [form] = Form.useForm();
  const [data, setData] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('offline');
  const [offlineTiers, setOfflineTiers] = useState<any[]>([]);
  const [bridge, setBridge] = useState({ confidentialSettle: false, secretRefund: 15 });
  // 线上俱乐部四栏的当前值（自己存一份：antd 的 useWatch 只支持单个字段路径，
  // 用表单值反推合计会晚一拍，所以这里以本地状态为准，改一栏立刻重算陪玩那一栏）。
  const [onlineValues, setOnlineValues] = useState<Record<string, number>>({
    studio: 0, admin: 0, cs: 0, companion: 0,
  });

  const load = async () => {
    const { data: res } = await profitSplitApi.get(mode);
    setData(res.data);
    if (mode === 'online') {
      const filled: Record<string, number> = {};
      KEYS.forEach((k) => { filled[k] = clampPercent(res.data?.[k] ?? 0); });
      setOnlineValues(filled);
      form.setFieldsValue(filled);
    }
    if (mode === 'offline') setOfflineTiers(normalizeTiers(res.data.tiers || []));
    if (mode === 'bridge') setBridge(res.data);
  };

  useEffect(() => { load(); }, [mode]);

  // ── 线上俱乐部：一单利润固定 100%，四个角色分成 ──
  const onlineTotal = sumPercentRounded(KEYS.map((k) => onlineValues[k]));

  /**
   * 改任意一栏，剩下的自动补到「陪玩」那一栏；直接改「陪玩」时最多只能填到剩余额度，
   * 所以四栏合计**永远不可能超过 100%**（老板 2026-09-21 要求）。
   */
  const changeOnlinePercent = (key: string, raw: number | null) => {
    const othersOf = (k: string) => KEYS.filter((x) => x !== k && x !== 'companion');
    const next: Record<string, number> = { ...onlineValues };
    const room = FULL_PERCENT - sumPercentRounded(othersOf(key).map((k) => next[k]));
    if (key === 'companion') {
      next.companion = clampPercent(raw ?? 0, 0, room);
    } else {
      next[key] = clampPercent(raw ?? 0, 0, room);
      next.companion = clampPercent(
        FULL_PERCENT - sumPercentRounded(othersOf('companion').map((k) => next[k])), 0, FULL_PERCENT);
    }
    setOnlineValues(next);
    form.setFieldsValue(next);
  };

  const chartData = useMemo(() => {
    if (!data) return [];
    // 线上俱乐部：饼图跟着正在编辑的数字走，改一栏立刻能看到切成什么样（不用先保存）。
    const source: Record<string, any> = mode === 'online' ? onlineValues : data;
    return KEYS.map((k) => ({ name: LABELS[k], value: Number(source[k] || 0) }));
  }, [data, mode, onlineValues]);

  const save = async () => {
    let values: any;
    if (mode === 'online') {
      values = { ...onlineValues, ...(await form.validateFields()) };
      const total = KEYS.reduce((s, k) => s + Number(values[k] || 0), 0);
      if (Math.abs(total - 100) > 0.001) {
        message.error(`比例合计必须为100%，当前为${total}%`);
        return;
      }
    } else if (mode === 'offline') {
      values = { tiers: offlineTiers };
    } else {
      values = bridge;
    }
    setSaving(true);
    try {
      const { data: res } = await profitSplitApi.save({ ...values, mode });
      setData(res.data);
      message.success('分成比例已保存');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>利润分成设置</Title>
      <Text type="secondary">一单利润固定为100%，请按模式分别设置工作室、店长、客服、陪玩各自分成。</Text>
      <Tabs activeKey={mode} onChange={setMode} items={MODES.map((m) => ({ key: m.key, label: m.label }))} style={{ marginTop: 12 }} />
      <Row gutter={16} style={{ marginTop: 16 }}>
        {mode === 'online' ? (
          <>
            <Col span={12}>
              <Card title="比例设置" size="small">
                <Form form={form} layout="vertical">
                  <div style={{ marginBottom: 12 }}>
                    <Text type={isFullPercentTotal(KEYS.map((k) => onlineValues[k])) ? 'success' : 'danger'}>
                      合计 {onlineTotal}%
                    </Text>
                    <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                      改任意一栏，陪玩那一栏自动补足到 100%
                    </Text>
                  </div>
                  {KEYS.map((k) => (
                    <Form.Item key={k} name={k} label={LABELS[k]} rules={[{ required: true }]}>
                      <InputNumber min={0} max={100} addonAfter="%" style={{ width: '100%' }}
                        onChange={(v) => changeOnlinePercent(k, v as number | null)} />
                    </Form.Item>
                  ))}
                  <Button type="primary" block loading={saving} onClick={save}>保存比例</Button>
                </Form>
              </Card>
            </Col>
            <Col span={12}>
              <Card title="分成占比" size="small">
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={chartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                      {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => `${v}%`} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </Card>
            </Col>
          </>
        ) : mode === 'offline' ? (
          <Col span={24}>
            <Card title="阶梯分成设置" size="small">
              {offlineTiers.map((tier: any, idx: number) => (
                <Row key={idx} gutter={12} style={{ marginBottom: 8 }}>
                  <Col span={4}><Text>陪玩月流水最低</Text><InputNumber style={{ width: '100%' }} value={tier.min} onChange={(v) => setOfflineTiers((prev) => prev.map((x, i) => i === idx ? { ...x, min: v } : x))} /></Col>
                  <Col span={4}><Text>陪玩月流水最高</Text><InputNumber style={{ width: '100%' }} value={tier.max ?? undefined} onChange={(v) => setOfflineTiers((prev) => prev.map((x, i) => i === idx ? { ...x, max: v } : x))} /></Col>
                  <Col span={4}><Text>陪玩%</Text><InputNumber style={{ width: '100%' }} value={tier.companion} onChange={(v) => setOfflineTiers((prev) => prev.map((x, i) => i === idx ? { ...x, companion: clampPercent(v), studio: complementPercent(v) } : x))} /></Col>
                  <Col span={4}><Text>工作室%</Text><InputNumber style={{ width: '100%' }} value={tier.studio} onChange={(v) => setOfflineTiers((prev) => prev.map((x, i) => i === idx ? { ...x, studio: clampPercent(v), companion: complementPercent(v) } : x))} /></Col>
                  <Col span={4}><Text>注册满N月</Text><InputNumber style={{ width: '100%' }} min={0} value={tier.minTenureMonths ?? 0} onChange={(v) => setOfflineTiers((prev) => prev.map((x, i) => i === idx ? { ...x, minTenureMonths: Number(v || 0) } : x))} /></Col>
                </Row>
              ))}
              <Button type="primary" loading={saving} onClick={save}>保存阶梯分成</Button>
            </Card>
          </Col>
        ) : (
          <Col span={24}>
            <Card title="桥接首单结算规则" size="small">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <div>机密首单不结账：<Switch checked={bridge.confidentialSettle} onChange={(v) => setBridge({ ...bridge, confidentialSettle: v })} /></div>
                <div>绝密首单返还：<InputNumber value={bridge.secretRefund} onChange={(v) => setBridge({ ...bridge, secretRefund: Number(v || 0) })} addonBefore="¥" /></div>
                <Button type="primary" loading={saving} onClick={save}>保存桥接规则</Button>
              </Space>
            </Card>
          </Col>
        )}
      </Row>
    </div>
  );
};

export default ProfitSplitPage;
