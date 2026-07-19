// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, InputNumber, Button, Typography, Space, message, Switch, Row, Col, Input, Tag,
} from 'antd';
import { ReloadOutlined, SaveOutlined, PlusOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';

const { Text } = Typography;

const Label = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ display: 'inline-block', minWidth: 140, marginBottom: 4 }}>
    {children}
  </Text>
);

interface TagListEditorProps {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}

const TagListEditor: React.FC<TagListEditorProps> = ({ label, tags, onChange }) => {
  const [input, setInput] = useState('');

  const add = () => {
    const v = input.trim();
    if (!v) return;
    if (tags.includes(v)) {
      message.warning('已存在');
      return;
    }
    onChange([...tags, v]);
    setInput('');
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>{label}</Text>
      <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
        <Input
          placeholder="输入后按添加"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={add}
          style={{ maxWidth: 320 }}
        />
        <Button type="primary" icon={React.createElement(PlusOutlined)} onClick={add}>添加</Button>
      </Space.Compact>
      <div>
        {tags.length === 0 && <Text type="secondary">暂无</Text>}
        {tags.map((t) => (
          <Tag
            closable
            key={t}
            onClose={() => onChange(tags.filter((x) => x !== t))}
            style={{ marginBottom: 6, fontSize: 13, padding: '4px 10px' }}
          >
            {t}
          </Tag>
        ))}
      </div>
    </div>
  );
};

