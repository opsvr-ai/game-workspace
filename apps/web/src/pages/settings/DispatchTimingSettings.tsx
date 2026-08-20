import React, { useEffect, useState } from 'react';
import { Button, Card, Form, InputNumber, message, Typography } from 'antd';
import { configApi } from '../../api/config';

const KEYS = ['pool.priority_delay_seconds', 'pool.bridge_delay_seconds', 'pool.middle_delay_seconds', 'pool.low_delay_seconds', 'pool.online_delay_seconds', 'pool.immediate_disappear_minutes', 'pool.scheduled_disappear_minutes'];

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
      <Typography.Text type="secondary">上等马立即看到，其次桥接工作室，再依次中等马、下等马，线上俱乐部最后看到。</Typography.Text>
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item name="pool.priority_delay_seconds" label="上等马等待（秒）"><InputNumber min={0} /></Form.Item>
        <Form.Item name="pool.bridge_delay_seconds" label="桥接工作室等待（秒）"><InputNumber min={0} /></Form.Item>
        <Form.Item name="pool.middle_delay_seconds" label="中等马等待（秒）"><InputNumber min={0} /></Form.Item>
        <Form.Item name="pool.low_delay_seconds" label="下等马等待（秒）"><InputNumber min={0} /></Form.Item>
        <Form.Item name="pool.online_delay_seconds" label="线上俱乐部等待（秒）"><InputNumber min={0} /></Form.Item>
        <Form.Item name="pool.immediate_disappear_minutes" label="立即打订单消失时间（分钟）"><InputNumber min={0} /></Form.Item>
        <Form.Item name="pool.scheduled_disappear_minutes" label="预约订单消失时间（分钟）"><InputNumber min={0} /></Form.Item>
        <Button type="primary" loading={saving} onClick={save}>保存等待时间</Button>
      </Form>
    </Card>
  );
};

export default DispatchTimingSettings;
