// craftsman-ignore: TS001,TS002
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, InputNumber, Row, Space, Table, Tabs, Typography, message } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';
import { SettingsField } from '../../components/settings/SettingsField';
import { clampPercent, complementPercent, FULL_PERCENT } from '../../utils/percent';

const { Text, Title } = Typography;

/**
 * 分成比例（工作室 / 店长 / 客服 / 陪玩）
 *
 * 老板 2026-09-21 拍板：**不管线下工作室还是线上俱乐部，一单流水都由这四个人分**。
 * 这一页以前是「填了不参与任何计算」的死配置，现在改成**真实口径**：
 *
 * - 陪玩：线下按阶梯（设置 → 分账规则里的 50/60/70）、线上按俱乐部固定比例 —— 来源只有一个，这里只读展示；
 * - 客服：线下按流水比例（和「客服设置 → 线下提成比例」是同一个值，改哪边都一样）、
 *   线上按每单固定金额（同样来自客服设置）；
 * - 店长：本页填写（线下 / 线上分开），**月度提成结算时真的按这个比例计提**；
 * - 工作室：拿剩下的（100 − 陪玩 − 客服 − 店长），所以四个人加起来永远是 100%。
 */

const CONFIG_KEYS = [
  'revenue.share_tiers',
  'revenue.club_companion_share',
  'commission.cs_offline_rate_percent',
  'commission.admin_offline_rate_percent',
  'commission.cs_online_per_order_yuan',
  'commission.admin_online_rate_percent',
  'bridge.secret_price_yuan',
  'bridge.jueju_net_yuan',
];

const DEFAULT_CLUB_COMPANION_SHARE = 80;

const MODES = [
  { key: 'offline', label: '线下工作室' },
  { key: 'online', label: '线上俱乐部' },
  { key: 'bridge', label: '桥接工作室' },
];

interface ShareTier {
  min?: number;
  max?: number | null;
  companion?: number;
  studio?: number;
}

