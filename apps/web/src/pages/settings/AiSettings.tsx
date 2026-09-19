// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Card, Button, Typography, Space, message, Select, Input, Alert } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';

const { Text } = Typography;

const PROVIDERS = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'doubao', label: '豆包（火山方舟）' },
  { value: 'off', label: '关闭（用规则版结论）' },
];

const AiSettings: React.FC = () => {
  const [config, setConfig] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await configApi.get(['ai.provider', 'ai.deepseek_api_key', 'ai.doubao_api_key', 'ai.doubao_model']);
      setConfig(data.data ?? {});
    } catch {
      message.error('加载 AI 配置失败');
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
        'ai.provider': config['ai.provider'] || 'deepseek',
        'ai.deepseek_api_key': config['ai.deepseek_api_key'] ?? '',
        'ai.doubao_api_key': config['ai.doubao_api_key'] ?? '',
        'ai.doubao_model': config['ai.doubao_model'] ?? 'doubao-pro-32k',
      });
      message.success('AI 配置已保存');
      fetchConfig();
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !Object.keys(config).length) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">加载中...</Text></div>;
  }

  const provider = config['ai.provider'] || 'doubao';

  return (
    <div>
      <Card
        title="🤖 AI 分析配置"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button type="primary" icon={React.createElement(SaveOutlined)} loading={saving} onClick={save}>保存</Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="用于「工作室账号管理 → 笔记 → AI 分析」和「内容排版生成器」。内容排版生成器使用 DeepSeek 策划 + 豆包成稿，两个 Key 都填效果最好。"
        />

        <div style={{ maxWidth: 560 }}>
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>分析服务商</Text>
            <Select
              value={provider}
              style={{ width: '100%' }}
              options={PROVIDERS}
              onChange={(v) => update('ai.provider', v)}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>DeepSeek API Key</Text>
            <Input.Password
              value={config['ai.deepseek_api_key'] || ''}
              placeholder="sk-..."
              onChange={(e) => update('ai.deepseek_api_key', e.target.value)}
            />
            <Text type="secondary">在 platform.deepseek.com 申请</Text>
          </div>

          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>豆包（火山方舟）API Key</Text>
            <Input.Password
              value={config['ai.doubao_api_key'] || ''}
              placeholder="在火山方舟控制台创建"
              onChange={(e) => update('ai.doubao_api_key', e.target.value)}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>豆包模型名 / 接入点 ID</Text>
            <Input
              value={config['ai.doubao_model'] || 'doubao-pro-32k'}
              placeholder="例如 doubao-pro-32k 或 ep-xxxx"
              onChange={(e) => update('ai.doubao_model', e.target.value)}
            />
            <Text type="secondary">默认 doubao-pro-32k，也可填火山方舟的接入点 ID（ep-开头）</Text>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default AiSettings;
