// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Modal, Spin, Tag, Descriptions, Alert, Space, Typography } from 'antd';
import { CrownOutlined } from '@ant-design/icons';
import http from '../api/client';
import TierHorseIcon from './TierHorseIcon';

const { Text, Title } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  /** 首页已经拉到的那份（省一次请求）；没有就打开时现拉。 */
  initial?: Excellence | null;
}

interface TierRow {
  min: number;
  score: number;
}

interface Excellence {
  rankScore?: number;
  revenueScore?: number;
  bonusScore?: number;
  renewScore?: number;
  repurchaseScore?: number;
  firstSuccessScore?: number;
  excellentThreshold?: number;
  middleTierThreshold?: number;
  renewRate?: number;
  repurchaseRate?: number;
  newRate?: number;
  isExcellent?: boolean;
  tier?: 'TOP' | 'MIDDLE' | 'LOW';
  revenueYuan?: number;
  revenueTiers?: TierRow[];
  renewTiers?: TierRow[];
  repurchaseTiers?: TierRow[];
  firstSuccessTiers?: TierRow[];
  battleScreenshotBonus?: number;
  /** 今日加减分（服务端算好）：跟「昨天定点那一刻」比。 */
  scoreDelta?: {
    hasBaseline: boolean;
    baselineDate: string | null;
    total: number;
    prevTotal: number | null;
    delta: number;
    tier: string;
    prevTier: string | null;
    tierChanged: boolean;
    items: Array<{
      key: string;
      label: string;
      unit: string;
      now: number;
      before: number;
      value: number;
      prevValue: number;
      delta: number;
    }>;
  } | null;
}

const TIER: Record<string, { label: string; color: string; emoji: string }> = {
  TOP: { label: '上等马', color: '#D4A017', emoji: '👑🏇' },
  MIDDLE: { label: '中等马', color: '#A9A9A9', emoji: '🐎' },
  LOW: { label: '下等马', color: '#CD7F32', emoji: '🐴' },
};

