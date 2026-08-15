// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Card, InputNumber, Button, Typography, Space, message, Row, Col } from 'antd';
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
    <Text style={{ display: 'inline-block', minWidth: 190 }}>{label}</Text>
    <InputNumber min={min} max={max} step={step} value={value} onChange={(v) => onChange(v ?? 0)} style={{ width: 160 }} />
    {suffix && <Text type="secondary" style={{ marginLeft: 8 }}>{suffix}</Text>}
  </div>
);

const DispatchCommissionSettings: React.FC = () => {
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

  const save = async () => {
    setSaving(true);
    try {
      await configApi.update({
        'dispatch.qualified_threshold': config?.['dispatch.qualified_threshold'] ?? 90,
        'dispatch.bridge_immediate_window_sec': config?.['dispatch.bridge_immediate_window_sec'] ?? 60,
        'commission.cs_offline_rate_percent': config?.['commission.cs_offline_rate_percent'] ?? 0.5,
        'commission.cs_offline_floor_cents': Math.round((config?.['commission.cs_offline_floor_cents'] ?? 200)),
        'commission.cs_bridge_fixed_cents': Math.round((config?.['commission.cs_bridge_fixed_cents'] ?? 100)),
        'commission.cs_month_cap_cents': Math.round((config?.['commission.cs_month_cap_cents'] ?? 2000)),
      });
      message.success('派单与提成配置已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !config) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">加载中...</Text></div>;
  }

  const floorYuan = (config?.['commission.cs_offline_floor_cents'] ?? 200) / 100;
  const bridgeYuan = (config?.['commission.cs_bridge_fixed_cents'] ?? 100) / 100;
  const capYuan = (config?.['commission.cs_month_cap_cents'] ?? 2000) / 100;

  return (
    <div>
      <Card
        title="🧭 派单优先级与客服提成"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button type="primary" icon={React.createElement(SaveOutlined)} loading={saving} onClick={save}>保存</Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          线下订单优先，线上桥接作为兜底；客服提成线下按比例 + 保底，线上固定。
        </Text>
        <Row gutter={24}>
          <Col span={12}>
            <Field label="优秀阈值（%）" value={config?.['dispatch.qualified_threshold'] ?? 90} max={300} onChange={(v) => update('dispatch.qualified_threshold', v)} suffix="综合成功率达标线" />
            <Field label="线上响应窗口（秒）" value={config?.['dispatch.bridge_immediate_window_sec'] ?? 60} onChange={(v) => update('dispatch.bridge_immediate_window_sec', v)} suffix="立即打转线上等待时间" />
            <Field label="线下续购比例（%）" value={config?.['commission.cs_offline_rate_percent'] ?? 0.5} step={0.1} max={100} onChange={(v) => update('commission.cs_offline_rate_percent', v)} />
          </Col>
          <Col span={12}>
            <Field label="线下保底（元/单）" value={floorYuan} step={0.5} onChange={(v) => update('commission.cs_offline_floor_cents', Math.round(v * 100))} />
            <Field label="线上固定（元/单）" value={bridgeYuan} step={0.5} onChange={(v) => update('commission.cs_bridge_fixed_cents', Math.round(v * 100))} />
            <Field label="客服月封顶（元）" value={capYuan} step={1} onChange={(v) => update('commission.cs_month_cap_cents', Math.round(v * 100))} />
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default DispatchCommissionSettings;
