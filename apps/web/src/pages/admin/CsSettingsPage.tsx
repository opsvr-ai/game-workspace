// craftsman-ignore: TS001,TS002,TS003
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Space, Typography, message, Row, Col, InputNumber, Divider } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';
import { Link } from 'react-router-dom';

const { Title, Text } = Typography;

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
      suffix={<Text strong style={{ color: '#1677ff' }}>{unit}</Text>}
    />
    {hint && <Text type="secondary">{hint}</Text>}
  </div>
);

const CsSettingsPage: React.FC = () => {
  const [config, setConfig] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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

  const getCfg = (key: string, def: number) => Number(config?.[key] ?? def);
  const setCfg = (key: string, v: number) => setConfig((c: any) => ({ ...c, [key]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await configApi.update({
        'commission.cs_bridge_per_order_yuan': getCfg('commission.cs_bridge_per_order_yuan', 1),
        'commission.cs_offline_floor_cents': Math.round(getCfg('commission.cs_offline_floor_cents', 200)),
        'commission.cs_offline_per_order_cap_cents': Math.round(getCfg('commission.cs_offline_per_order_cap_cents', 0)),
        'commission.cs_daily_bridge_target': getCfg('commission.cs_daily_bridge_target', 10),
        'commission.cs_bridge_miss_commission_rate': getCfg('commission.cs_bridge_miss_commission_rate', 50),
        'commission.cs_bridge_miss_salary_rate': getCfg('commission.cs_bridge_miss_salary_rate', 80),
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

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>客服设置</Title>
        <Text type="secondary">客服的提成与桥接达标规则在这里设置（底薪、月休、考勤扣款在「工资规则」里）。输入框右侧蓝色小字是单位。</Text>
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving}>保存全部</Button>
      </Space>

      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card size="small" title="🎧 客服提成" style={{ marginBottom: 16 }}>
            <Text strong style={{ color: '#52c41a' }}>线下</Text>
            <Field label="线下保底" unit="元/单" value={getCfg('commission.cs_offline_floor_cents', 200) / 100} step={0.5} onChange={(v) => setCfg('commission.cs_offline_floor_cents', Math.round(v * 100))} hint="每单提成不足时按保底发" />
            <Field label="线下每单封顶" unit="元/单" value={getCfg('commission.cs_offline_per_order_cap_cents', 0) / 100} step={0.5} onChange={(v) => setCfg('commission.cs_offline_per_order_cap_cents', Math.round(v * 100))} hint="每单线下提成上限，0=不封顶" />
            <Divider style={{ margin: '8px 0' }} />
            <Text strong style={{ color: '#1677ff' }}>桥接</Text>
            <Field label="桥接每单提成" unit="元/单" value={getCfg('commission.cs_bridge_per_order_yuan', 1)} step={0.5} onChange={(v) => setCfg('commission.cs_bridge_per_order_yuan', v)} hint="单陪算1单，双陪算2单" />
            <Field label="桥接最低单数" unit="单/月" value={getCfg('commission.cs_bridge_min_threshold', 130)} step={5} onChange={(v) => setCfg('commission.cs_bridge_min_threshold', v)} hint="低于此数底薪减半" />
            <Field label="3元/单门槛" unit="单/月" value={getCfg('commission.cs_bridge_tier3_threshold', 182)} step={5} onChange={(v) => setCfg('commission.cs_bridge_tier3_threshold', v)} hint="达到后按 3 元/单" />
            <Field label="5元/单门槛" unit="单/月" value={getCfg('commission.cs_bridge_tier5_threshold', 260)} step={5} onChange={(v) => setCfg('commission.cs_bridge_tier5_threshold', v)} hint="达到后按 5 元/单" />
            <Field label="3元阶梯单价" unit="元/单" value={getCfg('commission.cs_bridge_tier3_yuan', 3)} step={0.5} onChange={(v) => setCfg('commission.cs_bridge_tier3_yuan', v)} />
            <Field label="5元阶梯单价" unit="元/单" value={getCfg('commission.cs_bridge_tier5_yuan', 5)} step={0.5} onChange={(v) => setCfg('commission.cs_bridge_tier5_yuan', v)} />
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card size="small" title="🏇 桥接达标规则" style={{ marginBottom: 16 }}>
            <Field label="每日桥接目标" unit="单" value={getCfg('commission.cs_daily_bridge_target', 10)} step={1} onChange={(v) => setCfg('commission.cs_daily_bridge_target', v)} hint="每人每天需达到的桥接单数" />
            <Field label="未达标提成比例" unit="%" value={getCfg('commission.cs_bridge_miss_commission_rate', 50)} step={1} max={100} onChange={(v) => setCfg('commission.cs_bridge_miss_commission_rate', v)} hint="整月未达标时提成按此比例发" />
            <Field label="未达标底薪比例" unit="%" value={getCfg('commission.cs_bridge_miss_salary_rate', 80)} step={1} max={100} onChange={(v) => setCfg('commission.cs_bridge_miss_salary_rate', v)} hint="整月未达标时底薪按此比例发" />
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
    </div>
  );
};

export default CsSettingsPage;
