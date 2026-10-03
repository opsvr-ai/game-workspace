// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Card, InputNumber, Button, Typography, Space, message, Row, Col, Divider } from 'antd';
import { ReloadOutlined, SaveOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';
import { SettingsField as Field } from '../../components/settings/SettingsField';

const { Text } = Typography;

type Tier = { min: number; score: number };

const TIER_DEFS: Array<{ key: string; label: string; def: Tier[] }> = [
  { key: 'excellence.revenue_tiers', label: '月流水（元）', def: [{ min: 0, score: 0 }, { min: 3000, score: 20 }, { min: 6000, score: 40 }, { min: 10000, score: 50 }] },
  { key: 'excellence.renew_tiers', label: '续单率（%）', def: [{ min: 0, score: 0 }, { min: 30, score: 10 }, { min: 60, score: 20 }] },
  { key: 'excellence.repurchase_tiers', label: '复购率（%）', def: [{ min: 0, score: 0 }, { min: 30, score: 10 }, { min: 60, score: 20 }] },
  { key: 'excellence.first_success_tiers', label: '首单成功率（%）', def: [{ min: 0, score: 0 }, { min: 40, score: 5 }, { min: 70, score: 10 }] },
];

const TierEditor = ({ label, tiers, onChange }: { label: string; tiers: Tier[]; onChange: (tiers: Tier[]) => void }) => {
  const update = (i: number, patch: Partial<Tier>) => onChange(tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const add = () => onChange([...tiers, { min: 0, score: 0 }]);
  const remove = (i: number) => onChange(tiers.filter((_, idx) => idx !== i));
  // 老板 2026-10-04：改成「达成就加分」以后，「满分 XX」跟实际填的数字对不上、看着绕，
  // 这里直接算给你看：这一项全部达标加起来是多少分。
  const total = tiers.reduce((sum, t) => sum + (Number(t.score) || 0), 0);
  return (
    <div style={{ marginBottom: 18 }}>
      <Text strong>{label}</Text>
      <Text type="secondary" style={{ marginLeft: 8 }}>全部达标合计 {total} 分</Text>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tiers.map((t, i) => (
          <Space key={i} size={6}>
            <Text type="secondary">达到</Text>
            <InputNumber min={0} value={t.min} onChange={(v) => update(i, { min: v ?? 0 })} style={{ width: 110 }} />
            <Text type="secondary">加</Text>
            <InputNumber min={0} value={t.score} onChange={(v) => update(i, { score: v ?? 0 })} style={{ width: 90 }} />
            <Text type="secondary">分</Text>
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => remove(i)} />
          </Space>
        ))}
        <Button size="small" icon={<PlusOutlined />} onClick={add}>加一条规则</Button>
      </div>
    </div>
  );
};

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
  const getTiers = (key: string, def: Tier[]) => config?.[key] ?? def;
  const setTiers = (key: string, tiers: Tier[]) => setConfig((c: any) => ({ ...c, [key]: tiers }));

  const save = async () => {
    setSaving(true);
    try {
      await configApi.update({
        'excellence.revenue_tiers': config?.['excellence.revenue_tiers'],
        'excellence.renew_tiers': config?.['excellence.renew_tiers'],
        'excellence.repurchase_tiers': config?.['excellence.repurchase_tiers'],
        'excellence.first_success_tiers': config?.['excellence.first_success_tiers'],
        'excellence.excellent_threshold': config?.['excellence.excellent_threshold'] ?? 50,
        'excellence.middle_tier_threshold': config?.['excellence.middle_tier_threshold'] ?? 25,
        'excellence.battle_screenshot_bonus': config?.['excellence.battle_screenshot_bonus'] ?? 1,
        'excellence.low_tier_auto_resign_days': config?.['excellence.low_tier_auto_resign_days'] ?? 0,
        'dispatch.top_tier_daily_new_limit': config?.['dispatch.top_tier_daily_new_limit'] ?? 999,
        'dispatch.middle_tier_daily_new_limit': config?.['dispatch.middle_tier_daily_new_limit'] ?? 2,
        'dispatch.low_tier_daily_new_limit': config?.['dispatch.low_tier_daily_new_limit'] ?? 1,
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
        title="🏆 综合评分（达成就加分）与抢单名额"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>保存</Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          综合分 = 月流水 + 续单率 + 复购率 + 首单成功率 + 战绩图加分。
          每一条都是「达到 X 就加 Y 分」，满足几条就把这几条的分<b>加起来</b>
          （比如填了「达到 3000 加 20 分」「达到 6000 加 30 分」，那流水 6000 的人是 20+30=50 分）。
          综合分达到上等马线进入上等马。
        </Text>
        <Row gutter={24}>
          <Col span={12}>
            {TIER_DEFS.slice(0, 2).map((td) => (
              <TierEditor key={td.key} label={td.label} tiers={getTiers(td.key, td.def)} onChange={(tiers) => setTiers(td.key, tiers)} />
            ))}
          </Col>
          <Col span={12}>
            {TIER_DEFS.slice(2).map((td) => (
              <TierEditor key={td.key} label={td.label} tiers={getTiers(td.key, td.def)} onChange={(tiers) => setTiers(td.key, tiers)} />
            ))}
          </Col>
        </Row>
        <Divider />
        <Row gutter={24}>
          <Col span={12}>
            {/* 老板 2026-10-04：改成「达成就加分」以后综合分能超过 100（四项全满是 125），
                这两条线还卡着 max=100 就填不了（线上现在就是 999），把上限去掉。 */}
            <Field label="上等马线（分）" value={config?.['excellence.excellent_threshold'] ?? 50} step={1} onChange={(v) => update('excellence.excellent_threshold', v)} suffix="达到即进入上等马" />
            <Field label="中等马线（分）" value={config?.['excellence.middle_tier_threshold'] ?? 25} step={1} onChange={(v) => update('excellence.middle_tier_threshold', v)} suffix="低于此分为下等马" />
            <Field label="下等马自动离职天数" value={config?.['excellence.low_tier_auto_resign_days'] ?? 0} step={1} onChange={(v) => update('excellence.low_tier_auto_resign_days', v)} suffix="0=不自动离职" />
          </Col>
          <Col span={12}>
            <Field label="战绩图每组加分（分）" value={config?.['excellence.battle_screenshot_bonus'] ?? 1} step={0.5} onChange={(v) => update('excellence.battle_screenshot_bonus', v)} suffix="管理端采纳后加分" />
            <Field label="上等马每日有效客户名额" value={config?.['dispatch.top_tier_daily_new_limit'] ?? 999} step={1} onChange={(v) => update('dispatch.top_tier_daily_new_limit', v)} suffix="成交才占名额" />
            <Field label="中等马每日有效客户名额" value={config?.['dispatch.middle_tier_daily_new_limit'] ?? 2} step={1} onChange={(v) => update('dispatch.middle_tier_daily_new_limit', v)} suffix="成交才占名额" />
            <Field label="下等马每日有效客户名额" value={config?.['dispatch.low_tier_daily_new_limit'] ?? 1} step={1} onChange={(v) => update('dispatch.low_tier_daily_new_limit', v)} suffix="成交才占名额" />
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default ExcellenceSettings;
