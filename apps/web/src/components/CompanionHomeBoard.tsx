// craftsman-ignore: TS001,TS002,TS003
import React from 'react';
import { Card, Row, Col, Progress, Tag, Typography, Space, Empty } from 'antd';

const { Text } = Typography;

/**
 * 陪玩端首页看板（老板 2026-10-04）。
 * 老板原话：「我打开首页，把我想看的全部一目了然多好……包括陪玩端 客服端 老板端 都让他们去首页一目了然」，
 * 而且明确要「进度条样式，从高到低排列」。所以这一块全部用进度条，不用表格：
 *   ① 我的关键数字（今日/本月流水、单量、名额、客户）
 *   ② 我的 KPI 进度条（首单成功率 / 续单率 / 复购率 / 微信添加率 / 转化率）+ 综合分与距下一级
 *   ③ 我的客户消费榜（金额从高到低，进度条）
 */

const yuan = (v: unknown) => `¥${(Number(v) || 0).toFixed(1)}`;
const pct = (v: unknown) => `${Math.round(Number(v) || 0)}%`;

const ATT_META: Record<string, { label: string; color: string }> = {
  PRESENT: { label: '正常打卡', color: '#16A34A' },
  LATE: { label: '迟到', color: '#CF1322' },
  EARLY_LEAVE: { label: '早退', color: '#FA8C16' },
  LATE_EARLY: { label: '迟到 + 早退', color: '#CF1322' },
  ABSENT: { label: '未打卡', color: '#8C8C8C' },
  NOT_STARTED: { label: '未到上班时间', color: '#8C8C8C' },
};

const TIER_META: Record<string, { label: string; color: string }> = {
  TOP: { label: '上等马', color: '#D4A017' },
  MIDDLE: { label: '中等马', color: '#1677FF' },
  LOW: { label: '下等马', color: '#8C8C8C' },
};

const Kpi: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; tint: string }> = ({ label, value, sub, tint }) => (
  <Card size="small" bodyStyle={{ padding: '10px 12px' }} style={{ height: '100%' }}>
    <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.3, color: tint, letterSpacing: '-0.5px' }}>{value}</div>
    <div style={{ fontSize: 11, color: '#94A3B8', minHeight: 15 }}>{sub}</div>
  </Card>
);