const StudioSettings: React.FC = () => {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [savingTimeout, setSavingTimeout] = useState(false);
  const [savingEntertainment, setSavingEntertainment] = useState(false);
  const [savingOptions, setSavingOptions] = useState(false);
  const [savingGames, setSavingGames] = useState(false);

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

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const update = (key: string, value: any) => {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  };

  const saveKeys = async (keys: Record<string, any>, loadLabel: string) => {
    try {
      await configApi.update(keys);
      message.success(`${loadLabel} 已保存`);
    } catch {
      message.error('保存失败');
    }
  };

  if (loading && !config) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">加载中...</Text></div>;
  }

  return (
    <div>
      {/* Timeout & Permissions */}
      <Card
        title="⏰ 超时与权限"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button
              type="primary"
              icon={React.createElement(SaveOutlined)}
              loading={savingTimeout}
              onClick={async () => {
                setSavingTimeout(true);
                await saveKeys({
                  'timeout.grace_minutes': config?.['timeout.grace_minutes'],
                  'timeout.rest_shutdown': config?.['timeout.rest_shutdown'],
                  'timeout.idle_shutdown': config?.['timeout.idle_shutdown'],
                  'entertainment.idle_shutdown': config?.['entertainment.idle_shutdown'],
                  'entertainment.shutdown_countdown': config?.['entertainment.shutdown_countdown'],
                  'billing.cs_access': config?.['billing.cs_access'],
                }, '超时与权限');
                setSavingTimeout(false);
              }}
            >
              保存
            </Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Label>超时宽限（分钟）</Label>
            <InputNumber min={1} step={1} value={config?.['timeout.grace_minutes'] ?? 10}
              onChange={(v) => update('timeout.grace_minutes', v ?? 10)} style={{ width: 200 }} />
            <Text type="secondary" style={{ marginLeft: 8 }}>订单超时后额外等待时间</Text>
          </div>
          <div>
            <Label>休息关机（分钟）</Label>
            <InputNumber min={0} step={5} value={config?.['timeout.rest_shutdown'] ?? 60}
              onChange={(v) => update('timeout.rest_shutdown', v ?? 60)} style={{ width: 200 }} />
            <Text type="secondary" style={{ marginLeft: 8 }}>休息状态持续多久后自动关机</Text>
          </div>
          <div>
            <Label>空闲关机 - 订单（分钟）</Label>
            <InputNumber min={0} step={5} value={config?.['timeout.idle_shutdown'] ?? 60}
              onChange={(v) => update('timeout.idle_shutdown', v ?? 60)} style={{ width: 200 }} />
            <Text type="secondary" style={{ marginLeft: 8 }}>无订单空闲多久后自动关机</Text>
          </div>
          <div>
            <Label>空闲关机 - 娱乐（分钟）</Label>
            <InputNumber min={0} step={5} value={config?.['entertainment.idle_shutdown'] ?? 60}
              onChange={(v) => update('entertainment.idle_shutdown', v ?? 60)} style={{ width: 200 }} />
            <Text type="secondary" style={{ marginLeft: 8 }}>娱乐模式下空闲多久后关机</Text>
          </div>
          <div>
            <Label>关机倒计时（秒）</Label>
            <InputNumber min={5} step={5} value={config?.['entertainment.shutdown_countdown'] ?? 30}
              onChange={(v) => update('entertainment.shutdown_countdown', v ?? 30)} style={{ width: 200 }} />
            <Text type="secondary" style={{ marginLeft: 8 }}>关机前倒计时提示秒数</Text>
          </div>
          <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12, marginTop: 8 }}>
            <Label>CS 报账系统权限</Label>
            <Switch checked={config?.['billing.cs_access'] === true} onChange={(v) => update('billing.cs_access', v)} />
            <Text type="secondary" style={{ marginLeft: 8 }}>开启后客服角色可查看报账系统</Text>
          </div>
        </Space>
      </Card>

      {/* Entertainment Threshold */}
      <Card title="🎮 娱乐模式门槛" style={{ marginBottom: 16 }} extra={
        <Space>
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
          <Button type="primary" icon={React.createElement(SaveOutlined)} loading={savingEntertainment}
            onClick={async () => {
              setSavingEntertainment(true);
              await saveKeys({
                'entertainment.deposit_threshold': config?.['entertainment.deposit_threshold'],
                'entertainment.revenue_threshold': config?.['entertainment.revenue_threshold'],
              }, '娱乐模式门槛');
              setSavingEntertainment(false);
            }}>保存</Button>
        </Space>
      }>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Label>押金门槛（元）</Label>
            <InputNumber min={0} step={50} value={config?.['entertainment.deposit_threshold'] ?? 500}
              onChange={(v) => update('entertainment.deposit_threshold', v ?? 500)} style={{ width: 200 }} />
            <Text type="secondary" style={{ marginLeft: 8 }}>押金低于此金额无法切换娱乐模式</Text>
          </div>
          <div>
            <Label>日流水门槛（元）</Label>
            <InputNumber min={0} step={50} value={config?.['entertainment.revenue_threshold'] ?? 200}
              onChange={(v) => update('entertainment.revenue_threshold', v ?? 200)} style={{ width: 200 }} />
            <Text type="secondary" style={{ marginLeft: 8 }}>当天流水低于此金额无法切换娱乐模式</Text>
          </div>
        </Space>
      </Card>

      {/* Dropdown Options */}
      <Card
        title="📋 下拉选项"
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button
              type="primary"
              icon={React.createElement(SaveOutlined)}
              loading={savingOptions}
              onClick={async () => {
                setSavingOptions(true);
                await saveKeys({
                  'options.contact_results': config?.['options.contact_results'] ?? [],
                  'options.finish_results': config?.['options.finish_results'] ?? [],
                  'options.fail_reasons': config?.['options.fail_reasons'] ?? [],
                }, '下拉选项');
                setSavingOptions(false);
              }}
            >
              保存
            </Button>
          </Space>
        }
      >
        <TagListEditor
          label="联系结果选项"
          tags={config?.['options.contact_results'] ?? []}
          onChange={(tags) => update('options.contact_results', tags)}
        />
        <TagListEditor
          label="完结结果选项"
          tags={config?.['options.finish_results'] ?? []}
          onChange={(tags) => update('options.finish_results', tags)}
        />
        <TagListEditor
          label="未完成原因选项"
          tags={config?.['options.fail_reasons'] ?? []}
          onChange={(tags) => update('options.fail_reasons', tags)}
        />
      </Card>

      {/* Games & Ranks */}
      <Card
        title="🎮 游戏与段位"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button
              type="primary"
              icon={React.createElement(SaveOutlined)}
              loading={savingGames}
              onClick={async () => {
                setSavingGames(true);
                await saveKeys({
                  games: config?.games ?? [],
                  ranks: config?.ranks ?? [],
                }, '游戏与段位');
                setSavingGames(false);
              }}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Row gutter={24}>
          <Col span={12}>
            <TagListEditor
              label="游戏列表"
              tags={config?.games ?? []}
              onChange={(tags) => update('games', tags)}
            />
          </Col>
          <Col span={12}>
            <TagListEditor
              label="段位列表"
              tags={config?.ranks ?? []}
              onChange={(tags) => update('ranks', tags)}
            />
          </Col>
        </Row>
      </Card>
    </div>
  );
};

export default StudioSettings;
