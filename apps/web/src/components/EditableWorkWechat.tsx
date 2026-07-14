import React, { useState } from 'react';
import { Tag, Select, Typography } from 'antd';

const { Text } = Typography;

const EditableWorkWechat: React.FC<{ order: any }> = ({ order }) => {
  const [editing, setEditing] = useState(false);
  const [wxs, setWxs] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const wo = order.customFields || {};

  const startEdit = async () => {
    try {
      const http = (await import('../api/client')).default;
      const { data } = await http.get('/companions/work-wechats');
      setWxs(data?.data || []);
    } catch { setWxs([]); }
    setEditing(true);
  };

  if (editing) {
    return (
      <Select
        autoFocus
        showSearch
        size="small"
        loading={saving}
        placeholder="选择微信"
        style={{ width: 130 }}
        onBlur={() => setEditing(false)}
        onChange={async (wid: string) => {
          setSaving(true);
          const wx = wxs.find((w: any) => w.id === wid);
          try {
            const http = (await import('../api/client')).default;
            await http.put(`/orders/${order.id}/contact`, { workWechatId: wid, workWechatName: wx?.wechatId || '' });
          } catch {}
          setSaving(false);
          setEditing(false);
        }}
      >
        {wxs.map((w: any) => <Select.Option key={w.id} value={w.id}>{w.wechatId}</Select.Option>)}
      </Select>
    );
  }

  if (wo.workWechatName) return <Tag color="cyan" style={{ fontSize: 11, margin: 0, cursor: 'pointer' }} onClick={startEdit}>📱{wo.workWechatName}</Tag>;
  if (wo.workWechatId) return <Tag color="cyan" style={{ fontSize: 11, margin: 0, cursor: 'pointer' }} onClick={startEdit}>📱{String(wo.workWechatId).slice(0, 8)}</Tag>;
  return <Text type="secondary" style={{ fontSize: 11, cursor: 'pointer' }} onClick={startEdit}>点击选择</Text>;
};

export default EditableWorkWechat;
