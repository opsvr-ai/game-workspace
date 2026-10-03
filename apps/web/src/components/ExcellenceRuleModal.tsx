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
}

const TIER: Record<string, { label: string; color: string; emoji: string }> = {
  TOP: { label: '上等马', color: '#D4A017', emoji: '👑🏇' },
  MIDDLE: { label: '中等马', color: '#A9A9A9', emoji: '🐎' },
  LOW: { label: '下等马', color: '#CD7F32', emoji: '🐴' },
};

const ExcellenceRuleModal: React.FC<Props> = ({ open, onClose }) => {
  const [data, setData] = useState<Excellence | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    http
      .get('/companions/me/excellence')
      .then(({ data }: any) => setData(data?.data ?? null))
      .catch(() => setData(null))
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

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={640} title="🏆 综合评分说明">
      {loading ? (
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
              description={data.tier === 'TOP'
                ? '已达上等马，享受全部抢单权益'
                : `还差 ${Math.max(0, excellentThreshold - (data.rankScore ?? 0))} 分达到上等马（${excellentThreshold} 分）`}
            />
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
