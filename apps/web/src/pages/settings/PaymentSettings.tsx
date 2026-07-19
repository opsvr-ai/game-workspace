// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Card, InputNumber, Button, Space, Typography, message, Table, Popconfirm } from 'antd';
import { ReloadOutlined, SaveOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';

const { Text } = Typography;

interface ShareTier {
  min: number;
  max: number | null;
  studio: number;
  companion: number;
}

const PaymentSettings: React.FC = () => {
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

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const save = async () => {
    setSaving(true);
    try {
      await configApi.update({
        'revenue.share_tiers': config?.['revenue.share_tiers'],
        'revenue.club_companion_share': config?.['revenue.club_companion_share'],
      });
      message.success('分账规则 已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const update = (key: string, value: any) => {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  };

  if (loading && !config) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">加载中...</Text></div>;
  }

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
      title="📊 分账规则"
      extra={
        <Space>
          <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
          <Button type="primary" icon={React.createElement(SaveOutlined)} loading={saving} onClick={save}>保存</Button>
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
              min={0} step={100}
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
              min={0} step={100}
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
              min={0} max={100}
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
              min={0} max={100}
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
      <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 16, paddingTop: 16 }}>
        <Text strong style={{ display: 'block', marginBottom: 12 }}>🏢 线上俱乐部（固定比例）</Text>
        <div>
          <Text style={{ display: 'inline-block', minWidth: 140, marginBottom: 4 }}>陪玩分成比例（%）</Text>
          <InputNumber min={1} max={99} step={5} value={config?.['revenue.club_companion_share'] ?? 80}
            onChange={(v) => update('revenue.club_companion_share', v ?? 80)} style={{ width: 200 }} />
          <Text type="secondary" style={{ marginLeft: 8 }}>线上俱乐部固定分给陪玩的比例，工作室获剩余份额，默认 80%</Text>
        </div>
      </div>
      <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
        📌 线下工作室使用阶梯档位，线上俱乐部使用固定比例。创建工作室时可选择分账模式。
      </Text>
    </Card>
  );
};

export default PaymentSettings;
