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

const CaptureSettings: React.FC = () => {
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

  const update = (key: string, value: any) => setConfig((c: any) => ({ ...c, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await configApi.update({
        'capture.interval_min_minutes': config?.['capture.interval_min_minutes'] ?? 12,
        'capture.interval_max_minutes': config?.['capture.interval_max_minutes'] ?? 18,
        'capture.first_delay_min_minutes': config?.['capture.first_delay_min_minutes'] ?? 1,
        'capture.first_delay_max_minutes': config?.['capture.first_delay_max_minutes'] ?? 3,
        'capture.black_jpeg_kb': config?.['capture.black_jpeg_kb'] ?? 15,
        'capture.expected_per_hour': config?.['capture.expected_per_hour'] ?? 4,
        'capture.min_rate_percent': config?.['capture.min_rate_percent'] ?? 50,
        'capture.black_rate_max_percent': config?.['capture.black_rate_max_percent'] ?? 30,
      });
      message.success('截图阈值已保存');
    } catch {
      message.error('保存失败');
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
        title="📸 工作记录截图阈值"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button type="primary" icon={React.createElement(SaveOutlined)} loading={saving} onClick={save}>保存</Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          客户端在服务开始时会拉取这些阈值；修改后需等该陪玩下一次开始服务时生效。
        </Text>
        <Row gutter={24}>
          <Col span={12}>
            <Field label="截图最小间隔（分钟）" value={config?.['capture.interval_min_minutes'] ?? 12} onChange={(v) => update('capture.interval_min_minutes', v)} suffix="每次截图的最小随机间隔" />
            <Field label="截图最大间隔（分钟）" value={config?.['capture.interval_max_minutes'] ?? 18} onChange={(v) => update('capture.interval_max_minutes', v)} suffix="每次截图的最大随机间隔" />
            <Field label="首张截图最小延迟（分钟）" value={config?.['capture.first_delay_min_minutes'] ?? 1} onChange={(v) => update('capture.first_delay_min_minutes', v)} />
            <Field label="首张截图最大延迟（分钟）" value={config?.['capture.first_delay_max_minutes'] ?? 3} onChange={(v) => update('capture.first_delay_max_minutes', v)} />
          </Col>
          <Col span={12}>
            <Field label="黑屏判定体积阈值（KB）" value={config?.['capture.black_jpeg_kb'] ?? 15} onChange={(v) => update('capture.black_jpeg_kb', v)} suffix="JPEG 小于该体积判定为黑屏" />
            <Field label="每小时预期有效截图（张）" value={config?.['capture.expected_per_hour'] ?? 4} onChange={(v) => update('capture.expected_per_hour', v)} suffix="用于计算本次服务应有截图数" />
            <Field label="最低有效截图达成率（%）" value={config?.['capture.min_rate_percent'] ?? 50} onChange={(v) => update('capture.min_rate_percent', v)} max={100} suffix="有效截图低于该比例标黄" />
            <Field label="黑屏率上限（%）" value={config?.['capture.black_rate_max_percent'] ?? 30} onChange={(v) => update('capture.black_rate_max_percent', v)} max={100} suffix="黑屏占比超过该值标黄" />
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default CaptureSettings;