import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Tabs, InputNumber, Button, Tag, Space, Typography, message,
  Row, Col, Table, Input, Popconfirm,
} from 'antd';
import { PlusOutlined, ReloadOutlined, SaveOutlined, DeleteOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';

const { Text, Title } = Typography;

// ── Types ──

interface ShareTier {
  min: number;
  max: number | null;
  studio: number;
  companion: number;
}

interface AllConfig {
  'revenue.unlock_threshold': number;
  'revenue.free_threshold': number;
  'revenue.low_warning': number;
  'revenue.share_tiers': ShareTier[];
  'withdraw.advance_ratio': number;
  'withdraw.default_deposit': number;
  'timeout.grace_minutes': number;
  'timeout.rest_shutdown': number;
  'timeout.idle_shutdown': number;
  'entertainment.idle_shutdown': number;
  'entertainment.shutdown_countdown': number;
  'options.contact_results': string[];
  'options.finish_results': string[];
  'options.fail_reasons': string[];
  games: string[];
  ranks: string[];
  [key: string]: any;
}

// ── Helpers ──

const Label = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ display: 'inline-block', minWidth: 140, marginBottom: 4 }}>
    {children}
  </Text>
);

// ── Tag List Editor ──

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

// ── Main ──

const SettingsPage: React.FC = () => {
  const [config, setConfig] = useState<AllConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await configApi.getAll();
      setConfig(data.data as AllConfig);
    } catch {
      message.error('加载配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const save = async (keys: Record<string, any>, label: string) => {
    setSaving(label);
    try {
      await configApi.update(keys);
      message.success(`${label} 已保存`);
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(null);
    }
  };

  const update = (key: string, value: any) => {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  };

  // ── Tab 1: 流水与价格 ──

  const renderRevenue = () => (
    <Card
      title="💰 流水与价格"
      extra={
        <Space>
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
          <Button
            type="primary"
            icon={React.createElement(SaveOutlined)}
            loading={saving === '流水与价格'}
            onClick={() =>
              save(
                {
                  'revenue.unlock_threshold': config?.['revenue.unlock_threshold'],
                  'revenue.free_threshold': config?.['revenue.free_threshold'],
                  'revenue.low_warning': config?.['revenue.low_warning'],
                },
                '流水与价格',
              )
            }
          >
            保存
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Label>抢单解锁流水阈值（元）</Label>
          <InputNumber
            min={0}
            step={10}
            value={config?.['revenue.unlock_threshold'] ?? 100}
            onChange={(v) => update('revenue.unlock_threshold', v ?? 100)}
            style={{ width: 200 }}
          />
          <Text type="secondary" style={{ marginLeft: 8 }}>当日流水达到此金额后才可抢单</Text>
        </div>
        <div>
          <Label>免手续费流水阈值（元）</Label>
          <InputNumber
            min={0}
            step={10}
            value={config?.['revenue.free_threshold'] ?? 300}
            onChange={(v) => update('revenue.free_threshold', v ?? 300)}
            style={{ width: 200 }}
          />
          <Text type="secondary" style={{ marginLeft: 8 }}>当日流水达到此金额后免手续费</Text>
        </div>
        <div>
          <Label>低流水预警（元）</Label>
          <InputNumber
            min={0}
            step={10}
            value={config?.['revenue.low_warning'] ?? 300}
            onChange={(v) => update('revenue.low_warning', v ?? 300)}
            style={{ width: 200 }}
          />
          <Text type="secondary" style={{ marginLeft: 8 }}>低于此金额触发低流水警告</Text>
        </div>
      </Space>
    </Card>
  );

  // ── Tab 2: 结算规则 ──

  const renderShareTiers = () => {
    const tiers: ShareTier[] = config?.['revenue.share_tiers'] ?? [];

    const addTier = () => {
      const prev = tiers[tiers.length - 1];
      const newMin = prev ? (prev.max ?? 0) + 0.1 : 0;
      update('revenue.share_tiers', [...tiers, { min: newMin, max: null, studio: 50, companion: 50 }]);
    };

    const removeTier = (idx: number) => {
      update('revenue.share_tiers', tiers.filter((_, i) => i !== idx));
    };

    const updateTier = (idx: number, field: keyof ShareTier, val: any) => {
      const next = tiers.map((t, i) => (i === idx ? { ...t, [field]: val } : t));
      update('revenue.share_tiers', next);
    };

    return (
      <Card
        title="📊 结算规则"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button
              type="primary"
              icon={React.createElement(SaveOutlined)}
              loading={saving === '结算规则'}
              onClick={() => save({ 'revenue.share_tiers': tiers }, '结算规则')}
            >
              保存
            </Button>
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
                min={0}
                step={100}
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
                min={0}
                step={100}
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
                min={0}
                max={100}
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
                min={0}
                max={100}
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
        <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          流水区间按当日累计流水自动匹配，系统取最高匹配档位结算。第一档最低流水固定为 0。
        </Text>
      </Card>
    );
  };

  // ── Tab 3: 支取与押金 ──

  const renderWithdraw = () => (
    <Card
      title="💸 支取与押金"
      extra={
        <Space>
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
          <Button
            type="primary"
            icon={React.createElement(SaveOutlined)}
            loading={saving === '支取与押金'}
            onClick={() =>
              save(
                {
                  'withdraw.advance_ratio': config?.['withdraw.advance_ratio'],
                  'withdraw.default_deposit': config?.['withdraw.default_deposit'],
                },
                '支取与押金',
              )
            }
          >
            保存
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Label>预支比例（%）</Label>
          <InputNumber
            min={0}
            max={100}
            step={5}
            value={config?.['withdraw.advance_ratio'] ?? 50}
            onChange={(v) => update('withdraw.advance_ratio', v ?? 50)}
            style={{ width: 200 }}
          />
          <Text type="secondary" style={{ marginLeft: 8 }}>可预支收入的比例上限</Text>
        </div>
        <div>
          <Label>默认押金（元）</Label>
          <InputNumber
            min={0}
            step={50}
            value={config?.['withdraw.default_deposit'] ?? 500}
            onChange={(v) => update('withdraw.default_deposit', v ?? 500)}
            style={{ width: 200 }}
          />
          <Text type="secondary" style={{ marginLeft: 8 }}>新陪玩注册时的默认押金金额</Text>
        </div>
      </Space>
    </Card>
  );

  // ── Tab 4: 超时与关机 ──

  const renderTimeout = () => (
    <Card
      title="⏰ 超时与关机"
      extra={
        <Space>
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
          <Button
            type="primary"
            icon={React.createElement(SaveOutlined)}
            loading={saving === '超时与关机'}
            onClick={() =>
              save(
                {
                  'timeout.grace_minutes': config?.['timeout.grace_minutes'],
                  'timeout.rest_shutdown': config?.['timeout.rest_shutdown'],
                  'timeout.idle_shutdown': config?.['timeout.idle_shutdown'],
                  'entertainment.idle_shutdown': config?.['entertainment.idle_shutdown'],
                  'entertainment.shutdown_countdown': config?.['entertainment.shutdown_countdown'],
                },
                '超时与关机',
              )
            }
          >
            保存
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Label>超时宽限（分钟）</Label>
          <InputNumber
            min={1}
            step={1}
            value={config?.['timeout.grace_minutes'] ?? 10}
            onChange={(v) => update('timeout.grace_minutes', v ?? 10)}
            style={{ width: 200 }}
          />
          <Text type="secondary" style={{ marginLeft: 8 }}>订单超时后额外等待时间</Text>
        </div>
        <div>
          <Label>休息关机（分钟）</Label>
          <InputNumber
            min={0}
            step={5}
            value={config?.['timeout.rest_shutdown'] ?? 60}
            onChange={(v) => update('timeout.rest_shutdown', v ?? 60)}
            style={{ width: 200 }}
          />
          <Text type="secondary" style={{ marginLeft: 8 }}>休息状态持续多久后自动关机</Text>
        </div>
        <div>
          <Label>空闲关机 - 订单（分钟）</Label>
          <InputNumber
            min={0}
            step={5}
            value={config?.['timeout.idle_shutdown'] ?? 60}
            onChange={(v) => update('timeout.idle_shutdown', v ?? 60)}
            style={{ width: 200 }}
          />
          <Text type="secondary" style={{ marginLeft: 8 }}>无订单空闲多久后自动关机</Text>
        </div>
        <div>
          <Label>空闲关机 - 娱乐（分钟）</Label>
          <InputNumber
            min={0}
            step={5}
            value={config?.['entertainment.idle_shutdown'] ?? 60}
            onChange={(v) => update('entertainment.idle_shutdown', v ?? 60)}
            style={{ width: 200 }}
          />
          <Text type="secondary" style={{ marginLeft: 8 }}>娱乐模式下空闲多久后关机</Text>
        </div>
        <div>
          <Label>关机倒计时（秒）</Label>
          <InputNumber
            min={5}
            step={5}
            value={config?.['entertainment.shutdown_countdown'] ?? 30}
            onChange={(v) => update('entertainment.shutdown_countdown', v ?? 30)}
            style={{ width: 200 }}
          />
          <Text type="secondary" style={{ marginLeft: 8 }}>关机前倒计时提示秒数</Text>
        </div>
      </Space>
    </Card>
  );

  // ── Tab 5: 娱乐模式门槛 ──

  const renderEntertainmentThreshold = () => (
    <Card title="🎮 娱乐模式门槛" extra={
      <Space>
        <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
        <Button type="primary" icon={React.createElement(SaveOutlined)} loading={saving === '娱乐模式门槛'}
          onClick={() => save({ 'entertainment.deposit_threshold': config?.['entertainment.deposit_threshold'], 'entertainment.revenue_threshold': config?.['entertainment.revenue_threshold'] }, '娱乐模式门槛')}>保存</Button>
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
          <Label>月流水门槛（元）</Label>
          <InputNumber min={0} step={50} value={config?.['entertainment.revenue_threshold'] ?? 200}
            onChange={(v) => update('entertainment.revenue_threshold', v ?? 200)} style={{ width: 200 }} />
          <Text type="secondary" style={{ marginLeft: 8 }}>月流水低于此金额无法切换娱乐模式</Text>
        </div>
      </Space>
    </Card>
  );

  // ── Tab 6: 下拉选项 ──

  const renderOptions = () => {
    const contactResults: string[] = config?.['options.contact_results'] ?? [];
    const finishResults: string[] = config?.['options.finish_results'] ?? [];
    const failReasons: string[] = config?.['options.fail_reasons'] ?? [];

    return (
      <Card
        title="📋 下拉选项"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button
              type="primary"
              icon={React.createElement(SaveOutlined)}
              loading={saving === '下拉选项'}
              onClick={() =>
                save(
                  {
                    'options.contact_results': contactResults,
                    'options.finish_results': finishResults,
                    'options.fail_reasons': failReasons,
                  },
                  '下拉选项',
                )
              }
            >
              保存
            </Button>
          </Space>
        }
      >
        <TagListEditor
          label="联系结果选项"
          tags={contactResults}
          onChange={(tags) => update('options.contact_results', tags)}
        />
        <TagListEditor
          label="完结结果选项"
          tags={finishResults}
          onChange={(tags) => update('options.finish_results', tags)}
        />
        <TagListEditor
          label="未完成原因选项"
          tags={failReasons}
          onChange={(tags) => update('options.fail_reasons', tags)}
        />
      </Card>
    );
  };

  // ── Tab 6: 游戏与段位 ──

  const renderGamesRanks = () => {
    const games: string[] = config?.games ?? [];
    const ranks: string[] = config?.ranks ?? [];

    return (
      <Card
        title="🎮 游戏与段位"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button
              type="primary"
              icon={React.createElement(SaveOutlined)}
              loading={saving === '游戏与段位'}
              onClick={() => save({ games, ranks }, '游戏与段位')}
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
              tags={games}
              onChange={(tags) => update('games', tags)}
            />
          </Col>
          <Col span={12}>
            <TagListEditor
              label="段位列表"
              tags={ranks}
              onChange={(tags) => update('ranks', tags)}
            />
          </Col>
        </Row>
      </Card>
    );
  };

  // ── Render ──

  if (loading && !config) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Text type="secondary">加载中...</Text>
      </div>
    );
  }

  const tabItems = [
    { key: 'revenue', label: '💰 流水与价格', children: renderRevenue() },
    { key: 'share', label: '📊 结算规则', children: renderShareTiers() },
    { key: 'withdraw', label: '💸 支取与押金', children: renderWithdraw() },
    { key: 'timeout', label: '⏰ 超时与关机', children: renderTimeout() },
    { key: 'entertainment', label: '🎮 娱乐模式门槛', children: renderEntertainmentThreshold() },
    { key: 'options', label: '📋 下拉选项', children: renderOptions() },
    { key: 'games', label: '🎮 游戏与段位', children: renderGamesRanks() },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>系统设置</Title>
        <Text type="secondary">管理系统全局配置项，修改后即时生效</Text>
      </div>
      <Tabs defaultActiveKey="revenue" items={tabItems} />
    </div>
  );
};

export default SettingsPage;
