// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Alert, Card, InputNumber, Button, Typography, Space, Row, Col, Divider, Slider } from 'antd';
import { message } from '../../utils/feedback';
import { ReloadOutlined, SaveOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';
import { SettingsField as Field } from '../../components/settings/SettingsField';
import { BORDER, BRAND, TEXT, TIER_TINT, SEMANTIC } from '../../styles/tokens';

const { Text } = Typography;

type Tier = { min: number; score: number };

const TIER_DEFS: Array<{ key: string; label: string; unit: string; def: Tier[] }> = [
  { key: 'excellence.revenue_tiers', label: '最近 30 天业绩', unit: '元', def: [{ min: 0, score: 0 }, { min: 3000, score: 20 }, { min: 6000, score: 30 }, { min: 8000, score: 45 }, { min: 10000, score: 50 }] },
  { key: 'excellence.renew_tiers', label: '续单率', unit: '%', def: [{ min: 0, score: 0 }, { min: 30, score: 10 }, { min: 50, score: 20 }] },
  { key: 'excellence.repurchase_tiers', label: '复购率', unit: '%', def: [{ min: 0, score: 0 }, { min: 30, score: 10 }, { min: 50, score: 20 }] },
  { key: 'excellence.first_success_tiers', label: '首单成功率', unit: '%', def: [{ min: 0, score: 0 }, { min: 30, score: 5 }, { min: 50, score: 10 }] },
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
  // 老板 2026-10-04 二次改：段位线改成「一条线分三段」，他填两个数（比如 60 / 90）。
  // 线上可能还留着旧值（上等马线 999），这里显示时按 0~100 夹住并给提示，不偷偷改他的存量值。
  const rawMidThreshold = Number(config?.['excellence.middle_tier_threshold'] ?? 25);
  const rawTopThreshold = Number(config?.['excellence.excellent_threshold'] ?? 50);
  const midThreshold = Math.max(0, Math.min(100, Number.isFinite(rawMidThreshold) ? rawMidThreshold : 0));
  const topThreshold = Math.max(midThreshold, Math.min(100, Number.isFinite(rawTopThreshold) ? rawTopThreshold : 0));
  // 老板 2026-10-04：最近 30 天业绩硬门槛 —— 没到这条线一律下等马（分数再高也不算），业绩达标最低中等马。
  const revenueFloor = Math.max(0, Number(config?.['excellence.revenue_floor'] ?? 5200) || 0);
  const lineMarks: Record<number, any> = {
    0: { style: { fontSize: 11 }, label: '0' },
    100: { style: { fontSize: 11 }, label: '100' },
  };
  lineMarks[midThreshold] = { style: { fontSize: 11, color: BRAND.primary, fontWeight: 600 }, label: String(midThreshold) };
  lineMarks[topThreshold] = { style: { fontSize: 11, color: TIER_TINT.top, fontWeight: 600 }, label: String(topThreshold) };

  const save = async () => {
    setSaving(true);
    try {
      await configApi.update({
        'excellence.revenue_tiers': config?.['excellence.revenue_tiers'],
        'excellence.renew_tiers': config?.['excellence.renew_tiers'],
        'excellence.repurchase_tiers': config?.['excellence.repurchase_tiers'],
        'excellence.first_success_tiers': config?.['excellence.first_success_tiers'],
        'excellence.excellent_threshold': config?.['excellence.excellent_threshold'] ?? 85,
        'excellence.middle_tier_threshold': config?.['excellence.middle_tier_threshold'] ?? 60,
        'excellence.revenue_floor': config?.['excellence.revenue_floor'] ?? 5200,
        'excellence.battle_screenshot_bonus': config?.['excellence.battle_screenshot_bonus'] ?? 1,
        'excellence.battle_screenshot_bonus_cap': config?.['excellence.battle_screenshot_bonus_cap'] ?? 10,
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
          <b>段位分 = 最近 30 天业绩 + 续单率 + 复购率 + 首单成功率</b>（段位只看这四项）。
          每一项只取「达到的<b>最高一档</b>」的分，<b>不叠加</b>
          （比如填了「达到 6000 得 20 分」「达到 10000 得 40 分」，业绩 10000 的人这一项就是 40 分，不是 20+40）。
          段位分按下面这条分数线分成 下等马 / 中等马 / 上等马 三档。
          <br />
          <b>战绩图加分只加在「综合分 / 排行榜」上，不参与段位判定</b> ——
          防止「业绩、三率都不够，靠堆截图也能维持上等马」，那样段位就没意义了。
          <br />
          <b>但段位还有一条更硬的线</b>：<b>最近 30 天业绩没到「业绩硬门槛」的人一律下等马</b>（其他分再高也不算）；
          反过来，<b>业绩达标的人最低也是中等马</b> —— 要的少、挣得少可以理解，要的少、挣得多才是最理想的陪玩。
          <br />
          <b>续单率</b> = 最近 30 天里「有第 2 段及以后**已打完**会话（点续单加的那段、且已结束）」的客户占比；
          <b>复购率</b> = 隔了一个营业日（12:00 为界）又来打的客户占比；
          两者分母都是「打了首单的客户数」；
          <b>首单成功率</b> = 打完的首单客户数 ÷ 「添加成功」的客户数
          （成交首单 = 这张首单<b>已经打完（结束过）</b>才算；点了「开始首单」还在打的<b>不算</b>，
          加了微信没打成的也留在分母里）。
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
          description={`段位分 = 最近 30 天业绩 ${maxOf('excellence.revenue_tiers')} + 续单率 ${maxOf('excellence.renew_tiers')} + 复购率 ${maxOf('excellence.repurchase_tiers')} + 首单成功率 ${maxOf('excellence.first_success_tiers')}。超过 100 分保存会被服务端拦下。战绩图加分另算，不影响段位。`}
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
            {/* 老板 2026-10-04 二次改：不要两个分开的输入框，要「一条线分三段」——
                填两个数（比如 60 / 90）：< 60 下等马，60 ~ 89 中等马，≥ 90 上等马。 */}
            <div style={{ marginBottom: 18 }}>
              <Text strong>段位分数线</Text>
              <Text type="secondary" style={{ marginLeft: 8 }}>直接填两个数，或者在下面的线上拖（满分 100）</Text>
              <Row gutter={12} style={{ marginTop: 8 }}>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>中等马起（低于此分 = 下等马）</Text>
                  <InputNumber
                    min={0}
                    max={100}
                    step={1}
                    style={{ width: '100%' }}
                    value={midThreshold}
                    onChange={(v) => update('excellence.middle_tier_threshold', Math.min(Number(v ?? 0), topThreshold))}
                    suffix="分"
                  />
                </Col>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>上等马起（达到此分 = 上等马）</Text>
                  <InputNumber
                    min={0}
                    max={100}
                    step={1}
                    style={{ width: '100%' }}
                    value={topThreshold}
                    onChange={(v) => update('excellence.excellent_threshold', Math.max(Number(v ?? 0), midThreshold))}
                    suffix="分"
                  />
                </Col>
              </Row>
              <div style={{ padding: '0 6px', marginTop: 6 }}>
                <Slider
                  range
                  min={0}
                  max={100}
                  step={1}
                  value={[midThreshold, topThreshold]}
                  marks={lineMarks}
                  tooltip={{ formatter: (v) => `${v} 分` }}
                  onChange={(v) => {
                    const [m, e] = v as number[];
                    update('excellence.middle_tier_threshold', m);
                    update('excellence.excellent_threshold', e);
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
                <div style={{ flex: 1, textAlign: 'center', background: BORDER.secondary, borderRadius: 8, padding: '6px 4px' }}>
                  <div style={{ fontSize: 12, color: TEXT.secondary }}>下等马</div>
                  <div style={{ fontWeight: 700, color: '#8c8c8c' }}>0 – {Math.max(0, midThreshold - 1)} 分</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center', background: '#E8F1FF', borderRadius: 8, padding: '6px 4px' }}>
                  <div style={{ fontSize: 12, color: TEXT.secondary }}>中等马</div>
                  <div style={{ fontWeight: 700, color: BRAND.primary }}>{midThreshold} – {Math.max(midThreshold, topThreshold - 1)} 分</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center', background: SEMANTIC.warningSoft, borderRadius: 8, padding: '6px 4px' }}>
                  <div style={{ fontSize: 12, color: TEXT.secondary }}>上等马</div>
                  <div style={{ fontWeight: 700, color: TIER_TINT.top }}>{topThreshold} – 100 分</div>
                </div>
              </div>
              {revenueFloor > 0 ? (
                <Text type="secondary" style={{ display: 'block', marginTop: 10, fontSize: 12 }}>
                  上面这三段只是「按分数」分 —— 真正的段位还看一条硬线：最近 30 天业绩没到 {revenueFloor} 元的一律下等马
                  （分数再高也不算；要的少、挣得少可以理解，留着也妨），业绩达标的人最低也是中等马。
                </Text>
              ) : null}
              {rawTopThreshold > 100 ? (
                <Text type="warning" style={{ display: 'block', marginTop: 10 }}>
                  当前存的上等马线还是 {rawTopThreshold} 分（超过满分 100），上面的线先按 100 显示 —— 请拖一下或直接填个数再保存。
                </Text>
              ) : topThreshold > fourMax ? (
                <Text type="warning" style={{ display: 'block', marginTop: 10 }}>
                  上等马线 {topThreshold} 分高于四项满分 {fourMax} 分 —— 这样没有一个人能进上等马。
                </Text>
              ) : null}
            </div>
            <Field label="业绩硬门槛" unit="元" value={config?.['excellence.revenue_floor'] ?? 5200} step={100} onChange={(v) => update('excellence.revenue_floor', v)} suffix="最近 30 天业绩没到它一律下等马（填 0 = 关掉这条硬线）" />
            <Field label="下等马自动离职天数" value={config?.['excellence.low_tier_auto_resign_days'] ?? 0} step={1} onChange={(v) => update('excellence.low_tier_auto_resign_days', v)} suffix="0=不自动离职" />
          </Col>
          <Col span={12}>
            <Field label="战绩图每组加分" unit="分" value={config?.['excellence.battle_screenshot_bonus'] ?? 1} step={0.5} onChange={(v) => update('excellence.battle_screenshot_bonus', v)} suffix="管理端采纳后加分（只进综合分 / 排行榜）" />
            <Field label="战绩图加分上限" unit="分" value={config?.['excellence.battle_screenshot_bonus_cap'] ?? 10} step={1} onChange={(v) => update('excellence.battle_screenshot_bonus_cap', v)} suffix="最多加到几分，防堆图刷分；填 0 = 不封顶" />
            <Field label="上等马每日有效客户名额" value={config?.['dispatch.top_tier_daily_new_limit'] ?? 999} step={1} onChange={(v) => update('dispatch.top_tier_daily_new_limit', v)} suffix="抢单那一刻就占，没用完累计" />
            <Field label="中等马每日有效客户名额" value={config?.['dispatch.middle_tier_daily_new_limit'] ?? 2} step={1} onChange={(v) => update('dispatch.middle_tier_daily_new_limit', v)} suffix="抢单那一刻就占，没用完累计" />
            <Field label="下等马每日有效客户名额" value={config?.['dispatch.low_tier_daily_new_limit'] ?? 1} step={1} onChange={(v) => update('dispatch.low_tier_daily_new_limit', v)} suffix="抢单那一刻就占，没用完累计" />
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default ExcellenceSettings;
