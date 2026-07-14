import React, { useState, useEffect, useCallback, createElement, useMemo } from 'react';
import { Table, Tag, Typography, Select, Button, Space, Tooltip, Card, Row, Col, Statistic, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { blacklistApi } from '../../api/blacklist';
import { companionsApi } from '../../api/companions';

const { Text } = Typography;

interface KillLog {
  id: string;
  companion?: { user?: { username: string } };
  processName: string;
  pid?: number;
  success: boolean;
  resultText?: string;
  triggeredBy: string;
  createdAt: string;
}

const triggerLabels: Record<string, string> = { PERIODIC: '定时检查', PUSH: '推送触发', USER_IMMEDIATE: '用户手动' };

const ProcessKillLogPage: React.FC = () => {
  const [logs, setLogs] = useState<KillLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [companionFilter, setCompanionFilter] = useState<string | undefined>();
  const [companions, setCompanions] = useState<{ id: string; user?: { username: string } }[]>([]);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await blacklistApi.getKillLogs({ companionId: companionFilter });
      setLogs(data.data?.items ?? []);
    } catch { message.error('加载失败'); } finally { setLoading(false); }
  }, [companionFilter]);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { companionsApi.list().then(({ data }) => setCompanions(data.data ?? [])).catch(() => {}); }, []);

  const topProcesses = useMemo(() => {
    const count: Record<string, number> = {};
    logs.forEach(l => { count[l.processName] = (count[l.processName] || 0) + 1; });
    return Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [logs]);

  const topCompanions = useMemo(() => {
    const count: Record<string, number> = {};
    logs.forEach(l => { const name = l.companion?.user?.username || '未知'; count[name] = (count[name] || 0) + 1; });
    return Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [logs]);

  const columns = [
    { title: '陪玩', key: 'companion', width: 120,
      render: (_: unknown, r: KillLog) => r.companion?.user?.username || '-' },
    { title: '进程', dataIndex: 'processName', key: 'process', width: 160,
      render: (v: string) => <Text code>{v}</Text> },
    { title: 'PID', dataIndex: 'pid', key: 'pid', width: 80 },
    { title: '结果', dataIndex: 'success', key: 'success', width: 80,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? '成功' : '失败'}</Tag> },
    { title: '详情', dataIndex: 'resultText', key: 'resultText', width: 160, ellipsis: true,
      render: (v: string | undefined) => v ? <Tooltip title={v}><Text type="secondary" style={{ fontSize: 12, maxWidth: 150 }} ellipsis>{v}</Text></Tooltip> : '-' },
    { title: '触发方式', dataIndex: 'triggeredBy', key: 'trigger', width: 100,
      render: (v: string) => triggerLabels[v] || v },
    { title: '时间', dataIndex: 'createdAt', key: 'time', width: 170,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text strong style={{ fontSize: 16 }}>杀进程日志</Text>
        <Space>
          <Select placeholder="按陪玩筛选" allowClear style={{ width: 160 }} value={companionFilter}
            onChange={setCompanionFilter}
            options={companions.map((c) => ({ label: c.user?.username || c.id, value: c.id }))} />
          <Button icon={createElement(ReloadOutlined)} onClick={fetch} loading={loading}>刷新</Button>
        </Space>
      </div>
            <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col span={6}><Card size="small"><Statistic title="总杀进程次数" value={logs.length} valueStyle={{ fontSize: 20 }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="成功" value={logs.filter(l => l.success).length} valueStyle={{ fontSize: 20, color: '#3f8600' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="失败" value={logs.filter(l => !l.success).length} valueStyle={{ fontSize: 20, color: '#cf1322' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="告警" value={logs.filter(l => l.resultText?.includes('REPEAT_KILL_ALERT') || l.resultText?.includes('RATE_LIMITED')).length} valueStyle={{ fontSize: 20, color: '#faad14' }} /></Card></Col>
      </Row>
      {topProcesses.length > 0 && (
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={12}>
            <Card size="small" title="Top 5 被杀进程">
              {topProcesses.map(([name, count], i) => (
                <Tag key={name} color={i === 0 ? 'red' : i < 3 ? 'orange' : 'default'} style={{ marginBottom: 4 }}>
                  {name}: {count}次
                </Tag>
              ))}
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small" title="Top 5 陪玩杀进程">
              {topCompanions.map(([name, count], i) => (
                <Tag key={name} color={i === 0 ? 'blue' : i < 3 ? 'geekblue' : 'default'} style={{ marginBottom: 4 }}>
                  {name}: {count}次
                </Tag>
              ))}
            </Card>
          </Col>
        </Row>
      )}

      <Table size="small" columns={columns} dataSource={logs} rowKey="id" loading={loading}
        locale={{ emptyText: '暂无杀进程记录' }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }} />
    </div>
  );
};

export default ProcessKillLogPage;
