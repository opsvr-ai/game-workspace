import React, { useEffect, useState } from 'react';
import { Button, Card, Form, InputNumber, message, Typography } from 'antd';
import { configApi } from '../../api/config';

const KEYS = ['pool.priority_delay_seconds', 'pool.offline_delay_seconds', 'pool.bridge_delay_seconds', 'pool.online_delay_seconds'];

const DispatchTimingSettings: React.FC = () => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    configApi.get(KEYS).then(({ data }) => form.setFieldsValue(data.data || {}));
  }, []);

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
      <Typography.Title level={5} style={{ marginTop: 0 }}>按照陪玩等级看到订单等待时间</Typography.Title>
      <Typography.Text type="secondary">优秀陪玩立即看到，其他线下陪玩等待后可看到，桥接工作室最后看到。</Typography.Text>
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item name="pool.priority_delay_seconds" label="优秀陪玩等待（秒）"><InputNumber min={0} /></Form.Item>
        <Form.Item name="pool.offline_delay_seconds" label="其他线下陪玩等待（秒）"><InputNumber min={0} /></Form.Item>
        <Form.Item name="pool.bridge_delay_seconds" label="桥接工作室等待（秒）"><InputNumber min={0} /></Form.Item>
        <Form.Item name="pool.online_delay_seconds" label="线上俱乐部等待（秒）"><InputNumber min={0} /></Form.Item>
        <Button type="primary" loading={saving} onClick={save}>保存等待时间</Button>
      </Form>
    </Card>
  );
};

export default DispatchTimingSettings;
