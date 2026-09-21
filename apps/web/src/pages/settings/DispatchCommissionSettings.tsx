// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Card, Button, Typography, Space, message, Row, Col } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';
import { SettingsField as Field } from '../../components/settings/SettingsField';

const { Text } = Typography;

/**
 * 派单优先级（老板 2026-09-22 要求「同一个功能别到处出现」后精简）
 *
 * 这一页原来还塞着三组数，全都是重复的，已经搬走：
 * - 「工作室分成比例」（dispatch.studio_share_percent）：**填了不参与任何计算**的历史遗留，直接删掉；
 * - 「每日新客户名额」：属于段位规则，统一在「评分与名额」里按上等马 / 中等马 / 下等马设置；
 * - 「机密 / 绝密线上返款」：桥接单价与首单返款统一在「利润分成（分账规则）」里设置。
 *
 * 留下的只有真正属于派单节奏的响应窗口。
 */

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
        'dispatch.bridge_immediate_window_sec': config?.['dispatch.bridge_immediate_window_sec'] ?? 60,
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

  return (
    <div>
      <Card
        title="🧭 派单优先级"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button type="primary" icon={React.createElement(SaveOutlined)} loading={saving} onClick={save}>保存</Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          各段位抢单名额在「评分与名额」里改；分成人 / 桥接单价在「利润分成（分账规则）」里改；
          客服提成与底薪在「客服设置」里改。
        </Text>
        <Row gutter={24}>
          <Col span={12}>
            <Field label="线上响应窗口（秒）" value={config?.['dispatch.bridge_immediate_window_sec'] ?? 60} onChange={(v) => update('dispatch.bridge_immediate_window_sec', v)} suffix="立即打转线上等待时间" />
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default DispatchCommissionSettings;