const Bar: React.FC<{ label: string; percent: number; text: string; color: string }> = ({ label, percent, text, color }) => (
  <div style={{ marginBottom: 6 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
      <Text style={{ color: '#475569' }}>{label}</Text>
      <Text strong style={{ color }}>{text}</Text>
    </div>
    <Progress percent={Math.max(0, Math.min(100, Math.round(percent)))} showInfo={false} strokeColor={color} size="small" />
  </div>
);

interface Props {
  /** 「我的工作台」接口（/companions/me/workbench） */
  workbench: any;
  /** 我的综合分 / 段位 / 距下一级（/companions/me/excellence） */
  excellence: any;
  /** 今日抢单名额（/orders/pool/status） */
  quota: any;
  /** 我的客户列表（/customers） */
  customers: any[];
  /** 我今天的考勤（/companions/me/attendance-today） */
  attendance: any;
}

const CompanionHomeBoard: React.FC<Props> = ({ workbench, excellence, quota, customers, attendance }) => {
  const w = workbench || {};
  const monthRevenue = Number(w?.tierInfo?.monthlyRevenue ?? excellence?.revenueYuan ?? 0);
  const rankScore = Number(excellence?.rankScore ?? 0);
  const tier = String(excellence?.tier || 'MIDDLE');
  const tierMeta = TIER_META[tier] || TIER_META.MIDDLE;
  const excellentThreshold = Number(excellence?.excellentThreshold ?? 60);
  const middleThreshold = Number(excellence?.middleTierThreshold ?? 30);
  const nextGapText = !excellence
    ? '评分加载中…'
    : tier === 'TOP'
      ? '已是最高段位 👑'
      : tier === 'MIDDLE'
        ? `距上等马还差 ${Math.max(0, excellentThreshold - rankScore)} 分（上等马线 ${excellentThreshold} 分）`
        : `距中等马还差 ${Math.max(0, middleThreshold - rankScore)} 分（中等马线 ${middleThreshold} 分）`;
  // 进度条分母取「下一档分数线」：这样条子涨多少 = 离升级还差多少，不拿 999 那种大数当分母。
  const nextLine = rankScore < middleThreshold ? middleThreshold : rankScore < excellentThreshold ? excellentThreshold : 0;
  const scoreMax = Math.max(1, nextLine || rankScore || 100);

  const list = Array.isArray(customers) ? customers : [];
  const sortedCustomers = [...list]
    .map((c: any) => ({ ...c, spent: Number(c?.totalSpent ?? c?.spent ?? 0) }))
    .sort((a: any, b: any) => b.spent - a.spent)
    .slice(0, 10);
  const maxSpent = Math.max(1, ...sortedCustomers.map((c: any) => c.spent));
  const totalSpent = list.reduce((s: number, c: any) => s + Number(c?.totalSpent ?? 0), 0);

  const att = attendance ? ATT_META[String(attendance.status)] : null;
  const attTime = attendance?.loginAt ? new Date(attendance.loginAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div style={{ marginBottom: 12 }}>
      {/* ① 关键数字 */}
      <Row gutter={[8, 8]} style={{ marginBottom: 10 }}>
        <Col xs={12} md={4}><Kpi label="今日流水" value={yuan(w.todayRevenue)} sub={`本月 ${yuan(monthRevenue)}`} tint="#1677FF" /></Col>
        <Col xs={12} md={4}><Kpi label="今日接单" value={`${w.todayOrderCount ?? 0} 单`} sub={`本月 ${w.monthlyOrderCount ?? 0} 单`} tint="#16A34A" /></Col>
        <Col xs={12} md={4}><Kpi label="综合分 · 段位" value={rankScore} sub={<span style={{ color: tierMeta.color }}>{tierMeta.label}</span>} tint={tierMeta.color} /></Col>
        <Col xs={12} md={4}>
          <Kpi
            label="今日剩余抢单名额"
            value={quota ? `${quota.remaining ?? 0} 个` : '—'}
            sub={quota ? `每天发 ${quota.dailyLimit ?? 0} 个 · 今天已用 ${quota.usedToday ?? 0}` : '名额加载中…'}
            tint={Number(quota?.remaining) > 0 ? '#722ED1' : '#FA8C16'}
          />
        </Col>
        <Col xs={12} md={4}><Kpi label="我的客户" value={`${list.length} 个`} sub={`累计消费 ${yuan(totalSpent)}`} tint="#EB2F96" /></Col>
        {/* 今日考勤：本店把「陪玩考勤」关掉时接口返回 null —— 这张卡整张不显示
            （老板 2026-10-04：陪玩是提成制、没必要考勤），不再挂个「未考勤」占地方。 */}
        {attendance && (
          <Col xs={12} md={4}>
            <Kpi
              label="今日考勤"
              value={att ? att.label : '未考勤'}
              sub={attTime ? `${attTime} 打卡 · 上班 ${attendance?.workStart || '—'}` : `上班时间 ${attendance?.workStart || '—'}`}
              tint={att ? att.color : '#8C8C8C'}
            />
          </Col>
        )}
      </Row>

      <Row gutter={[12, 12]}>
        {/* ② 我的 KPI */}
        <Col xs={24} lg={12}>
          <Card size="small" title="📈 我的 KPI（达标自动加分）" style={{ height: '100%' }}>
            <Bar label="新客首单成功率" percent={Number(excellence?.newRate ?? 0)} text={pct(excellence?.newRate)} color="#2563EB" />
            <Bar label="续单率" percent={Number(excellence?.renewRate ?? 0)} text={pct(excellence?.renewRate)} color="#16A34A" />
            <Bar label="复购率" percent={Number(excellence?.repurchaseRate ?? 0)} text={pct(excellence?.repurchaseRate)} color="#722ED1" />
            <Bar label="微信添加成功率" percent={Number(w.wechatAddRate ?? 0)} text={pct(w.wechatAddRate)} color="#EB2F96" />
            <Bar label="转化率" percent={Number(w.conversionRate ?? 0)} text={pct(w.conversionRate)} color="#FA8C16" />
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #E2E8F0' }}>
              <Bar label="综合分" percent={(rankScore / scoreMax) * 100} text={nextLine > 0 ? `${rankScore} / ${scoreMax}` : `${rankScore} 分`} color={tierMeta.color} />
              <Space size={6} wrap style={{ marginTop: 2 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>{nextGapText}</Text>
                {excellence?.scoreDelta?.hasBaseline && excellence.scoreDelta.delta !== 0 ? (
                  <Tag color={excellence.scoreDelta.delta > 0 ? 'green' : 'red'} style={{ marginInlineEnd: 0 }}>
                    今日 {excellence.scoreDelta.delta > 0 ? '+' : ''}{excellence.scoreDelta.delta} 分
                  </Tag>
                ) : null}
              </Space>
            </div>
          </Card>
        </Col>

        {/* ③ 我的客户消费榜 */}
        <Col xs={24} lg={12}>
          <Card size="small" title="💰 我的客户消费榜（从高到低）" style={{ height: '100%' }}>
            {sortedCustomers.length ? (
              sortedCustomers.map((c: any) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
                  <span style={{ width: 96, fontSize: 12, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.customerCode || c.wechatId || '客户'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <Progress percent={Math.round((c.spent / maxSpent) * 100)} showInfo={false} strokeColor="#EB2F96" size="small" />
                  </div>
                  <span style={{ width: 72, textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#EB2F96' }}>{yuan(c.spent)}</span>
                </div>
              ))
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有客户，抢到单加上客户微信就会出现在这里" />
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default CompanionHomeBoard;
