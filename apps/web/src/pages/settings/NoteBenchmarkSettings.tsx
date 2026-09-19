// craftsman-ignore: TS001,TS002
import React, { useEffect, useState, useCallback } from 'react';
import { Card, Button, Typography, Space, message, InputNumber, Divider, Alert } from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { configApi } from '../../api/config';
import { DEFAULT_BENCHMARKS, mergeBenchmarks } from '../../utils/noteBenchmark';

const { Text } = Typography;

const NoteBenchmarkSettings: React.FC = () => {
  const [benchmarks, setBenchmarks] = useState<any>(DEFAULT_BENCHMARKS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await configApi.get(['traffic.note_benchmarks']);
      setBenchmarks(mergeBenchmarks(data?.data?.['traffic.note_benchmarks']));
    } catch {
      message.error('加载及格线失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const setNested = (section: string, key: string, value: number | null) => {
    setBenchmarks((b: any) => ({ ...b, [section]: { ...(b[section] || {}), [key]: value } }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await configApi.update({ 'traffic.note_benchmarks': benchmarks });
      message.success('及格线已保存');
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const row = (label: string, section: string, keys: [string, string][]) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
      <Text style={{ width: 120 }}>{label}</Text>
      {keys.map(([k, name]) => (
        <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>{name}</Text>
          <InputNumber
            size="small"
            min={0}
            step={0.1}
            style={{ width: 90 }}
            value={benchmarks[section]?.[k] ?? undefined}
            onChange={(v) => setNested(section, k, v)}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>%</Text>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      <Card
        title="📊 图文笔记及格线"
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
          style={{ marginBottom: 12 }}
          message="阈值按 48 小时数据判断，随市场行情可动态调整。低于「淘汰线」的指标会在笔记里标红并提示改法。"
        />
        {row('点击率', 'clickRate', [['eliminate', '淘汰线'], ['pass', '及格线'], ['good', '良好线']])}
        {row('互动率', 'interactionRate', [['eliminate', '淘汰线'], ['pass', '及格线'], ['good', '良好线']])}
        {row('私信率', 'dmRate', [['eliminate', '淘汰线'], ['pass', '及格线'], ['good', '良好线']])}
        {row('搜索占比', 'searchRatio', [['min', '最低线'], ['idealLow', '理想下限'], ['idealHigh', '理想上限']])}
        {row('个人主页占比', 'profileRatio', [['ok', '达标线(≤)'], ['warn', '警告线(>)']])}
        {row('阅读完成率', 'readCompletionRate', [['min', '最低线']])}
        <Divider style={{ margin: '8px 0' }} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          说明：点击率=浏览÷曝光；互动率=(赞+藏+评)÷浏览；私信率=私信咨询÷浏览；图文重点看点击率、阅读完成率、互动率、私信率与流量来源。
        </Text>
      </Card>
    </div>
  );
};

export default NoteBenchmarkSettings;
