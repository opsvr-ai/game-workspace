// craftsman-ignore: TS001,TS002,TS003
import React, { useEffect, useState } from 'react';
import { Drawer, List, Tag, DatePicker, Empty, Spin, Image, Descriptions, Space, Typography } from 'antd';
import { monitorApi } from '../api/monitor';

const { Text, Title } = Typography;

interface WorkRecord {
  id: string;
  claimedMode?: string;
  claimedPrice?: number;
  transferScreenshotUrl?: string;
  flagged?: string | null;
  compositeUrl?: string | null;
  shotCount?: number;
  duration: number;
  startedAt?: string;
  endedAt?: string;
  parentOrder?: { customer?: { customerCode?: string }; amount?: number; gameName?: string };
}

interface Props {
  open: boolean;
  companionId: string | null;
  companionName?: string;
  onClose: () => void;
}

const WorkRecordsDrawer: React.FC<Props> = ({ open, companionId, companionName, onClose }) => {
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !companionId) return;
    setLoading(true);
    monitorApi
      .workRecords(companionId, date || undefined)
      .then((r: any) => setRecords(r.data?.data || []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [open, companionId, date]);

  return (
    <Drawer
      title={`工作记录 — ${companionName || companionId || ''}`}
      width={720}
      open={open}
      onClose={onClose}
    >
      <Space style={{ marginBottom: 12 }}>
        <Text>日期：</Text>
        <DatePicker onChange={(d) => setDate(d ? d.format('YYYY-MM-DD') : null)} />
      </Space>

      <Spin spinning={loading}>
        {records.length === 0 && !loading ? (
          <Empty description="该日无工作记录" />
        ) : (
          <List
            dataSource={records}
            renderItem={(r) => (
              <List.Item key={r.id} style={{ display: 'block' }}>
                <Space wrap style={{ marginBottom: 8 }}>
                  <Tag color={r.flagged === 'red' ? 'red' : r.flagged === 'yellow' ? 'gold' : 'default'}>
                    {r.flagged === 'red' ? '🔴 异常' : r.flagged === 'yellow' ? '🟡 可疑' : '正常'}
                  </Tag>
                  {r.shotCount === 0 && <Tag color="red">无工作记录</Tag>}
                  <Text strong>{r.parentOrder?.gameName}</Text>
                  <Text type="secondary">客户 {r.parentOrder?.customer?.customerCode || '未知'}</Text>
                  <Text type="secondary">
                    {r.startedAt ? new Date(r.startedAt).toLocaleString('zh-CN') : ''} 起
                  </Text>
                </Space>
                <Descriptions size="small" column={3} style={{ marginBottom: 8 }}>
                  <Descriptions.Item label="口供模式">{r.claimedMode || '-'}</Descriptions.Item>
                  <Descriptions.Item label="口供单价">{r.claimedPrice != null ? `${r.claimedPrice}元/h` : '-'}</Descriptions.Item>
                  <Descriptions.Item label="时长">{r.duration}h</Descriptions.Item>
                </Descriptions>
                {r.compositeUrl ? (
                  <Image
                    src={r.compositeUrl}
                    alt="合并长图"
                    style={{ maxWidth: '100%' }}
                  />
                ) : (
                  <Text type="secondary">暂无合并长图（服务未结束时无截图）</Text>
                )}
              </List.Item>
            )}
          />
        )}
      </Spin>
    </Drawer>
  );
};

export default WorkRecordsDrawer;