const ExcellenceRuleModal: React.FC<Props> = ({ open, onClose, initial }) => {
  const [fetched, setFetched] = useState<Excellence | null>(null);
  const [loading, setLoading] = useState(false);
  // 优先用刚拉回来的；打开时还没拉到就先用首页那份，别让陪玩看到一个空弹窗。
  const data = fetched ?? initial ?? null;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    http
      .get('/companions/me/excellence')
      .then(({ data }: any) => setFetched(data?.data ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  // 得分和段位线一律用服务端返回的真值：以前这里自己按 0.2 / 0.1 猜，
  // 跟管理端实际配置的分档对不上（老板 2026-10-04 顺手修）。
  const renewScore = data?.renewScore ?? 0;
  const repurchaseScore = data?.repurchaseScore ?? 0;
  const newScore = data?.firstSuccessScore ?? 0;
  const tier = TIER[data?.tier || 'MIDDLE'];
  const excellentThreshold = data?.excellentThreshold ?? 50;
  const middleTierThreshold = data?.middleTierThreshold ?? 25;
  const myScore = data?.rankScore ?? 0;
  const delta = data?.scoreDelta ?? null;

  /** 每项「达到 X 得 Y 分」的完整档位表 + 陪玩自己现在在哪一档、差多少到下一档。 */
  const dims = [
    { label: '月流水', unit: '元', score: data?.revenueScore ?? 0, value: data?.revenueYuan ?? 0, tiers: data?.revenueTiers ?? [] },
    { label: '续单率', unit: '%', score: renewScore, value: data?.renewRate ?? 0, tiers: data?.renewTiers ?? [] },
    { label: '复购率', unit: '%', score: repurchaseScore, value: data?.repurchaseRate ?? 0, tiers: data?.repurchaseTiers ?? [] },
    { label: '首单成功率', unit: '%', score: newScore, value: data?.newRate ?? 0, tiers: data?.firstSuccessTiers ?? [] },
  ];
  const tierGapText =
    data?.tier === 'TOP'
      ? '已是最高段位（上等马）'
      : data?.tier === 'MIDDLE'
        ? `距上等马还差 ${Math.max(0, excellentThreshold - myScore)} 分（上等马线 ${excellentThreshold} 分）`
        : `距中等马还差 ${Math.max(0, middleTierThreshold - myScore)} 分；再往上等马还差 ${Math.max(0, excellentThreshold - myScore)} 分`;

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={640} title="🏆 综合评分说明">
      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : (
        <div style={{ lineHeight: 1.9 }}>
          {data && (
            <Alert
              style={{ marginBottom: 16 }}
              type={data.isExcellent ? 'success' : 'info'}
              showIcon
              message={
                <Space>
                  <span>我的综合分：<b>{data.rankScore ?? 0}</b> 分</span>
              <Tag color={tier.color} style={{ fontSize: 14, padding: '2px 10px' }}><TierHorseIcon tier={(data?.tier || 'MIDDLE') as 'TOP' | 'MIDDLE' | 'LOW'} /> {tier.label}</Tag>
                </Space>
              }
              description={data.tier === 'TOP' ? '已达上等马，享受全部抢单权益' : tierGapText}
            />
          )}

          {delta && (
            <div style={{ marginBottom: 16 }}>
              {!delta.hasBaseline ? (
                <Alert
                  type="info"
                  showIcon
                  message="今天是第一次记录积分，从明天开始这里会显示每天加了多少分、扣了多少分。"
                />
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', background: '#F8FAFC' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text strong>今天的变化</Text>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 18,
                        color: delta.delta > 0 ? '#3f8600' : delta.delta < 0 ? '#cf1322' : '#8c8c8c',
                      }}
                    >
                      {delta.delta > 0 ? '+' : ''}{delta.delta} 分
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                    昨天 {delta.prevTotal ?? '-'} 分 → 现在 {delta.total} 分
                    {delta.baselineDate ? `（基准：${delta.baselineDate}）` : ''}
                    {delta.tierChanged ? ` · 段位：${(TIER[delta.prevTier || 'MIDDLE'] || tier).label} → ${tier.label}` : ''}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {delta.items.filter((it) => it.delta !== 0).length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>各项分数跟昨天一样，没有加减。</Text>
                    ) : (
                      delta.items
                        .filter((it) => it.delta !== 0)
                        .map((it) => (
                          <div
                            key={it.key}
                            style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0', color: '#475569' }}
                          >
                            <span>
                              {it.label}
                              {it.key === 'bonus' ? '' : `（${it.prevValue}${it.unit} → ${it.value}${it.unit}）`}
                            </span>
                            <span style={{ fontWeight: 700, color: it.delta > 0 ? '#3f8600' : '#cf1322' }}>
                              {it.delta > 0 ? '+' : ''}{it.delta} 分 → 现在 {it.now} 分
                            </span>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <Title level={5} style={{ marginTop: 0 }}>评分怎么算（每一项取达到的最高一档，不叠加）</Title>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="月流水">
              {data?.revenueScore ?? 0} 分
            </Descriptions.Item>
            <Descriptions.Item label={`续单率 ${data?.renewRate ?? 0}%`}>
              {renewScore} 分
            </Descriptions.Item>
            <Descriptions.Item label={`复购率 ${data?.repurchaseRate ?? 0}%`}>
              {repurchaseScore} 分
            </Descriptions.Item>
            <Descriptions.Item label={`首单成功率 ${data?.newRate ?? 0}%`}>
              {newScore} 分
            </Descriptions.Item>
            <Descriptions.Item label="战绩图加分">
              +{data?.bonusScore ?? 0} 分（每采纳一组 +1 分）
            </Descriptions.Item>
          </Descriptions>

          <Title level={5} style={{ marginTop: 20 }}>加分规则（每一项取达到的最高一档，不叠加）</Title>
          {dims.map((d) => {
            const sortedDesc = [...d.tiers].sort((a, b) => b.min - a.min);
            const next = [...d.tiers].sort((a, b) => a.min - b.min).find((t) => t.min > d.value);
            return (
              <div key={d.label} style={{ marginBottom: 14 }}>
                <Space size={8} wrap>
                  <Text strong>{d.label}</Text>
                  <Text type="secondary">
                    现在 {d.value}{d.unit} → <Text strong>{d.score} 分</Text>
                  </Text>
                  {next ? (
                    <Tag color="blue">
                      再 {Math.ceil(next.min - d.value)}{d.unit} 就到 {next.score} 分
                    </Tag>
                  ) : (
                    <Tag color="green">已是最高一档</Tag>
                  )}
                </Space>
                <div style={{ marginTop: 6 }}>
                  {sortedDesc.map((t, i) => {
                    const reached = d.value >= t.min;
                    const isCurrent = reached && !sortedDesc.some((o) => o.min > t.min && d.value >= o.min);
                    return (
                      <Tag
                        key={i}
                        color={isCurrent ? 'gold' : reached ? 'green' : 'default'}
                        style={{ marginBottom: 4, fontWeight: isCurrent ? 600 : 400 }}
                      >
                        {isCurrent ? '⭐ ' : ''}达到 {t.min}{d.unit} → {t.score} 分
                      </Tag>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            战绩图加分：每采纳一组 +{data?.battleScreenshotBonus ?? 1} 分（管理端审核通过才加，直接叠加在综合分上）。
          </Text>

          <Title level={5} style={{ marginTop: 20 }}>三个段位 & 上等马权益</Title>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li><TierHorseIcon tier="TOP" /> 上等马（≥ {excellentThreshold} 分）：享受下面全部权益。</li>
            <li>🐎 中等马（{middleTierThreshold}~{Math.max(middleTierThreshold, excellentThreshold - 1)} 分）：一般权益。</li>
            <li>🐴 下等马（&lt; {middleTierThreshold} 分）：需加油提升。</li>
          </ul>
          <Title level={5} style={{ marginTop: 16 }}>上等马好处</Title>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li>新订单 <b>0 秒</b>就能看到（其他段位要等）。</li>
            <li>新客首单 <b>名额更多</b>（按段位配置）。</li>
            <li>「立即打」急单会 <b>优先推送</b>给你。</li>
            <li>客服派单时，快结束的陪玩列表里你排前面。</li>
          </ul>

          <Alert style={{ marginTop: 20 }} type="info" showIcon message="怎么快速加分？" description={`综合分 = 月流水 + 续单率 + 复购率 + 首单成功率 + 战绩图加分。每一项只取你达到的最高一档的分（不叠加）：比如流水到 6000 那一档是 20 分、到 10000 那一档是 40 分，那你流水过万这一项就是 40 分。综合分达到 ${excellentThreshold} 分即进入上等马。多上传高光战绩图（每采纳一组 +1 分）也能加分。`} />
        </div>
      )}
    </Modal>
  );
};

export default ExcellenceRuleModal;
