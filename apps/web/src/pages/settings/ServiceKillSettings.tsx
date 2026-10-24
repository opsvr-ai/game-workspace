import React, { useEffect, useState } from 'react';
import { Button, Card, Form, InputNumber, Typography } from 'antd';
import { message } from '../../utils/feedback';
import { configApi } from '../../api/config';

const KEYS = ['service.auto_end_after_reminder_minutes', 'service.end_buffer_minutes'];

/**
 * 服务计时/杀进程：和「派单等待时间」无关，单独一页。
 * 老板 2026-10-25 明确叫法：
 *  - 弹窗提醒 x 分钟后杀进程
 *  - 杀黑名单 x 分钟缓冲
 */
const ServiceKillSettings: React.FC = () => {
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
      <Typography.Title level={5} style={{ marginTop: 0 }}>弹窗提醒 / 杀进程 / 黑名单缓冲</Typography.Title>
      <Typography.Text type="secondary">
        到点先弹提醒；到时间还没结束/续单，服务端自动结束并进入缓冲，缓冲结束才回空闲并触发黑名单。
      </Typography.Text>
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item
          name="service.auto_end_after_reminder_minutes"
          label="弹窗提醒后多少分钟杀进程"
          tooltip="到点先弹提醒；超过这个分钟数仍没点结束/续单/复购，自动结束这一段"
        >
          <InputNumber min={1} max={180} suffix="分钟" style={{ width: 220 }} />
        </Form.Item>
        <Form.Item
          name="service.end_buffer_minutes"
          label="杀黑名单前缓冲多少分钟"
          tooltip="结束服务后先保持接单中，不立刻触发空闲黑名单；给陪玩切模式/回游戏的时间"
        >
          <InputNumber min={0} max={30} suffix="分钟" style={{ width: 220 }} />
        </Form.Item>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          默认：弹窗提醒后 20 分钟杀进程；杀黑名单前缓冲 3 分钟。
        </Typography.Text>
        <Button type="primary" loading={saving} onClick={save}>保存</Button>
      </Form>
    </Card>
  );
};

export default ServiceKillSettings;
