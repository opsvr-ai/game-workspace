import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Form, InputNumber, Row, message, Tabs, Typography } from 'antd';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { profitSplitApi } from '../../api/profitSplit';

const { Title, Text } = Typography;

const COLORS = ['#2563EB', '#F59E0B', '#10B981', '#8B5CF6'];
const KEYS = ['studio', 'admin', 'cs', 'companion'] as const;
const LABELS: Record<string, string> = { studio: '工作室', admin: '店长', cs: '客服', companion: '陪玩' };
const MODES = [
  { key: 'offline', label: '线下工作室' },
  { key: 'online', label: '线上俱乐部' },
  { key: 'bridge', label: '桥接工作室' },
];

const ProfitSplitPage: React.FC = () => {
  const [form] = Form.useForm();
  const [data, setData] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('offline');

  const load = async () => {
    const { data: res } = await profitSplitApi.get(mode);
    setData(res.data);
    form.setFieldsValue(res.data);
  };

  useEffect(() => { load(); }, [mode]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return KEYS.map((k) => ({ name: LABELS[k], value: Number(data[k] || 0) }));
  }, [data]);

  const save = async () => {
    const values = await form.validateFields();
    const total = KEYS.reduce((s, k) => s + Number(values[k] || 0), 0);
    if (Math.abs(total - 100) > 0.001) {
      message.error(`比例合计必须为100%，当前为${total}%`);
      return;
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
        <Col span={12}>
          <Card title="比例设置" size="small">
            <Form form={form} layout="vertical">
              {KEYS.map((k) => (
                <Form.Item key={k} name={k} label={LABELS[k]} rules={[{ required: true }]}>
                  <InputNumber min={0} max={100} addonAfter="%" style={{ width: '100%' }} />
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
      </Row>
    </div>
  );
};

export default ProfitSplitPage;
