// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { Button, Card, Input, Space, Tabs, Typography } from 'antd';
import { message } from '../utils/feedback';
import http from '../api/client';

const { Text } = Typography;
const { TextArea } = Input;

const SLOTS = [
  { key: 'companion-home', label: '陪玩端工作台' },
  { key: 'order-pool', label: '抢单池' },
  { key: 'orders', label: '订单管理' },
  { key: 'customers', label: '客户管理' },
  { key: 'billing', label: '报账页面' },
] as const;

/** 店长 / 老板给每个页面单独设置公告栏内容。 */
const AnnouncementSettingsCard: React.FC = () => {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState<string>(SLOTS[0].key);

  useEffect(() => {
    setLoading(true);
    http
      .get('/announcement')
      .then(({ data }: any) => {
        const items = data?.data?.items || {};
        const next: Record<string, string> = {};
        for (const s of SLOTS) next[s.key] = String(items[s.key] || '');
        setTexts(next);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await http.put('/announcement', { slot: active, text: texts[active] || '' });
      message.success(texts[active]?.trim() ? '公告已保存' : '公告已清空');
    } catch (err: any) {
      message.error(err?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      size="small"
      title="公告栏（每个页面单独设置）"
      style={{ marginBottom: 16 }}
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          每个页面一份公告，只在自己页面顶部红字滚动显示；最多 500 字。
        </Text>
        <Tabs
          activeKey={active}
          onChange={setActive}
          items={SLOTS.map((s) => ({
            key: s.key,
            label: s.label,
            children: (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <TextArea
                  rows={3}
                  maxLength={500}
                  showCount
                  disabled={loading}
                  value={texts[s.key] || ''}
                  placeholder={`设置「${s.label}」的公告内容；留空则不显示`}
                  onChange={(e) =>
                    setTexts((prev) => ({ ...prev, [s.key]: e.target.value }))
                  }
                />
                <Button type="primary" size="small" loading={saving && active === s.key} onClick={save}>
                  保存当前页面公告
                </Button>
              </Space>
            ),
          }))}
        />
      </Space>
    </Card>
  );
};

export default AnnouncementSettingsCard;
