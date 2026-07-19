// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Card, InputNumber, Button, Space, Typography, message } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';

const { Text } = Typography;

const Label = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ display: 'inline-block', minWidth: 140, marginBottom: 4 }}>
    {children}
  </Text>
);

const RevenueSettings: React.FC = () => {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);

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

  const saveKeys = async (keys: Record<string, any>, label: string) => {
    try {
      await configApi.update(keys);
      message.success(`${label} 已保存`);
    } catch {
      message.error('保存失败');
    }
  };

  if (loading && !config) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Text type="secondary">加载中...</Text></div>;
  }

  return (
    <div>
      {/* Revenue & Pricing */}
      <Card
        title="💰 流水与价格"
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button
              type="primary"
              icon={React.createElement(SaveOutlined)}
              onClick={() =>
                saveKeys(
                  {
                    'revenue.unlock_threshold': config?.['revenue.unlock_threshold'],
                    'revenue.free_threshold': config?.['revenue.free_threshold'],
                    'revenue.low_warning': config?.['revenue.low_warning'],
                    'entertainment.hourly_rate': config?.['entertainment.hourly_rate'],
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
              min={0} step={10}
              value={config?.['revenue.unlock_threshold'] ?? 100}
              onChange={(v) => update('revenue.unlock_threshold', v ?? 100)}
              style={{ width: 200 }}
            />
            <Text type="secondary" style={{ marginLeft: 8 }}>当日流水达到此金额后才可抢单</Text>
          </div>
          <div>
            <Label>免手续费流水阈值（元）</Label>
            <InputNumber
              min={0} step={10}
              value={config?.['revenue.free_threshold'] ?? 300}
              onChange={(v) => update('revenue.free_threshold', v ?? 300)}
              style={{ width: 200 }}
            />
            <Text type="secondary" style={{ marginLeft: 8 }}>当日流水达到此金额后免手续费</Text>
          </div>
          <div>
            <Label>低流水预警（元）</Label>
            <InputNumber
              min={0} step={10}
              value={config?.['revenue.low_warning'] ?? 300}
              onChange={(v) => update('revenue.low_warning', v ?? 300)}
              style={{ width: 200 }}
            />
            <Text type="secondary" style={{ marginLeft: 8 }}>低于此金额触发低流水警告</Text>
          </div>
          <div>
            <Label>娱乐模式时薪（元/小时）</Label>
            <InputNumber
              min={0} step={10}
              value={config?.['entertainment.hourly_rate'] ?? 60}
              onChange={(v) => update('entertainment.hourly_rate', v ?? 60)}
              style={{ width: 200 }}
            />
            <Text type="secondary" style={{ marginLeft: 8 }}>陪玩切换到娱乐模式后每小时扣费金额，默认 ¥60</Text>
          </div>
        </Space>
      </Card>

      {/* Withdraw & Deposit */}
      <Card
        title="💸 支取与押金"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchConfig} loading={loading}>刷新</Button>
            <Button
              type="primary"
              icon={React.createElement(SaveOutlined)}
              onClick={() =>
                saveKeys(
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
              min={0} max={100} step={5}
              value={config?.['withdraw.advance_ratio'] ?? 50}
              onChange={(v) => update('withdraw.advance_ratio', v ?? 50)}
              style={{ width: 200 }}
            />
            <Text type="secondary" style={{ marginLeft: 8 }}>可预支收入的比例上限</Text>
          </div>
          <div>
            <Label>默认押金（元）</Label>
            <InputNumber
              min={0} step={50}
              value={config?.['withdraw.default_deposit'] ?? 500}
              onChange={(v) => update('withdraw.default_deposit', v ?? 500)}
              style={{ width: 200 }}
            />
            <Text type="secondary" style={{ marginLeft: 8 }}>新陪玩注册时的默认押金金额</Text>
          </div>
        </Space>
      </Card>
    </div>
  );
};

export default RevenueSettings;
