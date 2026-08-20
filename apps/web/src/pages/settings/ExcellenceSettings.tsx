// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Card, InputNumber, Button, Typography, Space, message, Row, Col, Alert } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';

const { Text } = Typography;

const Field = ({ label, value, onChange, min = 0, step = 1, suffix, max }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  suffix?: string;
  max?: number;
}) => (
  <div style={{ marginBottom: 12 }}>
    <Text style={{ display: 'inline-block', minWidth: 200 }}>{label}</Text>
    <InputNumber min={min} max={max} step={step} value={value} onChange={(v) => onChange(v ?? 0)} style={{ width: 140 }} />
    {suffix && <Text type="secondary" style={{ marginLeft: 8 }}>{suffix}</Text>}
  </div>
);

const ExcellenceSettings: React.FC = () => {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await configApi.getAll();
      setConfig(data.data);
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const update = (key: string, value: number) => setConfig((c: any) => ({ ...c, [key]: value }));

  const weights = [
    { key: 'excellence.revenue_weight', label: '月流水满分（分）', def: 50 },
    { key: 'excellence.renew_weight', label: '续单率满分（分）', def: 20 },
    { key: 'excellence.repurchase_weight', label: '复购率满分（分）', def: 20 },
    { key: 'excellence.first_success_weight', label: '首单成功率满分（分）', def: 10 },
  ];
  const totalWeight = weights.reduce((s, w) => s + (config?.[w.key] ?? w.def), 0);
  const threshold = config?.['excellence.excellent_threshold'] ?? 50;
  const weightInvalid = totalWeight > 100;
  const thresholdInvalid = threshold > totalWeight;

  const save = async () => {
    if (weightInvalid) {
      message.error(`评分权重满分之和不能超过 100 分（当前 ${totalWeight} 分）`);
      return;
    }
    if (thresholdInvalid) {
      message.error(`优秀线不能超过满分（当前满分 ${totalWeight} 分）`);
      return;
    }
    setSaving(true);
    try {
      await configApi.update({
        'excellence.revenue_weight': config?.['excellence.revenue_weight'] ?? 50,
        'excellence.revenue_cap_yuan': config?.['excellence.revenue_cap_yuan'] ?? 10000,
        'excellence.renew_weight': config?.['excellence.renew_weight'] ?? 20,
        'excellence.repurchase_weight': config?.['excellence.repurchase_weight'] ?? 20,
        'excellence.first_success_weight': config?.['excellence.first_success_weight'] ?? 10,
        'excellence.excellent_threshold': config?.['excellence.excellent_threshold'] ?? 50,
        'excellence.middle_tier_threshold': config?.['excellence.middle_tier_threshold'] ?? 25,
        'excellence.battle_screenshot_bonus': config?.['excellence.battle_screenshot_bonus'] ?? 1,
        'dispatch.nonqualified_daily_new_limit': config?.['dispatch.nonqualified_daily_new_limit'] ?? 1,
        'pool.daily_customer_quota': config?.['pool.daily_customer_quota'] ?? 3,
        'pool.daily_grab_limit': config?.['pool.daily_grab_limit'] ?? 20,
      });
      message.success('评分与名额配置已保存');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !config) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">加载中...</Text></div>;
  }

  return (
    <div>
      <Card
        title="🏆 综合评分权重与抢单名额"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button type="primary" icon={React.createElement(SaveOutlined)} loading={saving} onClick={save}>保存</Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          综合分 = 月流水分 + 续单率分 + 复购率分 + 首单成功率分 + 战绩图加分；达到「优秀线」进入优秀行列。
        </Text>
        {weightInvalid && (
          <Alert type="error" showIcon style={{ marginBottom: 12 }} message={`四项权重满分之和不能超过 100 分（当前 ${totalWeight} 分）`} />
        )}
        {thresholdInvalid && (
          <Alert type="error" showIcon style={{ marginBottom: 12 }} message={`优秀线不能超过满分（当前满分 ${totalWeight} 分）`} />
        )}
        <Row gutter={24}>
          <Col span={12}>
            {weights.map((w) => (
              <Field key={w.key} label={w.label} value={config?.[w.key] ?? w.def} step={1} max={100} onChange={(v) => update(w.key, v)} />
            ))}
            <Field label="月流水满分金额（元）" value={config?.['excellence.revenue_cap_yuan'] ?? 10000} step={100} onChange={(v) => update('excellence.revenue_cap_yuan', v)} suffix="达到此金额即满分" />
            <Field label="优秀线（分）" value={threshold} step={1} max={100} onChange={(v) => update('excellence.excellent_threshold', v)} suffix="达到即进入优秀" />
            <Field label="中等马线（分）" value={config?.['excellence.middle_tier_threshold'] ?? 25} step={1} max={100} onChange={(v) => update('excellence.middle_tier_threshold', v)} suffix="低于此分为下等马" />
          </Col>
          <Col span={12}>
            <Field label="战绩图每组加分（分）" value={config?.['excellence.battle_screenshot_bonus'] ?? 1} step={0.5} onChange={(v) => update('excellence.battle_screenshot_bonus', v)} suffix="管理端采纳后加分" />
            <Field label="不优秀每日新客名额" value={config?.['dispatch.nonqualified_daily_new_limit'] ?? 1} step={1} onChange={(v) => update('dispatch.nonqualified_daily_new_limit', v)} suffix="优秀陪玩不限名额" />
            <Field label="每日有效客户名额" value={config?.['pool.daily_customer_quota'] ?? 3} step={1} onChange={(v) => update('pool.daily_customer_quota', v)} />
            <Field label="每日抢单上限" value={config?.['pool.daily_grab_limit'] ?? 20} step={1} onChange={(v) => update('pool.daily_grab_limit', v)} />
            <div style={{ marginTop: 16 }}>
              <Text type="secondary">当前权重满分之和：<b style={{ color: weightInvalid ? '#f5222d' : '#16A34A' }}>{totalWeight}</b> 分</Text>
            </div>
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default ExcellenceSettings;
