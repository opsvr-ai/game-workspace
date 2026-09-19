// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Card, Button, Typography, Space, message, Row, Col } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';
import { SettingsField as Field } from '../../components/settings/SettingsField';

const { Text } = Typography;

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
        'dispatch.studio_share_percent': config?.['dispatch.studio_share_percent'] ?? 30,
        'dispatch.low_tier_daily_new_limit': config?.['dispatch.low_tier_daily_new_limit'] ?? 1,
        'dispatch.bridge_immediate_window_sec': config?.['dispatch.bridge_immediate_window_sec'] ?? 60,
        'dispatch.bridge_return_jimi_cents': Math.round((config?.['dispatch.bridge_return_jimi_cents'] ?? 100)),
        'dispatch.bridge_return_jueju_cents': Math.round((config?.['dispatch.bridge_return_jueju_cents'] ?? 1500)),
      });
      message.success('派单设置已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !config) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">加载中...</Text></div>;
  }

  const jimiReturnYuan = (config?.['dispatch.bridge_return_jimi_cents'] ?? 100) / 100;
  const juejuReturnYuan = (config?.['dispatch.bridge_return_jueju_cents'] ?? 1500) / 100;

  return (
    <div>
      <Card
        title="🧭 派单优先级与桥接返还"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button type="primary" icon={React.createElement(SaveOutlined)} loading={saving} onClick={save}>保存</Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          派单优先级与桥接/线上结算返还。客服提成、底薪、桥接达标请在「员工管理 → 客服管理 → 客服设置」里统一设置。
        </Text>
        <Row gutter={24}>
          <Col span={12}>
            <Field label="工作室分成比例（%）" value={config?.['dispatch.studio_share_percent'] ?? 30} step={1} max={100} onChange={(v) => update('dispatch.studio_share_percent', v)} suffix="用于算盈亏平衡" />
            <Field label="下等马每日有效客户名额" value={config?.['dispatch.low_tier_daily_new_limit'] ?? 1} step={1} onChange={(v) => update('dispatch.low_tier_daily_new_limit', v)} suffix="成交才占名额" />
            <Field label="线上响应窗口（秒）" value={config?.['dispatch.bridge_immediate_window_sec'] ?? 60} onChange={(v) => update('dispatch.bridge_immediate_window_sec', v)} suffix="立即打转线上等待时间" />
          </Col>
          <Col span={12}>
            <Field label="机密线上返款（元）" value={jimiReturnYuan} step={1} onChange={(v) => update('dispatch.bridge_return_jimi_cents', Math.round(v * 100))} />
            <Field label="绝密线上返款（元）" value={juejuReturnYuan} step={1} onChange={(v) => update('dispatch.bridge_return_jueju_cents', Math.round(v * 100))} />
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default DispatchCommissionSettings;
