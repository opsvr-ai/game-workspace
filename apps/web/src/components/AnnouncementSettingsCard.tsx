// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Button, Card, Input, Space, Typography } from 'antd';
import { message } from '../utils/feedback';
import http from '../api/client';

const { Text } = Typography;
const { TextArea } = Input;

/** 店长 / 老板设置公告栏内容；陪玩端 + 管理端顶部红字滚动。 */
const AnnouncementSettingsCard: React.FC = () => {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    http
      .get('/announcement')
      .then(({ data }: any) => setText(String(data?.data?.text || '')))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await http.put('/announcement', { text });
      message.success(text.trim() ? '公告已保存' : '公告已清空');
    } catch (err: any) {
      message.error(err?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card size="small" title="公告栏" style={{ marginBottom: 16 }}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          保存后，陪玩端工作台、抢单池、订单管理、客户管理、报账页面顶部都会红字滚动显示（最多 500 字）。
        </Text>
        <TextArea
          rows={3}
          maxLength={500}
          showCount
          value={text}
          disabled={loading}
          placeholder="例如：今晚 24 点前完成报账，逾期顺延到下一批"
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="primary" size="small" loading={saving} onClick={save}>
          保存公告
        </Button>
      </Space>
    </Card>
  );
};

export default AnnouncementSettingsCard;
