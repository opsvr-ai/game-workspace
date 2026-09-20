// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Card, InputNumber, Button, Space, Typography, message, Table, Popconfirm } from 'antd';
import { ReloadOutlined, SaveOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';
import { SettingsLabel } from '../../components/settings/SettingsField';
import { clampPercent, complementPercent, FULL_PERCENT, isFullPercentTotal } from '../../utils/percent';

const { Text } = Typography;

// 线上俱乐部（固定比例）陪玩分成的兜底值。
// 后端四处（月底结算 / 可支取余额 / 财务对账 / 陪玩业绩）在配置缺失时都按 80% 生效，
// 所以前端必须显示同一个数字，否则会出现「页面显示 80、其实库里从没存过」的错觉。
const DEFAULT_CLUB_COMPANION_SHARE = 80;

// 把「后端实际生效的默认值」落到表单里：看到多少，算的就是多少；点保存就真的写进库。
const withEffectiveDefaults = (raw: any) => {
  const next: any = { ...(raw ?? {}) };
  if (typeof next['revenue.club_companion_share'] !== 'number') {
    next['revenue.club_companion_share'] = DEFAULT_CLUB_COMPANION_SHARE;
  }
  // 阶梯的「工作室 / 陪玩」是一对，必须刚好 100%。历史配置里两栏可能对不上
  // （改过一栏、没改另一栏），这里统一按「陪玩 = 算钱的那一栏、工作室 = 剩余份额」归一化，
  // 免得页面上出现「50 / 60」这种加起来 110% 的档位。
  if (Array.isArray(next['revenue.share_tiers'])) {
    next['revenue.share_tiers'] = next['revenue.share_tiers'].map((t: any) => {
      const companion = clampPercent(t?.companion);
      return { ...t, companion, studio: complementPercent(companion) };
    });
  }
  return next;
};

interface ShareTier {
  min: number;
  max: number | null;
  studio: number;
  companion: number;
}

const PaymentSettings: React.FC = () => {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await configApi.getAll();
      setConfig(withEffectiveDefaults(data.data));
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const save = async () => {
    const tiersToSave: ShareTier[] = config?.['revenue.share_tiers'] ?? [];
    const badRow = tiersToSave.findIndex((t) => !isFullPercentTotal([t?.studio, t?.companion]));
    if (badRow >= 0) {
      const t = tiersToSave[badRow];
      message.error(`第 ${badRow + 1} 档分成加起来是 ${(Number(t?.studio) || 0) + (Number(t?.companion) || 0)}%，必须刚好 100%`);
      return;
    }
    setSaving(true);
    try {
      await configApi.update({
        'revenue.share_tiers': tiersToSave,
        'revenue.club_companion_share': config?.['revenue.club_companion_share'] ?? DEFAULT_CLUB_COMPANION_SHARE,
      });
      message.success('分账规则 已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const update = (key: string, value: any) => {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  };

  if (loading && !config) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">加载中...</Text></div>;
  }

  const tiers: ShareTier[] = config?.['revenue.share_tiers'] ?? [];
  const clubCompanionShare = clampPercent(
    config?.['revenue.club_companion_share'] ?? DEFAULT_CLUB_COMPANION_SHARE, 1, 99);

  const addTier = () => {
    const prev = tiers[tiers.length - 1];
    const newMin = prev ? (prev.max ?? 0) + 0.1 : 0;
    update('revenue.share_tiers', [...tiers, { min: newMin, max: null, studio: 50, companion: 50 }]);
  };

  const removeTier = (idx: number) => {
    update('revenue.share_tiers', tiers.filter((_, i) => i !== idx));
  };

  // 改「工作室」或「陪玩」任意一栏，另一栏自动补足到 100%（老板 2026-09-21 要求）。
  const updateTier = (idx: number, field: keyof ShareTier, val: any) => {
    const next = tiers.map((t, i) => {
      if (i !== idx) return t;
      if (field === 'studio') {
        const studio = clampPercent(val);
        return { ...t, studio, companion: complementPercent(studio) };
      }
      if (field === 'companion') {
        const companion = clampPercent(val);
        return { ...t, companion, studio: complementPercent(companion) };
      }
      return { ...t, [field]: val };
    });
    update('revenue.share_tiers', next);
  };

  return (
    <Card
      title="📊 分账规则"
      extra={
        <Space>
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
          <Button type="primary" icon={React.createElement(SaveOutlined)} loading={saving} onClick={save}>保存</Button>
        </Space>
      }
    >
      <Table
        dataSource={tiers.map((t, i) => ({ ...t, _idx: i }))}
        rowKey="_idx"
        pagination={false}
        size="small"
        footer={() => (
          <Button type="dashed" onClick={addTier} icon={React.createElement(PlusOutlined)} block>
            添加分账档位
          </Button>
        )}
      >
        <Table.Column
          title="最低流水（元）"
          dataIndex="min"
          render={(v: number, _: any, i: number) => (
            <InputNumber
              min={0} step={100}
              value={v}
              disabled={i === 0}
              onChange={(n) => updateTier(i, 'min', n ?? 0)}
              style={{ width: 120 }}
            />
          )}
        />
        <Table.Column
          title="最高流水（元）"
          dataIndex="max"
          render={(v: number | null, _: any, i: number) => (
            <InputNumber
              min={0} step={100}
              value={v ?? undefined}
              placeholder="无上限"
              onChange={(n) => updateTier(i, 'max', n ?? null)}
              style={{ width: 120 }}
            />
          )}
        />
        <Table.Column
          title="工作室分成（%）"
          dataIndex="studio"
          render={(v: number, _: any, i: number) => (
            <InputNumber
              min={0} max={100}
              value={v}
              onChange={(n) => updateTier(i, 'studio', n ?? 50)}
              style={{ width: 100 }}
            />
          )}
        />
        <Table.Column
          title="陪玩分成（%）"
          dataIndex="companion"
          render={(v: number, _: any, i: number) => (
            <InputNumber
              min={0} max={100}
              value={v}
              onChange={(n) => updateTier(i, 'companion', n ?? 50)}
              style={{ width: 100 }}
            />
          )}
        />
        <Table.Column
          title="操作"
          render={(_: any, __: any, i: number) =>
            tiers.length > 1 ? (
              <Popconfirm title="确定删除？" onConfirm={() => removeTier(i)}>
                <Button size="small" danger icon={React.createElement(DeleteOutlined)} />
              </Popconfirm>
            ) : null
          }
        />
      </Table>
      <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 16, paddingTop: 16 }}>
        <Text strong style={{ display: 'block', marginBottom: 12 }}>🏢 线上俱乐部（固定比例）</Text>
        <div>
          <SettingsLabel>陪玩分成比例（%）</SettingsLabel>
          <InputNumber min={1} max={99} step={5} value={clubCompanionShare}
            onChange={(v) => update('revenue.club_companion_share', clampPercent(v ?? DEFAULT_CLUB_COMPANION_SHARE, 1, 99))} style={{ width: 200 }} />
          <Text type="secondary" style={{ marginLeft: 8 }}>
            线上俱乐部固定分给陪玩的比例；<Text strong>工作室自动拿 {FULL_PERCENT - clubCompanionShare}%</Text>
            （两边加起来恒为 100%）。这里显示的就是实际生效的数字，改完点「保存」。
          </Text>
        </div>
      </div>
      <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
        📌 线下工作室使用阶梯档位，线上俱乐部使用固定比例。创建工作室时可选择分账模式。
      </Text>
    </Card>
  );
};

export default PaymentSettings;