const ProfitSplitPage: React.FC = () => {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('offline');

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await configApi.get(CONFIG_KEYS);
      setConfig((data as any)?.data ?? {});
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const update = (key: string, value: number) => setConfig((c: any) => ({ ...c, [key]: value }));

  if (loading && !config) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">加载中...</Text></div>;
  }

  const tiers: ShareTier[] = config?.['revenue.share_tiers'] ?? [];
  const clubCompanion = clampPercent(config?.['revenue.club_companion_share'] ?? DEFAULT_CLUB_COMPANION_SHARE, 1, 99);
  const csOffline = clampPercent(config?.['commission.cs_offline_rate_percent'] ?? 1);
  const adminOffline = clampPercent(config?.['commission.admin_offline_rate_percent'] ?? 0);
  const csOnlinePerOrder = Number(config?.['commission.cs_online_per_order_yuan'] ?? 1);
  const adminOnline = clampPercent(config?.['commission.admin_online_rate_percent'] ?? 0);

  // 线下：每一档的陪玩比例不同，所以工作室的剩余也要按档算。
  const offlineRows = tiers.map((t, i) => {
    const companion = clampPercent(t?.companion);
    const studio = Math.round((FULL_PERCENT - companion - csOffline - adminOffline) * 100) / 100;
    return {
      key: i,
      range: t?.max == null ? `${t?.min ?? 0} 元以上` : `${t?.min ?? 0} – ${t?.max} 元`,
      companion,
      cs: csOffline,
      admin: adminOffline,
      studio,
    };
  });

  const onlineStudio = Math.round((FULL_PERCENT - clubCompanion - adminOnline) * 100) / 100;
  const offlineTightest = offlineRows.length ? Math.min(...offlineRows.map((r) => r.studio)) : FULL_PERCENT;

  const save = async () => {
    if (mode === 'offline' || mode === 'online') {
      const worst = mode === 'offline' ? offlineTightest : onlineStudio;
      if (worst < 0) {
        message.error('陪玩 + 客服 + 店长加起来超过 100% 了，工作室会变成负数，请先调整');
        return;
      }
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      if (mode === 'offline') {
        payload['commission.cs_offline_rate_percent'] = csOffline;
        payload['commission.admin_offline_rate_percent'] = adminOffline;
      } else if (mode === 'online') {
        payload['commission.cs_online_per_order_yuan'] = csOnlinePerOrder;
        payload['commission.admin_online_rate_percent'] = adminOnline;
      } else {
        message.info('桥接单价在「财务管理 → 盈亏日历」里改，两边是同一份配置');
        setSaving(false);
        return;
      }
      await configApi.update(payload);
      message.success('分成比例已保存');
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const percentInput = (value: number, onChange: (v: number) => void, max = 100) => (
    <InputNumber min={0} max={max} step={1} value={value} addonAfter="%"
      onChange={(v) => onChange(clampPercent(v))} style={{ width: 120 }} />
  );

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>分成比例（工作室 / 店长 / 客服 / 陪玩）</Title>
      <Text type="secondary">
        一单流水由这四个人分：<Text strong>陪玩</Text>按阶梯 / 俱乐部固定比例（在「设置 → 分账规则」里填），
        <Text strong>客服</Text>按「客服设置」里的口径，<Text strong>店长</Text>在本页填写，
        <Text strong>工作室</Text>拿剩下的 —— 四个人加起来永远是 100%。
      </Text>
      <Tabs activeKey={mode} onChange={setMode} items={MODES} style={{ marginTop: 12 }} />

      <Card
        title={mode === 'offline' ? '线下工作室' : mode === 'online' ? '线上俱乐部' : '桥接工作室'}
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            {mode !== 'bridge' && (
              <Button type="primary" icon={React.createElement(SaveOutlined)} loading={saving} onClick={save}>保存</Button>
            )}
          </Space>
        }
      >
        {mode === 'offline' && (
          <>
            <Row gutter={24}>
              <Col span={12}>
                <SettingsField label="客服分成比例（%）" value={csOffline} step={1} max={100}
                  onChange={(v) => update('commission.cs_offline_rate_percent', clampPercent(v))}
                  hint="按流水比例；和「客服设置 → 线下提成比例」是同一个值" />
              </Col>
              <Col span={12}>
                <SettingsField label="店长分成比例（%）" value={adminOffline} step={1} max={100}
                  onChange={(v) => update('commission.admin_offline_rate_percent', clampPercent(v))}
                  hint="店里多位店长时按人数均分，这里填的是店长这一项的总支出" />
              </Col>
            </Row>
            {offlineTightest < 0 && (
              <Alert type="error" showIcon style={{ marginBottom: 12 }}
                message="陪玩 + 客服 + 店长加起来超过 100%，工作室会变成负数，请先调整" />
            )}
            <Table
              dataSource={offlineRows}
              pagination={false}
              size="small"
              columns={[
                { title: '陪玩月流水', dataIndex: 'range' },
                { title: '陪玩分成（%）', dataIndex: 'companion', render: (v: number) => <Text>{v}</Text> },
                { title: '客服分成（%）', dataIndex: 'cs', render: (v: number) => <Text type="secondary">{v}</Text> },
                { title: '店长分成（%）', dataIndex: 'admin', render: (v: number) => <Text type="secondary">{v}</Text> },
                {
                  title: '工作室分成（%）', dataIndex: 'studio',
                  render: (v: number) => (v < 0 ? <Text type="danger" strong>{v}</Text> : <Text strong>{v}</Text>),
                },
              ]}
            />
            <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
              📌 陪玩那一栏来自「设置 → 分账规则」的阶梯，这里只读；要改档次去那里改（两边永远一致）。
            </Text>
          </>
        )}

        {mode === 'online' && (
          <>
            <Row gutter={24}>
              <Col span={12}>
                <SettingsField label="客服每单提成（元/单）" value={csOnlinePerOrder} step={0.5}
                  onChange={(v) => update('commission.cs_online_per_order_yuan', Number(v ?? 0))}
                  hint="单陪算 1 单、双陪算 2 单；和「客服设置 → 线上每单提成」是同一个值" />
              </Col>
              <Col span={12}>
                <SettingsField label="店长分成比例（%）" value={adminOnline} step={1} max={100}
                  onChange={(v) => update('commission.admin_online_rate_percent', clampPercent(v))}
                  hint="按线上单流水比例；多店长按人数均分" />
              </Col>
            </Row>
            {onlineStudio < 0 && (
              <Alert type="error" showIcon style={{ marginBottom: 12 }}
                message={`陪玩 ${clubCompanion}% + 店长 ${adminOnline}% 超过 100% 了，请先调整`} />
            )}
            <Table
              dataSource={[{
                key: 'online',
                companion: clubCompanion,
                cs: `${csOnlinePerOrder} 元/单`,
                admin: adminOnline,
                studio: onlineStudio,
              }]}
              pagination={false}
              size="small"
              columns={[
                { title: '分成对象', dataIndex: 'companion', render: () => <Text>线上俱乐部（俱乐部固定比例）</Text> },
                { title: '陪玩（%）', dataIndex: 'companion' },
                { title: '客服', dataIndex: 'cs' },
                { title: '店长（%）', dataIndex: 'admin' },
                {
                  title: '工作室（%）', dataIndex: 'studio',
                  render: (v: number) => (v < 0 ? <Text type="danger" strong>{v}</Text> : <Text strong>{v}</Text>),
                },
              ]}
            />
            <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
              📌 陪玩那一栏 = 「设置 → 分账规则」里的「线上俱乐部固定比例」（现在是 {clubCompanion}%），这里只读。
              客服是「每单固定金额」，从工作室那份里出，所以工作室实际到手 = {onlineStudio}% − 客服每单金额。
            </Text>
          </>
        )}

        {mode === 'bridge' && (
          <>
            <Space size={24} wrap>
              <div>
                <Text>机密单价（元/人/时）：</Text>
                <Text strong>{Number(config?.['bridge.secret_price_yuan'] ?? 35)}</Text>
              </div>
              <div>
                <Text>绝密净价（元/人/时）：</Text>
                <Text strong>{Number(config?.['bridge.jueju_net_yuan'] ?? 30)}</Text>
              </div>
            </Space>
            <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
              📌 这是付给桥接 / 线上工作室的服务费，按人数 × 时长结算；在
              「财务管理 → 盈亏日历 → 桥接工作室结算」里改（和这里是同一份配置）。
              客服做桥接单的提成在「客服设置」里按单量阶梯单独设置。
            </Text>
          </>
        )}
      </Card>
    </div>
  );
};

export default ProfitSplitPage;
