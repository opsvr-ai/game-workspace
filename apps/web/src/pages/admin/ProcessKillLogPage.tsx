import React, { useState, useEffect, useCallback, createElement } from 'react';
import { Table, Tag, Typography, Select, Button, Space, Tooltip } from 'antd';
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
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [companionFilter]);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { companionsApi.list().then(({ data }) => setCompanions(data.data ?? [])).catch(() => {}); }, []);

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Text strong style={{ fontSize: 16 }}>杀进程日志</Text>
        <Space>
          <Select placeholder="按陪玩筛选" allowClear style={{ width: 160 }} value={companionFilter}
            onChange={setCompanionFilter}
            options={companions.map((c) => ({ label: c.user?.username || c.id, value: c.id }))} />
          <Button icon={createElement(ReloadOutlined)} onClick={fetch} loading={loading}>刷新</Button>
        </Space>
      </div>
      <Table columns={columns} dataSource={logs} rowKey="id" loading={loading}
        locale={{ emptyText: '暂无杀进程记录' }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }} />
    </div>
  );
};

export default ProcessKillLogPage;
