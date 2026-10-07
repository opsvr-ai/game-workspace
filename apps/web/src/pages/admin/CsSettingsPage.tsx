// craftsman-ignore: TS001,TS002,TS003
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Space, Typography, Row, Col, InputNumber, Divider, Table, Select, Tag, Switch, Modal } from 'antd';
import { message } from '../../utils/feedback';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';
import { financeApi } from '../../api/finance';
import { extractErrorMessage } from '../../utils/error-handler';
import { Link } from 'react-router-dom';
import { BRAND } from '../../styles/tokens';
import PageHeader from '../../components/PageHeader';

const { Text } = Typography;

const Field = ({ label, unit, value, onChange, step = 1, min = 0, max, hint }: {
  label: string;
  unit: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
}) => (
  <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
    <Text style={{ display: 'inline-block', minWidth: 150 }}>{label}</Text>
    <InputNumber
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(v) => onChange(Number(v ?? 0))}
      style={{ width: 150 }}
      suffix={<Text strong style={{ color: BRAND.primary }}>{unit}</Text>}
    />
    {hint && <Text type="secondary">{hint}</Text>}
  </div>
);

const CsSettingsPage: React.FC = () => {
  const [config, setConfig] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 客服档位（老板 2026-09-29）：按人存的「默认派单范围 + 底薪」，谁不一样就单独改这一行
  const [profiles, setProfiles] = useState<any>(null);
  const [profileSaving, setProfileSaving] = useState<string>('');
  // 「这个人单独一套提成」弹窗（老板 2026-09-30：邵、孙可以各一套，留空就用本店的）
  const [cfgEditing, setCfgEditing] = useState<any>(null);
  const [cfgDraft, setCfgDraft] = useState<any>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfgRes = await configApi.getAll();
      setConfig((cfgRes.data as any)?.data || {});
    } catch {
      message.error('加载设置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadProfiles = useCallback(async () => {
    try {
      const { data: res } = await financeApi.commission.csProfiles();
      setProfiles((res as any)?.data || null);
    } catch {
      // 档位表是附加信息，读不到不影响上面那些提成设置
    }
  }, []);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  const patchProfile = (userId: string, patch: any) =>
    setProfiles((p: any) =>
      p ? { ...p, items: (p.items || []).map((it: any) => (it.userId === userId ? { ...it, ...patch } : it)) } : p,
    );

  const saveProfile = async (row: any) => {
    setProfileSaving(row.userId);
    try {
      const blank = row.baseSalaryYuan === null || row.baseSalaryYuan === undefined || row.baseSalaryYuan === '';
      const { data: res } = await financeApi.commission.saveCsProfile({
        userId: row.userId,
        poolScope: row.poolScope,
        baseSalaryYuan: blank ? null : Number(row.baseSalaryYuan),
        commissionConfig: row.commissionConfig ?? null,
      });
      const next = (res as any)?.data;
      if (next) setProfiles(next);
      message.success(`${row.displayName || row.username} 的档位已保存`);
    } catch (e: any) {
      message.error(extractErrorMessage(e, '保存失败'));
    } finally {
      setProfileSaving('');
    }
  };

  const openCfg = (row: any) => {
    setCfgDraft({ ...(row.commissionConfig || {}) });
    setCfgEditing(row);
  };

  const numDraft = (key: string, v: number | null | undefined) =>
    setCfgDraft((d: any) => ({ ...d, [key]: v === null || v === undefined ? undefined : v }));

  /** 存「这个人单独一套提成」；clear=true = 清空回到本店那一套 */
  const saveCfg = async (clear = false) => {
    const row = cfgEditing;
    if (!row) return;
    const draft: any = clear ? {} : cfgDraft;
    const clean: any = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v !== null && v !== undefined && v !== '') clean[k] = v;
    }
    setCfgEditing(null);
    await saveProfile({ ...row, commissionConfig: Object.keys(clean).length ? clean : null });
  };

  const getCfg = (key: string, def: number) => Number(config?.[key] ?? def);
  const setCfg = (key: string, v: number) => setConfig((c: any) => ({ ...c, [key]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await configApi.update({
        'commission.cs_bridge_per_order_yuan': getCfg('commission.cs_bridge_per_order_yuan', 1),
        'commission.cs_offline_rate_percent': getCfg('commission.cs_offline_rate_percent', 1),
        // 线上俱乐部怎么算（老板 2026-09-30「这些我自己填写」）：口径 + 两个数，两个数都填也只按选中的那一种算
        'commission.cs_online_mode': String(config?.['commission.cs_online_mode'] ?? 'RATE'),
        'commission.cs_online_rate_percent': getCfg('commission.cs_online_rate_percent', 1),
        'commission.cs_online_per_order_yuan': getCfg('commission.cs_online_per_order_yuan', 1),
        // 客服提成只算首单（默认）/ 续单、复购、打赏也算（老板 2026-09-30「我自己填写」）
        'commission.cs_include_renewal': config?.['commission.cs_include_renewal'] === true,
        'commission.cs_offline_floor_cents': Math.round(getCfg('commission.cs_offline_floor_cents', 200)),
        'commission.cs_offline_per_order_cap_cents': Math.round(getCfg('commission.cs_offline_per_order_cap_cents', 0)),
        // 每日桥接目标只是看板上的进度统计，不扣底薪也不扣提成（老板 2026-09-30）
        'commission.cs_daily_bridge_target': getCfg('commission.cs_daily_bridge_target', 10),
        'commission.cs_bridge_min_threshold': getCfg('commission.cs_bridge_min_threshold', 130),
        'commission.cs_bridge_tier3_threshold': getCfg('commission.cs_bridge_tier3_threshold', 182),
        'commission.cs_bridge_tier5_threshold': getCfg('commission.cs_bridge_tier5_threshold', 260),
        'commission.cs_bridge_tier3_yuan': getCfg('commission.cs_bridge_tier3_yuan', 3),
        'commission.cs_bridge_tier5_yuan': getCfg('commission.cs_bridge_tier5_yuan', 5),
      });
      message.success('客服设置已保存');
      await load();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  /** 本店现在这一套（弹窗里当「留空 = 用这个」的灰字提示） */
  const defs = profiles?.defaults || {};

  const cfgNum = (
    key: string,
    label: string,
    unit: string,
    defValue: any,
    step = 0.5,
  ) => (
    <Col span={12} key={key}>
      <div style={{ marginBottom: 10 }}>
        <Text style={{ display: 'block', fontSize: 12 }}>{label}</Text>
        <InputNumber
          size="small"
          min={0}
          step={step}
          suffix={unit}
          style={{ width: '100%' }}
          value={(cfgDraft[key] as any) ?? undefined}
          placeholder={`本店 ${defValue ?? '-'}`}
          onChange={(v) => numDraft(key, v)}
        />
      </div>
    </Col>
  );

  return (
    <div>
      <PageHeader
        title="客服设置"
        subtitle="客服的提成在这里设置（底薪、月休、迟到/缺勤扣款、全勤奖在「工资规则」里）。桥接提成按本月单价阶梯算（跑得越多单价越高），跑不够只是单价停在第一档，不扣底薪、不打折提成。输入框里的紫色小字是单位。"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving}>保存全部</Button>
          </Space>
        }
      />

      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card size="small" title="🎧 客服提成" style={{ marginBottom: 16 }}>
            <Text strong style={{ color: '#52c41a' }}>线下</Text>
            <Field
              label="线下提成比例"
              unit="%"
              value={getCfg('commission.cs_offline_rate_percent', 1)}
              step={0.5}
              onChange={(v) => setCfg('commission.cs_offline_rate_percent', v)}
              hint="每单 = 流水 × 此比例，不足「线下保底」按保底发"
            />
            <Field label="线下保底" unit="元/单" value={getCfg('commission.cs_offline_floor_cents', 200) / 100} step={0.5} onChange={(v) => setCfg('commission.cs_offline_floor_cents', Math.round(v * 100))} hint="每单提成不足时按保底发" />
            <Field label="线下每单封顶" unit="元/单" value={getCfg('commission.cs_offline_per_order_cap_cents', 0) / 100} step={0.5} onChange={(v) => setCfg('commission.cs_offline_per_order_cap_cents', Math.round(v * 100))} hint="每单线下提成上限，0=不封顶" />
            <Divider style={{ margin: '8px 0' }} />
            <Text strong style={{ color: BRAND.primary }}>桥接</Text>
            <Field label="桥接每单提成" unit="元/单" value={getCfg('commission.cs_bridge_per_order_yuan', 1)} step={0.5} onChange={(v) => setCfg('commission.cs_bridge_per_order_yuan', v)} hint="单陪算1单，双陪算2单" />
            <Field label="桥接最低单数" unit="单/月" value={getCfg('commission.cs_bridge_min_threshold', 130)} step={5} onChange={(v) => setCfg('commission.cs_bridge_min_threshold', v)} hint="低于此数按上面的「桥接每单提成」单价算，不扣底薪" />
            <Field label="3元/单门槛" unit="单/月" value={getCfg('commission.cs_bridge_tier3_threshold', 182)} step={5} onChange={(v) => setCfg('commission.cs_bridge_tier3_threshold', v)} hint="达到后按 3 元/单" />
            <Field label="5元/单门槛" unit="单/月" value={getCfg('commission.cs_bridge_tier5_threshold', 260)} step={5} onChange={(v) => setCfg('commission.cs_bridge_tier5_threshold', v)} hint="达到后按 5 元/单" />
            <Field label="3元阶梯单价" unit="元/单" value={getCfg('commission.cs_bridge_tier3_yuan', 3)} step={0.5} onChange={(v) => setCfg('commission.cs_bridge_tier3_yuan', v)} />
            <Field label="5元阶梯单价" unit="元/单" value={getCfg('commission.cs_bridge_tier5_yuan', 5)} step={0.5} onChange={(v) => setCfg('commission.cs_bridge_tier5_yuan', v)} />
            <Divider style={{ margin: '8px 0' }} />
            <Text strong style={{ color: '#722ed1' }}>线上俱乐部</Text>
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <Text style={{ display: 'inline-block', minWidth: 150 }}>线上怎么算</Text>
              <Select
                value={String(config?.['commission.cs_online_mode'] ?? 'RATE')}
                onChange={(v) => setCfg('commission.cs_online_mode', v as any)}
                style={{ width: 230 }}
                options={[
                  { value: 'RATE', label: '按流水比例（%）' },
                  { value: 'PER_ORDER', label: '按成功单数 × 每单单价' },
                ]}
              />
              <Text type="secondary">两个数都填也只按选中的这一种算，不会叠加</Text>
            </div>
            <Field
              label="线上流水比例"
              unit="%"
              value={getCfg('commission.cs_online_rate_percent', 1)}
              step={0.5}
              onChange={(v) => setCfg('commission.cs_online_rate_percent', v)}
              hint="选「按流水比例」时用：每单 = 流水 × 此比例"
            />
            <Field
              label="线上每单单价"
              unit="元/单"
              value={getCfg('commission.cs_online_per_order_yuan', 1)}
              step={0.5}
              onChange={(v) => setCfg('commission.cs_online_per_order_yuan', v)}
              hint="选「按成功单数」时用：双陪算 2 单"
            />
            <Divider style={{ margin: '8px 0' }} />
            <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <Text style={{ display: 'inline-block', minWidth: 150 }}>算哪些单</Text>
              <Switch
                checked={config?.['commission.cs_include_renewal'] === true}
                onChange={(v) => setCfg('commission.cs_include_renewal', v as any)}
              />
              <Text type="secondary">
                {config?.['commission.cs_include_renewal'] === true
                  ? '首单 + 续单 / 复购 / 打赏都算提成'
                  : '只算首单（默认）—— 续单 / 复购 / 打赏多是陪玩自己维护的，不算客服提成'}
              </Text>
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card size="small" title="🏇 每日桥接目标（只是进度统计）" style={{ marginBottom: 16 }}>
            <Field
              label="每日桥接目标"
              unit="单"
              value={getCfg('commission.cs_daily_bridge_target', 10)}
              step={1}
              onChange={(v) => setCfg('commission.cs_daily_bridge_target', v)}
              hint="看板上标「今天够了没有」用；不扣底薪、不扣提成"
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              桥接提成只跟本月单价阶梯有关（上面那一栏的「桥接每单提成 / 3 元门槛 / 5 元门槛」）：
              跑不够只是单价停在第一档。以前那两个「未达标扣提成 / 扣底薪」的比例已经整条去掉，谁都不会被倒扣。
            </Text>
          </Card>

          <Card size="small" title="💰 客服工资、月休与考勤扣款">
            <Text type="secondary">
              这页只管提成。客服的底薪 / 月休天数 / 迟到、缺勤、早退扣款 / 全勤奖
              已经和店长的那些并到同一张「工资规则」表里了（2026-09-22 合并，免得同一个岗位的工资散在两页改漏）。
            </Text>
            <div style={{ marginTop: 12 }}>
              <Link to="/admin/payroll"><Button size="small" type="primary">去「工资规则」设置</Button></Link>
            </div>
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title="👤 客服档位（每人的默认派单范围 + 底薪 + 单独一套提成）"
        style={{ marginTop: 16 }}
        extra={
          <Button size="small" icon={<ReloadOutlined />} onClick={loadProfiles}>
            刷新
          </Button>
        }
      >
        <Text type="secondary">
          默认入池方式决定这个客服新建单时怎么派：线下→线上流转（本店线下先抢，几分钟没人接才轮到桥接 / 线上）/
          线上→线下流转（桥接工作室 + 线上俱乐部秒看到，几分钟没人接才自动放到本店线下）。底薪留空 = 用「工资规则」里的统一底薪（当前 ¥
          {Number(profiles?.defaultBaseSalaryYuan ?? 0).toFixed(0)}/月）。
          点「单独一套」能给某个人单独定提成（线下比例 / 保底、桥接单价与阶梯、线上口径与单价），
          **留空的项还是用本店那一套**；想让他回到本店一套，点弹窗里的「清空」。
        </Text>
        <Table
          scroll={{ x: 780 }}
          style={{ marginTop: 12 }}
          rowKey="userId"
          size="small"
          pagination={false}
          dataSource={profiles?.items || []}
          locale={{ emptyText: '这家店还没有客服' }}
          columns={[
            {
              title: '客服',
              dataIndex: 'displayName',
              render: (v: string, r: any) => v || r.username,
            },
            {
              title: '默认派单范围',
              dataIndex: 'poolScope',
              width: 200,
              render: (v: string, r: any) => (
                <Select
                  size="small"
                  style={{ width: 180 }}
                  value={v || 'OFFLINE_FIRST'}
                  onChange={(next) => patchProfile(r.userId, { poolScope: next })}
                  options={[
                    { value: 'OFFLINE_FIRST', label: '线下→线上流转' },
                    { value: 'ONLINE_FIRST', label: '线上→线下流转' },
                  ]}
                />
              ),
            },
            {
              title: '底薪（月）',
              dataIndex: 'baseSalaryYuan',
              width: 200,
              render: (v: number | null, r: any) => (
                <InputNumber
                  size="small"
                  min={0}
                  step={100}
                  suffix="元/月"
                  style={{ width: 150 }}
                  value={v ?? undefined}
                  placeholder={`默认 ${Number(profiles?.defaultBaseSalaryYuan ?? 0).toFixed(0)}`}
                  onChange={(next) => patchProfile(r.userId, { baseSalaryYuan: next })}
                />
              ),
            },
            {
              title: '提成',
              width: 180,
              render: (_: unknown, r: any) => {
                const hasOwn = r.commissionConfig && Object.keys(r.commissionConfig).length > 0;
                return (
                  <Space size={6}>
                    <Button size="small" onClick={() => openCfg(r)}>
                      单独一套
                    </Button>
                    {hasOwn ? <Tag color="purple">单独一套</Tag> : <Tag color="default">用本店</Tag>}
                  </Space>
                );
              },
            },
            {
              title: '',
              width: 200,
              render: (_: unknown, r: any) => (
                <Space size={6}>
                  <Button
                    size="small"
                    type="primary"
                    loading={profileSaving === r.userId}
                    onClick={() => saveProfile(r)}
                  >
                    保存
                  </Button>
                  {r.baseSalaryYuan == null ? (
                    <Tag color="default">用统一底薪</Tag>
                  ) : (
                    <Tag color="blue">单独底薪</Tag>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        open={!!cfgEditing}
        title={`${cfgEditing?.displayName || cfgEditing?.username || ''} · 单独一套提成`}
        width={720}
        onCancel={() => setCfgEditing(null)}
        footer={[
          <Button key="clear" onClick={() => saveCfg(true)}>
            清空（回到本店一套）
          </Button>,
          <Button
            key="ok"
            type="primary"
            loading={profileSaving === cfgEditing?.userId}
            onClick={() => saveCfg()}
          >
            保存
          </Button>,
        ]}
      >
        <Text type="secondary">
          留空 = 用本店那一套（灰字括号里就是本店现在的值）。只有填了的项才算这个人的，改完点「保存」。
        </Text>
        <Row gutter={[12, 0]} style={{ marginTop: 12 }}>
          {cfgNum('offlineRatePercent', '线下提成比例', '%', defs.offlineRatePercent, 0.5)}
          {cfgNum('offlineFloorYuan', '线下保底', '元/单', defs.offlineFloorYuan, 0.5)}
          {cfgNum('offlineCapYuan', '线下每单封顶（0=不封顶）', '元/单', defs.offlineCapYuan, 0.5)}
          {cfgNum('bridgePerOrderYuan', '桥接每单', '元/单', defs.bridgePerOrderYuan, 0.5)}
          {cfgNum('bridgeMinThreshold', '桥接最低单数', '单/月', defs.bridgeMinThreshold, 5)}
          {cfgNum('bridgeTier3Threshold', '3 元/单门槛', '单/月', defs.bridgeTier3Threshold, 5)}
          {cfgNum('bridgeTier5Threshold', '5 元/单门槛', '单/月', defs.bridgeTier5Threshold, 5)}
          {cfgNum('bridgeTier3Yuan', '3 元阶梯单价', '元/单', defs.bridgeTier3Yuan, 0.5)}
          {cfgNum('bridgeTier5Yuan', '5 元阶梯单价', '元/单', defs.bridgeTier5Yuan, 0.5)}
          <Col span={12} key="onlineMode">
            <div style={{ marginBottom: 10 }}>
              <Text style={{ display: 'block', fontSize: 12 }}>线上怎么算</Text>
              <Select
                size="small"
                allowClear
                style={{ width: '100%' }}
                value={(cfgDraft.onlineMode as any) ?? undefined}
                placeholder={`本店 ${defs.onlineMode === 'PER_ORDER' ? '按成功单数 × 每单单价' : '按流水比例'}`}
                onChange={(v) => numDraft('onlineMode', v as any)}
                options={[
                  { value: 'RATE', label: '按流水比例（%）' },
                  { value: 'PER_ORDER', label: '按成功单数 × 每单单价' },
                ]}
              />
            </div>
          </Col>
          {cfgNum('onlineRatePercent', '线上流水比例', '%', defs.onlineRatePercent, 0.5)}
          {cfgNum('onlinePerOrderYuan', '线上每单单价', '元/单', defs.onlinePerOrderYuan, 0.5)}
        </Row>
      </Modal>
    </div>
  );
};

export default CsSettingsPage;
