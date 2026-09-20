// craftsman-ignore: TS001,TS002
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, InputNumber, Popconfirm, Space, Typography, message } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';
import { clampPercent, FULL_PERCENT } from '../../utils/percent';

const { Text } = Typography;

/**
 * 分账规则（老板 2026-09-21）
 *
 * 一单流水由 **陪玩 / 店长 / 客服 / 工作室** 四个人分，四个数字加起来永远 100%。
 * 所以这一页从上到下就按这个顺序排四行：
 *
 * - 陪玩：线下按当月流水分档（一档一列），线上俱乐部用固定比例；
 * - 店长：全店统一，不随流水变化，按流水比例提成；
 * - 客服：线下按流水比例、线上按每单固定金额；
 * - 工作室：**自动** = 100 − 陪玩 − 店长 − 客服，只读、不用手填 —— 从源头杜绝「加起来 120%」，
 *   库里存的也正好是工作室真正拿到手的份额（对账直接用这个数）。
 *
 * 保存时这几个键一起提交，页面之间（利润分成页、客服设置、店长设置、左侧栏比例）永远是一个数。
 */

/** 线上俱乐部（固定比例）陪玩分成的兜底值，和后端缺配置时的默认一致。 */
const DEFAULT_CLUB_COMPANION_SHARE = 80;

const CONFIG_KEYS = [
  'revenue.share_tiers',
  'revenue.club_companion_share',
  'commission.cs_offline_rate_percent',
  'commission.admin_offline_rate_percent',
  'commission.cs_online_per_order_yuan',
  'commission.admin_online_rate_percent',
];

interface ShareTier {
  min: number;
  max: number | null;
  companion: number;
  studio?: number;
  [key: string]: unknown;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 四个人的语义色：陪玩（紫）/ 店长（蓝）/ 客服（橙）/ 工作室（绿）。
 * 全页只用这一份，行的底色、左侧光条、工作室的数字都取它 —— 一眼能分清「这行是谁的」。
 */
const ROLE_TINT = {
  companion: '#7C4DFF',
  admin: '#3B82F6',
  cs: '#F59E0B',
  studio: '#10B981',
} as const;

const GROUP_TINT = { offline: '#10B981', online: '#00B8D9' } as const;

/** 缺配置时按后端实际生效的默认值补上：看到多少，算的就是多少。 */
const withEffectiveDefaults = (raw: any) => {
  const next: any = { ...(raw ?? {}) };
  const fill = (key: string, value: number) => {
    if (typeof next[key] !== 'number') next[key] = value;
  };
  fill('revenue.club_companion_share', DEFAULT_CLUB_COMPANION_SHARE);
  fill('commission.cs_offline_rate_percent', 1);
  fill('commission.admin_offline_rate_percent', 0);
  fill('commission.cs_online_per_order_yuan', 1);
  fill('commission.admin_online_rate_percent', 0);
  if (Array.isArray(next['revenue.share_tiers'])) {
    next['revenue.share_tiers'] = next['revenue.share_tiers'].map((t: any) => ({
      ...t,
      companion: clampPercent(t?.companion),
    }));
  }
  return next;
};

// ── 表格样式：一个网格从头用到尾，保证字号、行高、间距全页统一 ──
const GRID_BASE: React.CSSProperties = {
  display: 'grid',
  alignItems: 'stretch',
  background: '#fff',
};
const CELL: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  fontSize: 13,
  lineHeight: '22px',
  borderTop: '1px solid #eef2f7',
  minWidth: 0,
};
const HEAD_CELL: React.CSSProperties = {
  ...CELL,
  borderTop: 'none',
  background: '#f1f5f9',
  color: '#334155',
  fontSize: 12,
};
const LABEL_CELL: React.CSSProperties = {
  ...CELL,
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 0,
  background: '#f8fafc',
  borderRight: '1px solid #eef2f7',
};

