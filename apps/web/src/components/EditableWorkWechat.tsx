// craftsman-ignore: TS001,TS002
import React, { memo, useState } from 'react';
import { Tag, Select, Typography } from 'antd';

const { Text } = Typography;

const EditableWorkWechat: React.FC<{ order: any; onSaved?: (workWechatId: string, workWechatName: string) => void }> = ({ order, onSaved }) => {
  const [editing, setEditing] = useState(false);
  const [wxs, setWxs] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  // Local display state — survives prop staleness after save
  const [savedName, setSavedName] = useState<string | null>(null);
  const wo = order.customFields || {};
  const displayName = savedName ?? wo.workWechatName ?? (wo.workWechatId ? String(wo.workWechatId).slice(0, 8) : null);

  const startEdit = async () => {
    try {
      const http = (await import('../api/client')).default;
      const { data } = await http.get('/companions/work-wechats');
      setWxs(data?.data || []);
    } catch {
      setWxs([]);
    }
    setEditing(true);
  };

  if (editing) {
    return (
      <Select
        autoFocus
        size="small"
        loading={saving}
        placeholder="选择微信"
        style={{ width: 130 }}
        onBlur={() => setEditing(false)}
        onChange={async (wid: string) => {
          setSaving(true);
          const wx = wxs.find((w: any) => w.id === wid);
          const name = wx?.wechatId || '';
          try {
            const http = (await import('../api/client')).default;
            await http.put(`/orders/${order.id}/contact`, { workWechatId: wid, workWechatName: name });
            setSavedName(name);
            onSaved?.(wid, name);
          } catch {}
          setSaving(false);
          setEditing(false);
        }}
      >
        {wxs.filter((w: any) => w.type === 'COMPANION').map((w: any) => (
          <Select.Option key={w.id} value={w.id}>
            {w.wechatId}
          </Select.Option>
        ))}
      </Select>
    );
  }

  if (displayName)
    return (
      <Tag color="cyan" style={{ fontSize: 11, margin: 0, cursor: 'pointer' }} onClick={startEdit}>
        📱{displayName}
      </Tag>
    );
  return (
    <Text type="secondary" style={{ fontSize: 11, cursor: 'pointer' }} onClick={startEdit}>
      点击选择
    </Text>
  );
};

export default memo(EditableWorkWechat);
