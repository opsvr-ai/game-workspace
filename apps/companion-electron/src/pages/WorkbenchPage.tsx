import React, { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Button, Tag, Progress, Typography, Space, message } from 'antd';
import {
  DollarOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  CoffeeOutlined,
} from '@ant-design/icons';

const { Text, Title } = Typography;

const StatBlock: React.FC<{ label: string; value: string | number; icon: React.ReactNode; color: string }> =
  ({ label, value, icon, color }) => (
    <Card size="small" style={{ borderLeft: `3px solid ${color}`, textAlign: 'center', background: '#1E293B' }}>
      <div style={{ fontSize: 24, color, opacity: 0.5, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#E2E8F0' }}>{value}</div>
      <Text style={{ fontSize: 12, color: '#94A3B8' }}>{label}</Text>
    </Card>
  );

const companionStatusConfig: Record<string, { color: string; label: string }> = {
  ONLINE: { color: 'green', label: '空闲' },
  BUSY: { color: 'red', label: '接单中' },
  IDLE: { color: 'gold', label: '娱乐中' },
  RESTING: { color: 'orange', label: '休息中' },
  OFFLINE: { color: 'default', label: '离线' },
};

interface Props {
  onStatusChange: (status: string) => void;
}

const WorkbenchPage: React.FC<Props> = ({ onStatusChange }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.electronAPI.apiRequest({ method: 'GET', url: '/companions/me/workbench' });
      if (res.code === 200) setData(res.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const switchStatus = async (status: string) => {
    try {
      const res = await window.electronAPI.apiRequest({
        method: 'PUT',
        url: `/companions/me/status`,
        body: { status },
      });
      if (res.data?.blocked) {
        message.warning('不满足娱乐模式条件，请检查押金和流水');
        return;
      }
      onStatusChange(status);
      fetchData();
      message.success(`已切换至 ${companionStatusConfig[status]?.label || status}`);
    } catch { message.error('切换失败'); }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#64748B' }}>加载中...</div>;
  }

  const unlockPct = data ? Math.min(Math.round((data.todayRevenue / data.unlockThreshold) * 100), 100) : 0;
  const freePct = data ? Math.min(Math.round((data.todayRevenue / data.freeThreshold) * 100), 100) : 0;

  return (
    <div>
      <Title level={4} style={{ color: '#E2E8F0' }}>👤 我的工作台</Title>

      <Row gutter={[12, 12]}>
        <Col span={6}>
          <StatBlock label="今日流水" value={data ? `¥${data.todayRevenue}` : '-'} icon={<DollarOutlined />} color="#1677ff" />
        </Col>
        <Col span={6}>
          <StatBlock label="解锁门槛" value={data?.isUnlocked ? '✅ 已解锁' : data ? `¥${data.unlockThreshold}` : '-'}
            icon={<ThunderboltOutlined />} color={data?.isUnlocked ? '#52c41a' : '#faad14'} />
        </Col>
        <Col span={6}>
          <StatBlock label="娱乐计时" value={data ? `${data.entertainmentMinutes}分钟` : '-'}
            icon={<ClockCircleOutlined />} color="#eb2f96" />
        </Col>
        <Col span={6}>
          <StatBlock label="暂扣费用" value={data ? `¥${data.entertainmentFee}` : '-'}
            icon={<DollarOutlined />} color="#ff4d4f" />
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col span={16}>
          <Row gutter={[12, 12]}>
            <Col span={12}>
              <Card size="small" style={{ background: '#1E293B' }}>
                <Text style={{ color: '#E2E8F0' }}>🎯 流水解锁进度：¥{data?.todayRevenue || 0} / ¥{data?.unlockThreshold || 0}</Text>
                <Progress percent={unlockPct} status={data?.isUnlocked ? 'success' : 'active'} />
                <Text style={{ color: '#94A3B8', fontSize: 12 }}>
                  {data?.isUnlocked ? '订单池已解锁 ✅' : `还差 ¥${(data?.unlockThreshold || 0) - (data?.todayRevenue || 0)} 解锁订单池`}
                </Text>
              </Card>
            </Col>
            <Col span={12}>
              <Card size="small" style={{ background: '#1E293B' }}>
                <Text style={{ color: '#E2E8F0' }}>🎯 免单门槛：¥{data?.freeThreshold || 0}</Text>
                <Progress percent={freePct} status={data?.todayRevenue >= data?.freeThreshold ? 'success' : 'active'} strokeColor="#eb2f96" />
                <Text style={{ color: '#94A3B8', fontSize: 12 }}>
                  还差 ¥{Math.max(0, (data?.freeThreshold || 0) - (data?.todayRevenue || 0))} 免娱乐费
                </Text>
              </Card>
            </Col>
          </Row>
          <Row gutter={12} style={{ marginTop: 12 }}>
            {(['entertainment', 'idle', 'work', 'rest'] as const).map(mode => {
              const labels: Record<string, string> = { entertainment: '🎮娱乐', idle: '💼空闲', work: '🔴接单', rest: '🛏️休息' };
              return (
                <Col span={6} key={mode}>
                  <Card size="small" style={{ textAlign: 'center', background: '#1E293B' }}>
                    <Text style={{ color: '#94A3B8', fontSize: 12 }}>{labels[mode]}</Text>
                    <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: '#E2E8F0' }}>
                      {data?.statusDurations?.[mode] ?? '00:00'}
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        </Col>
        <Col span={8}>
          <Card size="small" style={{ textAlign: 'center', marginBottom: 12, background: '#1E293B' }}>
            <div style={{ marginBottom: 12 }}>
              <Text style={{ color: '#94A3B8', fontSize: 12 }}>当前状态</Text>
              <div style={{ marginTop: 4 }}>
                <Tag
                  color={companionStatusConfig[data?.currentStatus]?.color || 'default'}
                  style={{ fontSize: 18, padding: '4px 24px', borderRadius: 12 }}
                >
                  {companionStatusConfig[data?.currentStatus]?.label || data?.currentStatus || '未知'}
                </Tag>
              </div>
            </div>
            <Space direction="vertical" size="middle" style={{ width: '100%' }}>
              <Button icon={<PlayCircleOutlined />} size="large" onClick={() => switchStatus('IDLE')} block>娱乐中</Button>
              <Button type="primary" icon={<SearchOutlined />} size="large" onClick={() => switchStatus('ONLINE')} block>空闲</Button>
              <Button icon={<CoffeeOutlined />} size="large" onClick={() => switchStatus('RESTING')} block>休息中</Button>
            </Space>
          </Card>
          <Card title="在线陪玩" size="small" style={{ background: '#1E293B' }}>
            {data?.onlineCompanions?.map((c: any) => (
              <Tag
                key={c.id}
                color={companionStatusConfig[c.status]?.color || 'default'}
                style={{ marginBottom: 8, padding: '4px 12px', fontSize: 14 }}
              >
                {c.user?.username} {companionStatusConfig[c.status]?.label || c.status}
              </Tag>
            ))}
            {(!data?.onlineCompanions || data.onlineCompanions.length === 0) && (
              <Text style={{ color: '#94A3B8' }}>暂无在线陪玩</Text>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default WorkbenchPage;
