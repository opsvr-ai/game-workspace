// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Modal, Spin, Tag, Descriptions, Alert, Space, Typography } from 'antd';
import { CrownOutlined } from '@ant-design/icons';
import http from '../api/client';

const { Text, Title } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Excellence {
  rankScore?: number;
  revenueScore?: number;
  bonusScore?: number;
  renewRate?: number;
  repurchaseRate?: number;
  newRate?: number;
  isExcellent?: boolean;
}

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

  const renewScore = Math.round((data?.renewRate ?? 0) * 0.2);
  const repurchaseScore = Math.round((data?.repurchaseRate ?? 0) * 0.2);
  const newScore = Math.round((data?.newRate ?? 0) * 0.1);

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
                  {data.isExcellent && <CrownOutlined style={{ color: '#FAAD14' }} />}
                  <span>我的综合分：<b>{data.rankScore ?? 0}</b> 分</span>
                  <Tag color={data.isExcellent ? 'gold' : 'default'}>{data.isExcellent ? '⭐ 优秀' : '普通'}</Tag>
                </Space>
              }
              description={data.isExcellent ? '已达优秀线（50 分），享受优秀陪玩权益' : `还差 ${Math.max(0, 50 - (data.rankScore ?? 0))} 分达到优秀线（50 分）`}
            />
          )}

          <Title level={5} style={{ marginTop: 0 }}>评分怎么算（满分 100，可被战绩图加分突破）</Title>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="月流水（满分 50）">
              {data?.revenueScore ?? 0} 分（月流水 ¥{(data?.revenueScore ?? 0) * 200} / 10000）
            </Descriptions.Item>
            <Descriptions.Item label="续单率（满分 20）">
              {renewScore} 分（续单率 {data?.renewRate ?? 0}%）
            </Descriptions.Item>
            <Descriptions.Item label="复购率（满分 20）">
              {repurchaseScore} 分（复购率 {data?.repurchaseRate ?? 0}%）
            </Descriptions.Item>
            <Descriptions.Item label="首单成功率（满分 10）">
              {newScore} 分（成功率 {data?.newRate ?? 0}%）
            </Descriptions.Item>
            <Descriptions.Item label="战绩图加分（无上限）">
              +{data?.bonusScore ?? 0} 分（每采纳一组 +1 分）
            </Descriptions.Item>
          </Descriptions>

          <Title level={5} style={{ marginTop: 20 }}>优秀线 = 50 分，达到后有哪些好处？</Title>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li>新订单 <b>0 秒</b>就能看到（普通陪玩要等 60 秒）。</li>
            <li>新客首单 <b>不限名额</b>（普通陪玩每天只能抢 1 个新客）。</li>
            <li>「立即打」急单会 <b>优先推送</b>给你。</li>
            <li>客服派单时，快结束的陪玩列表里你排前面。</li>
          </ul>

          <Alert style={{ marginTop: 20 }} type="info" showIcon message="怎么快速加分？" description="多上传你的高光战绩图（最少 3 张一组），管理端采纳后每组 +1 分；同时把续单/复购率做上去，月流水冲到 10000 元。综合分达到 50 分即进入优秀。" />
        </div>
      )}
    </Modal>
  );
};

export default ExcellenceRuleModal;
