// craftsman-ignore: TS001,TS002,TS003
import React, { useEffect, useState, useCallback } from 'react';
import { Row, Col, Button, Tag, Space, Typography, message, Empty, Spin } from 'antd';
import {
  ThunderboltOutlined,
  FireOutlined,
  TrophyOutlined,
  AimOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  AlertOutlined,
} from '@ant-design/icons';
import { customerTrackingApi } from '../api/customerTracking';
import { extractErrorMessage } from '../utils/error-handler';

const { Text, Title } = Typography;

const glass = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  backdropFilter: 'blur(14px)',
  borderRadius: 18,
  boxShadow: '0 10px 40px rgba(0,0,0,0.35)',
} as const;

const gradientText = {
  background: 'linear-gradient(90deg,#00E5FF 0%,#7C4DFF 50%,#FF2E9A 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
} as const;

const CustomerTrackingCenter: React.FC = () => {
  const [kpi, setKpi] = useState<any>(null);
  const [anomalies, setAnomalies] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [reminders, setReminders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [k, a, r, m] = await Promise.all([
        customerTrackingApi.kpi(),
        customerTrackingApi.anomalies(),
        customerTrackingApi.deleteRequests(),
        customerTrackingApi.reminders(),
      ]);
      setKpi((k as any).data.data ?? null);
      setAnomalies((a as any).data.data ?? []);
      setRequests((r as any).data.data ?? []);
      setReminders((m as any).data.data ?? []);
    } catch (e: any) {
      message.error(extractErrorMessage(e, '加载追踪中心失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const review = async (id: string, approve: boolean, rejectReason?: string) => {
    try {
      await customerTrackingApi.reviewDeleteRequest(id, approve, rejectReason);
      message.success(approve ? '已通过，客户已从陪玩端移除' : '已拒绝');
      load();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '操作失败'));
    }
  };

  const statCards = [
    { label: '优质客户留存率', value: `${kpi?.retentionRate ?? 0}%`, icon: TrophyOutlined, color: '#00E5FF' },
    { label: '客户转化率', value: `${kpi?.conversionRate ?? 0}%`, icon: AimOutlined, color: '#7C4DFF' },
    { label: '近 3 日追踪', value: kpi?.trackedRecentCount ?? 0, icon: ThunderboltOutlined, color: '#FFB300' },
    { label: '响应/投诉风险', value: kpi?.responseRiskCount ?? 0, icon: FireOutlined, color: '#FF2E9A' },
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div
      style={{
        background:
          'radial-gradient(1200px 500px at 10% 0%, rgba(124,77,255,0.28), transparent 55%), radial-gradient(1000px 500px at 100% 0%, rgba(0,229,255,0.20), transparent 55%), linear-gradient(160deg,#070B18 0%,#0B1024 45%,#130B2E 100%)',
        borderRadius: 24,
        padding: '28px 26px 34px',
        color: '#EAF2FF',
        minHeight: 560,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 26 }}>
        <div>
          <Text style={{ color: '#8A97B8', letterSpacing: 3, textTransform: 'uppercase' }}>
            Commander Control · 客户追踪中心
          </Text>
          <Title level={2} style={{ ...gradientText, margin: '6px 0 0', fontSize: 34, fontWeight: 800 }}>
            把每一个客户追到底
          </Title>
        </div>
        <Button
          ghost
          onClick={load}
          style={{ borderColor: 'rgba(0,229,255,0.5)', color: '#00E5FF', fontWeight: 700 }}
        >
          刷新
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        {statCards.map((s) => (
          <Col xs={24} sm={12} lg={6} key={s.label}>
            <div style={{ ...glass, padding: 20, position: 'relative', overflow: 'hidden' }}>
              <div
                style={{
                  position: 'absolute',
                  top: -30,
                  right: -30,
                  width: 100,
                  height: 100,
                  borderRadius: '50%',
                  background: `radial-gradient(circle, ${s.color}55, transparent 70%)`,
                }}
              />
              <s.icon style={{ color: s.color, fontSize: 22 }} />
              <div style={{ marginTop: 14, fontSize: 34, fontWeight: 800, lineHeight: 1, textShadow: `0 0 24px ${s.color}66` }}>
                {s.value}
              </div>
              <Text style={{ color: '#A9B7D9', marginTop: 8, display: 'block' }}>{s.label}</Text>
            </div>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 22 }}>
        <Col xs={24} lg={12}>
          <div style={{ ...glass, padding: 20, minHeight: 300 }}>
            <Space align="center" style={{ marginBottom: 14 }}>
              <AlertOutlined style={{ color: '#FF2E9A', fontSize: 18 }} />
              <Text strong style={{ color: '#fff', fontSize: 16 }}>异常波动雷达</Text>
              <Tag color="magenta" style={{ borderRadius: 999 }}>{anomalies.length} 条</Tag>
            </Space>
            {anomalies.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ color: '#8A97B8' }}>暂无异常</span>} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {anomalies.slice(0, 6).map((a: any, idx: number) => (
                  <div
                    key={idx}
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      background: 'linear-gradient(90deg, rgba(255,46,154,0.14), rgba(255,46,154,0.02))',
                      border: '1px solid rgba(255,46,154,0.25)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text strong style={{ color: '#fff' }}>{a.wechatId || '未知客户'}</Text>
                      <Tag color="red" style={{ borderRadius: 999 }}>↓ {a.dropPercent}%</Tag>
                    </div>
                    <Text style={{ color: '#A9B7D9', fontSize: 12 }}>
                      陪玩：{a.companion?.user?.displayName || a.companion?.user?.username || '-'} · 近周 ¥{Math.round(a.recentSpend)} / 基线 ¥{Math.round(a.baselineWeekly)}
                    </Text>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Col>

        <Col xs={24} lg={12}>
          <div style={{ ...glass, padding: 20, minHeight: 300 }}>
            <Space align="center" style={{ marginBottom: 14 }}>
              <CheckCircleOutlined style={{ color: '#00E5FF', fontSize: 18 }} />
              <Text strong style={{ color: '#fff', fontSize: 16 }}>删除申请审核</Text>
            </Space>
            {requests.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ color: '#8A97B8' }}>暂无待处理申请</span>} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {requests.slice(0, 8).map((r: any) => (
                  <div
                    key={r.id}
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <Text strong style={{ color: '#fff' }}>{r.customer?.wechatId || '未知客户'}</Text>
                        <div>
                          <Text style={{ color: '#A9B7D9', fontSize: 12 }}>
                            {r.companion?.user?.displayName || r.companion?.user?.username || '-'} · {r.status}
                          </Text>
                        </div>
                      </div>
                      {r.status === 'PENDING' ? (
                        <Space>
                          <Button size="small" type="primary" icon={React.createElement(CheckCircleOutlined)} onClick={() => review(r.id, true)}>
                            通过
                          </Button>
                          <Button size="small" danger icon={React.createElement(CloseCircleOutlined)} onClick={() => review(r.id, false, '证据不足')}>
                            拒绝
                          </Button>
                        </Space>
                      ) : (
                        <Tag color={r.status === 'APPROVED' ? 'green' : 'red'}>{r.status === 'APPROVED' ? '已通过' : '已拒绝'}</Tag>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Col>
      </Row>

      <div style={{ ...glass, padding: 20, marginTop: 22 }}>
        <Space align="center" style={{ marginBottom: 14 }}>
          <ThunderboltOutlined style={{ color: '#FFB300', fontSize: 18 }} />
          <Text strong style={{ color: '#fff', fontSize: 16 }}>不消费客户提醒</Text>
          <Tag color="gold" style={{ borderRadius: 999 }}>{reminders.length} 位</Tag>
        </Space>
        {reminders.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ color: '#8A97B8' }}>没有需要追踪的客户</span>} />
        ) : (
          <Row gutter={[12, 12]}>
            {reminders.slice(0, 12).map((c: any) => (
              <Col xs={24} sm={12} lg={8} key={c.id}>
                <div
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: 'linear-gradient(135deg, rgba(0,229,255,0.10), rgba(124,77,255,0.08))',
                    border: '1px solid rgba(0,229,255,0.20)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text strong style={{ color: '#fff' }}>{c.wechatId || c.customerCode || '未知客户'}</Text>
                    <Tag color="cyan" style={{ borderRadius: 999 }}>待追踪</Tag>
                  </div>
                  <Text style={{ color: '#A9B7D9', fontSize: 12, display: 'block', marginTop: 6 }}>
                    {c.platform ? `${c.platform} · ` : ''}最近更新 {c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : '-'}
                  </Text>
                </div>
              </Col>
            ))}
          </Row>
        )}
      </div>
    </div>
  );
};

export default CustomerTrackingCenter;
