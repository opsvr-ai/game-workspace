import React, { useEffect, useState } from 'react';
import { Button, Card, Form, Input, message, Typography } from 'antd';
import { configApi } from '../../api/config';

const KEYS = ['turn.url', 'turn.username', 'turn.credential'];

const VoiceSettings: React.FC = () => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    configApi.get(KEYS).then(({ data }) => form.setFieldsValue(data.data || {}));
  }, [form]);

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await configApi.update(values);
      message.success('已保存');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card size="small">
      <Typography.Title level={5} style={{ marginTop: 0 }}>语音通话 TURN 服务器（跨网中转）</Typography.Title>
      <Typography.Text type="secondary">
        本地局域网内通话不需要 TURN；如果陪玩和客服不在同一个网络（跨网/外网），需要填一台 TURN 服务器做中转。买了服务器后把地址、账号、密码填这里即可。
      </Typography.Text>
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item name="turn.url" label="TURN 地址（形如 turn:你的域名:3478）">
          <Input placeholder="turn:your-server.com:3478" />
        </Form.Item>
        <Form.Item name="turn.username" label="TURN 账号">
          <Input placeholder="账号（留空则不填）" />
        </Form.Item>
        <Form.Item name="turn.credential" label="TURN 密码">
          <Input placeholder="密码（留空则不填）" />
        </Form.Item>
        <Button type="primary" loading={saving} onClick={save}>保存 TURN 配置</Button>
      </Form>
    </Card>
  );
};

export default VoiceSettings;
