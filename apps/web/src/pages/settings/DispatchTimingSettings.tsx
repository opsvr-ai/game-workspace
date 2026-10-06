import React, { useEffect, useState } from 'react';
import { Button, Card, Form, InputNumber, Typography } from 'antd';
import { message } from '../../utils/feedback';
import { configApi } from '../../api/config';

const KEYS = ['pool.priority_delay_seconds', 'pool.bridge_delay_seconds', 'pool.middle_delay_seconds', 'pool.low_delay_seconds', 'pool.online_delay_seconds', 'pool.immediate_disappear_minutes', 'pool.scheduled_disappear_minutes', 'pool.online_first_release_minutes', 'pool.offline_first_bridge_minutes'];

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
        <Form.Item name="pool.priority_delay_seconds" label="上等马等待"><InputNumber min={0} suffix="秒" /></Form.Item>
        <Form.Item name="pool.bridge_delay_seconds" label="桥接工作室等待"><InputNumber min={0} suffix="秒" /></Form.Item>
        <Form.Item name="pool.middle_delay_seconds" label="中等马等待"><InputNumber min={0} suffix="秒" /></Form.Item>
        <Form.Item name="pool.low_delay_seconds" label="下等马等待"><InputNumber min={0} suffix="秒" /></Form.Item>
        <Form.Item name="pool.online_delay_seconds" label="线上俱乐部等待"><InputNumber min={0} suffix="秒" /></Form.Item>
        <Form.Item name="pool.immediate_disappear_minutes" label="立即打订单消失时间"><InputNumber min={0} suffix="分钟" /></Form.Item>
        <Form.Item name="pool.scheduled_disappear_minutes" label="预约订单消失时间"><InputNumber min={0} suffix="分钟" /></Form.Item>
        <Form.Item
          name="pool.online_first_release_minutes"
          label="「线上→线下流转」线上先看多久、没人接才放给本店线下"
        >
          <InputNumber min={1} suffix="分钟" />
        </Form.Item>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          「线上→线下流转」的单：桥接工作室 + 线上俱乐部秒看到，没人接的话过了这个时间就自动放进本店线下陪玩的池子
          （客服也可以随时手动放给线下）。
        </Typography.Text>
        <Form.Item
          name="pool.offline_first_bridge_minutes"
          label="「线下→线上流转」本店线下先抢多久、才轮到桥接 / 线上"
        >
          <InputNumber min={0} suffix="分钟" />
        </Form.Item>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          「线下→线上流转」的单：本店线下陪玩先抢这么多分钟，没人接才轮到桥接工作室 / 线上俱乐部
          （过了这个时间两边同时看得到，桥接没人接线上马上能接）。
        </Typography.Text>
        <Button type="primary" loading={saving} onClick={save}>保存等待时间</Button>
      </Form>
    </Card>
  );
};

export default DispatchTimingSettings;