const PaymentSettings: React.FC = () => {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await configApi.get(CONFIG_KEYS);
      setConfig(withEffectiveDefaults((data as any)?.data));
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const update = (key: string, value: any) => {
    setConfig((c: any) => (c ? { ...c, [key]: value } : c));
  };

  if (loading && !config) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">加载中...</Text></div>;
  }

  const tiers: ShareTier[] = config?.['revenue.share_tiers'] ?? [];
  const csOffline = clampPercent(config?.['commission.cs_offline_rate_percent'] ?? 1);
  const adminOffline = clampPercent(config?.['commission.admin_offline_rate_percent'] ?? 0);
  const clubCompanion = clampPercent(config?.['revenue.club_companion_share'] ?? DEFAULT_CLUB_COMPANION_SHARE, 1, 99);
  const adminOnline = clampPercent(config?.['commission.admin_online_rate_percent'] ?? 0);
  const csOnlinePerOrder = Number(config?.['commission.cs_online_per_order_yuan'] ?? 1);

  const offlineDeduct = round2(csOffline + adminOffline);
  const studioOf = (companion: unknown) => round2(FULL_PERCENT - clampPercent(companion) - offlineDeduct);
  const onlineStudio = round2(FULL_PERCENT - clubCompanion - adminOnline);

  const badTierIdx = tiers.findIndex((t) => studioOf(t?.companion) < 0);
  const offlineBroken = badTierIdx >= 0;
  const onlineBroken = onlineStudio < 0;

  const rangeText = (t: ShareTier, i: number) =>
    i === 0 ? '起步档' : t?.max == null ? `${t?.min ?? 0} 元起` : `${t?.min ?? 0} 元起（到 ${t?.max} 元）`;

  const setTiers = (next: ShareTier[]) => update('revenue.share_tiers', next);

  const updateTier = (idx: number, field: 'min' | 'max' | 'companion', val: any) => {
    setTiers(
      tiers.map((t, i) => {
        if (i !== idx) return t;
        if (field === 'companion') return { ...t, companion: clampPercent(val) };
        return { ...t, [field]: val };
      }),
    );
  };

  const addTier = () => {
    const prev = tiers[tiers.length - 1];
    const newMin = prev ? round2(Number(prev.max ?? 0) + 0.1) : 0;
    setTiers([...tiers, { min: newMin, max: null, companion: 50 }]);
  };

  const removeTier = (idx: number) => setTiers(tiers.filter((_, i) => i !== idx));

  const save = async () => {
    if (offlineBroken) {
      message.error(`第 ${badTierIdx + 1} 档：陪玩 + 店长 + 客服 加起来超过 100%，工作室会变成负数，请先调整`);
      return;
    }
    if (onlineBroken) {
      message.error('线上俱乐部：陪玩 + 店长 加起来超过 100% 了，请先调整');
      return;
    }
    setSaving(true);
    try {
      await configApi.update({
        'revenue.share_tiers': tiers.map((t) => ({
          ...t,
          companion: clampPercent(t?.companion),
          studio: studioOf(t?.companion),
        })),
        'revenue.club_companion_share': clubCompanion,
        'commission.admin_offline_rate_percent': adminOffline,
        'commission.cs_offline_rate_percent': csOffline,
        'commission.admin_online_rate_percent': adminOnline,
        'commission.cs_online_per_order_yuan': csOnlinePerOrder,
      });
      message.success('分账规则 已保存');
      await fetchConfig();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const gridCols = (count: number): React.CSSProperties => ({
    ...GRID_BASE,
    gridTemplateColumns: `150px repeat(${count}, minmax(196px, 1fr))`,
    minWidth: 150 + count * 196,
  });

  const labelCell = (role: keyof typeof ROLE_TINT, name: string, note: string) => (
    <div
      style={{
        ...LABEL_CELL,
        borderLeft: `3px solid ${ROLE_TINT[role]}`,
        background: `${ROLE_TINT[role]}0A`,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span className="ui-dot" style={{ background: ROLE_TINT[role] }} />
        <Text strong style={{ fontSize: 13 }}>{name}</Text>
      </span>
      <Text type="secondary" style={{ fontSize: 11, lineHeight: '16px' }}>{note}</Text>
    </div>
  );

  const percentInput = (value: number, onChange: (v: number) => void, width = 110) => (
    <Space size={4}>
      <InputNumber min={0} max={100} step={1} value={value} onChange={(v) => onChange(clampPercent(v))} style={{ width }} />
      <Text type="secondary">%</Text>
    </Space>
  );

  return (
    <Card
      title="📊 分账规则"
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchConfig} loading={loading}>刷新</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>保存</Button>
        </Space>
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          marginBottom: 18,
          borderRadius: 12,
          fontSize: 13,
          color: '#334155',
          background:
            'linear-gradient(90deg, rgba(124,77,255,0.09), rgba(0,229,255,0.06) 60%, rgba(255,255,255,0))',
          borderLeft: '3px solid #7C4DFF',
        }}
      >
        <span>
          一单流水由 <Text strong>陪玩 / 店长 / 客服 / 工作室</Text> 四个人分，四项加起来永远 100%。
          填好前三个，<Text strong style={{ color: ROLE_TINT.studio }}>工作室自动算</Text>
          （不用手填，也填不出 120%）。
        </span>
      </div>

      {/* ── 线下工作室 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span className="ui-dot" style={{ background: GROUP_TINT.offline }} />
        <Text strong style={{ fontSize: 14 }}>线下工作室（按流水阶梯分）</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          陪玩那一行按当月流水分档，其余三人全店统一
        </Text>
      </div>
      {offlineBroken && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message={`第 ${badTierIdx + 1} 档加起来超过 100% 了（陪玩 ${clampPercent(tiers[badTierIdx]?.companion)}% + 店长 ${adminOffline}% + 客服 ${csOffline}%），工作室会变成负数，请先调整`}
        />
      )}
      <div className="ui-panel" style={{ overflowX: 'auto' }}>
        <div style={gridCols(tiers.length)}>
          {/* 表头 */}
          <div style={{ ...HEAD_CELL, ...LABEL_CELL }}>分成对象</div>
          {tiers.map((t, i) => (
            <div key={`h${i}`} style={{ ...HEAD_CELL, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text strong style={{ fontSize: 12 }}>档位 {i + 1} · {rangeText(t, i)}</Text>
                {tiers.length > 1 && (
                  <Popconfirm title="确定删除这一档？" onConfirm={() => removeTier(i)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text type="secondary" style={{ fontSize: 11, flex: '0 0 52px' }}>最低流水</Text>
                <InputNumber
                  size="small" min={0} step={100} value={t?.min} disabled={i === 0}
                  onChange={(v) => updateTier(i, 'min', Number(v ?? 0))}
                  style={{ flex: 1, minWidth: 0 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text type="secondary" style={{ fontSize: 11, flex: '0 0 52px' }}>最高流水</Text>
                <InputNumber
                  size="small" min={0} step={100} value={t?.max ?? undefined} placeholder="留空 = 无上限"
                  onChange={(v) => updateTier(i, 'max', v == null ? null : Number(v))}
                  style={{ flex: 1, minWidth: 0 }}
                />
              </div>
            </div>
          ))}

          {/* 陪玩 */}
          {labelCell('companion', '陪玩', '按流水档位')}
          {tiers.map((t, i) => (
            <div key={`c${i}`} style={CELL}>
              {percentInput(clampPercent(t?.companion), (v) => updateTier(i, 'companion', v))}
            </div>
          ))}

          {/* 店长（全店统一，横向合并） */}
          {labelCell('admin', '店长', '全店统一')}
          <div style={{ ...CELL, gridColumn: `span ${tiers.length}` }}>
            {percentInput(adminOffline, (v) => update('commission.admin_offline_rate_percent', v))}
            <Text type="secondary" style={{ fontSize: 12 }}>
              全店统一，不随流水档位变化；店里多位店长时按人数均分
            </Text>
          </div>

          {/* 客服（全店统一，横向合并） */}
          {labelCell('cs', '客服', '全店统一')}
          <div style={{ ...CELL, gridColumn: `span ${tiers.length}` }}>
            {percentInput(csOffline, (v) => update('commission.cs_offline_rate_percent', v))}
            <Text type="secondary" style={{ fontSize: 12 }}>
              按流水比例提成；线上俱乐部是「每单固定金额」，在下面单独设置
            </Text>
          </div>

          {/* 工作室（自动） */}
          {labelCell('studio', '工作室', '自动算出')}
          {tiers.map((t, i) => {
            const v = studioOf(t?.companion);
            return (
              <div key={`s${i}`} style={{ ...CELL, background: `${ROLE_TINT.studio}0A` }}>
                <Text strong style={{ fontSize: 14, color: v < 0 ? '#EF4444' : ROLE_TINT.studio }}>{v}%</Text>
              </div>
            );
          })}

          {/* 添加档位 */}
          <div style={{ ...CELL, gridColumn: `span ${tiers.length + 1}`, padding: '8px 10px' }}>
            <Button type="dashed" block icon={<PlusOutlined />} onClick={addTier}>添加流水档位</Button>
          </div>
        </div>
      </div>

      {/* ── 线上俱乐部 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 26, marginBottom: 10 }}>
        <span className="ui-dot" style={{ background: GROUP_TINT.online }} />
        <Text strong style={{ fontSize: 14 }}>线上俱乐部（固定比例）</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          不按流水分档，全店只有一个比例
        </Text>
      </div>
      {onlineBroken && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message={`陪玩 ${clubCompanion}% + 店长 ${adminOnline}% 超过 100% 了，工作室会变成负数，请先调整`}
        />
      )}
      <div className="ui-panel" style={{ overflowX: 'auto' }}>
        <div style={gridCols(1)}>
          <div style={{ ...HEAD_CELL, ...LABEL_CELL }}>分成对象</div>
          <div style={{ ...HEAD_CELL, flexDirection: 'column', alignItems: 'flex-start', gap: 0 }}>
            <Text strong style={{ fontSize: 12 }}>线上俱乐部 · 固定比例</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>不分流水档位，所有线上单一个标准</Text>
          </div>

          {labelCell('companion', '陪玩', '固定比例')}
          <div style={CELL}>
            {percentInput(clubCompanion, (v) => update('revenue.club_companion_share', clampPercent(v, 1, 99)))}
            <Text type="secondary" style={{ fontSize: 12 }}>线上俱乐部固定分给陪玩的比例</Text>
          </div>

          {labelCell('admin', '店长', '全店统一')}
          <div style={CELL}>
            {percentInput(adminOnline, (v) => update('commission.admin_online_rate_percent', v))}
            <Text type="secondary" style={{ fontSize: 12 }}>按线上单流水比例；店里多位店长时按人数均分</Text>
          </div>

          {labelCell('cs', '客服', '每单固定金额')}
          <div style={CELL}>
            <Space size={4}>
              <InputNumber min={0} step={0.5} value={csOnlinePerOrder}
                onChange={(v) => update('commission.cs_online_per_order_yuan', Number(v ?? 0))} style={{ width: 110 }} />
              <Text type="secondary">元/单</Text>
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>单陪算 1 单、双陪算 2 单；从工作室那份里出</Text>
          </div>

          {labelCell('studio', '工作室', '自动算出')}
          <div style={{ ...CELL, background: `${ROLE_TINT.studio}0A` }}>
            <Text strong style={{ fontSize: 14, color: onlineStudio < 0 ? '#EF4444' : ROLE_TINT.studio }}>{onlineStudio}%</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>100 − 陪玩 − 店长（客服每单金额再从这份里出）</Text>
          </div>
        </div>
      </div>

      <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
        📌 线下工作室用阶梯档位，线上俱乐部用固定比例，创建工作室时选择分账模式。
        这一页和「设置 → 利润分成」「客服设置 → 客服提成比例」「店长设置」是同一个数，改哪边都一样。
      </Text>
    </Card>
  );
};

export default PaymentSettings;