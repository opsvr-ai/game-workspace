// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Alert, Card, InputNumber, Button, Typography, Space, message, Row, Col, Divider } from 'antd';
import { ReloadOutlined, SaveOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';
import { SettingsField as Field } from '../../components/settings/SettingsField';

const { Text } = Typography;

type Tier = { min: number; score: number };

const TIER_DEFS: Array<{ key: string; label: string; unit: string; def: Tier[] }> = [
  { key: 'excellence.revenue_tiers', label: '月流水', unit: '元', def: [{ min: 0, score: 0 }, { min: 3000, score: 20 }, { min: 6000, score: 40 }, { min: 10000, score: 50 }] },
  { key: 'excellence.renew_tiers', label: '续单率', unit: '%', def: [{ min: 0, score: 0 }, { min: 30, score: 10 }, { min: 60, score: 20 }] },
  { key: 'excellence.repurchase_tiers', label: '复购率', unit: '%', def: [{ min: 0, score: 0 }, { min: 30, score: 10 }, { min: 60, score: 20 }] },
  { key: 'excellence.first_success_tiers', label: '首单成功率', unit: '%', def: [{ min: 0, score: 0 }, { min: 40, score: 5 }, { min: 70, score: 10 }] },
];

const TierEditor = ({ label, unit, tiers, onChange }: { label: string; unit: string; tiers: Tier[]; onChange: (tiers: Tier[]) => void }) => {
  const update = (i: number, patch: Partial<Tier>) => onChange(tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const add = () => onChange([...tiers, { min: 0, score: 0 }]);
  const remove = (i: number) => onChange(tiers.filter((_, idx) => idx !== i));
  // 老板 2026-10-04：「到了什么档次就给他重新统计为多少分，别叠加」——
  // 这一项的分 = 达到的最高那一档的分，所以「满分」就是所有档位里最大的那个分。
  const maxScore = tiers.reduce((m, t) => Math.max(m, Number(t.score) || 0), 0);
  return (
    <div style={{ marginBottom: 18 }}>
      <Text strong>{label}</Text>
      <Text type="secondary" style={{ marginLeft: 8 }}>满分 {maxScore} 分（取达到的最高一档，不叠加）</Text>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tiers.map((t, i) => (
          <Space key={i} size={6}>
            <Text type="secondary">达到</Text>
            <InputNumber min={0} value={t.min} onChange={(v) => update(i, { min: v ?? 0 })} suffix={unit} style={{ width: 110 }} />
            <Text type="secondary">得</Text>
            <InputNumber min={0} value={t.score} onChange={(v) => update(i, { score: v ?? 0 })} suffix="分" style={{ width: 90 }} />
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => remove(i)} />
          </Space>
        ))}
        <Button size="small" icon={<PlusOutlined />} onClick={add}>加一档</Button>
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
  /** 某一项的满分 = 该项所有档位里最大的分（只取最高一档，不叠加）。 */
  const maxOf = (key: string) => {
    const list = (config?.[key] ?? TIER_DEFS.find((d) => d.key === key)!.def) as Tier[];
    return list.reduce((m, t) => Math.max(m, Number(t?.score) || 0), 0);
  };
  // 老板 2026-10-04：四项满分之和不能超过 100，超了要当场提醒（服务端保存时也会拦）。
  const fourMax = TIER_DEFS.reduce((sum, td) => sum + maxOf(td.key), 0);
  const excellentThreshold = Number(config?.['excellence.excellent_threshold'] ?? 50);

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
        title="🏆 综合评分（取最高一档算分）与抢单名额"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>保存</Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          综合分 = 月流水 + 续单率 + 复购率 + 首单成功率 + 战绩图加分。
          每一项只取「达到的<b>最高一档</b>」的分，<b>不叠加</b>
          （比如填了「达到 6000 得 20 分」「达到 10000 得 40 分」，流水 10000 的人这一项就是 40 分，不是 20+40）。
          综合分达到上等马线进入上等马。
        </Text>
        <Alert
          type={fourMax > 100 ? 'error' : 'success'}
          showIcon
          style={{ marginBottom: 16 }}
          message={
            fourMax > 100
              ? `四项满分合计 ${fourMax} 分，超过 100 了 —— 请把某一项调小再保存`
              : `四项满分合计 ${fourMax} 分（上限 100）`
          }
          description={`月流水 ${maxOf('excellence.revenue_tiers')} + 续单率 ${maxOf('excellence.renew_tiers')} + 复购率 ${maxOf('excellence.repurchase_tiers')} + 首单成功率 ${maxOf('excellence.first_success_tiers')}。超过 100 分保存会被服务端拦下。`}
        />
        <Row gutter={24}>
          <Col span={12}>
            {TIER_DEFS.slice(0, 2).map((td) => (
              <TierEditor key={td.key} label={td.label} unit={td.unit} tiers={getTiers(td.key, td.def)} onChange={(tiers) => setTiers(td.key, tiers)} />
            ))}
          </Col>
          <Col span={12}>
            {TIER_DEFS.slice(2).map((td) => (
              <TierEditor key={td.key} label={td.label} unit={td.unit} tiers={getTiers(td.key, td.def)} onChange={(tiers) => setTiers(td.key, tiers)} />
            ))}
          </Col>
        </Row>
        <Divider />
        <Row gutter={24}>
          <Col span={12}>
            {/* 老板 2026-10-04：分数是「取达到的最高一档」，四项满分合计 ≤ 100，所以这两条线不设死的上限。 */}
            <Field label="上等马线" unit="分" value={config?.['excellence.excellent_threshold'] ?? 50} step={1} onChange={(v) => update('excellence.excellent_threshold', v)} suffix="达到即进入上等马" />
            {excellentThreshold > fourMax ? (
              <Text type="warning" style={{ display: 'block', marginBottom: 12 }}>
                上等马线 {excellentThreshold} 分高于四项满分 {fourMax} 分 —— 这样没有一个人能进上等马。
              </Text>
            ) : null}
            <Field label="中等马线" unit="分" value={config?.['excellence.middle_tier_threshold'] ?? 25} step={1} onChange={(v) => update('excellence.middle_tier_threshold', v)} suffix="低于此分为下等马" />
            <Field label="下等马自动离职天数" value={config?.['excellence.low_tier_auto_resign_days'] ?? 0} step={1} onChange={(v) => update('excellence.low_tier_auto_resign_days', v)} suffix="0=不自动离职" />
          </Col>
          <Col span={12}>
            <Field label="战绩图每组加分" unit="分" value={config?.['excellence.battle_screenshot_bonus'] ?? 1} step={0.5} onChange={(v) => update('excellence.battle_screenshot_bonus', v)} suffix="管理端采纳后加分" />
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
