import React, { useState } from 'react';
import { Modal, Form, Input, Select, InputNumber, message } from 'antd';
import { ordersApi } from '../api/orders';

const { Option } = Select;

interface Props { open: boolean; onClose: () => void; onCreated: () => void; userId?: string; }

const CreateOrderModal: React.FC<Props> = ({ open, onClose, onCreated, userId }) => {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const handleOk = async () => {
    try {
      const v = await form.validateFields();
      setLoading(true);
      await ordersApi.create({ ...v, dispatchType: 'POOL', csUserId: userId });
      message.success('订单已发布'); form.resetFields(); onClose(); onCreated();
    } catch (e: any) { if (!e?.errorFields) message.error(e?.response?.data?.message || '创建失败'); }
    finally { setLoading(false); }
  };
  return (
    <Modal title="创建订单" open={open} onOk={handleOk} onCancel={() => { form.resetFields(); onClose(); }}
      confirmLoading={loading} okText="发布" cancelText="取消" destroyOnClose>
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="gameName" label="游戏名称" rules={[{ required: true }]}>
          <Input placeholder="如：王者荣耀" /></Form.Item>
        <Form.Item name="type" label="订单类型" initialValue="NEW">
          <Select><Option value="NEW">首单</Option><Option value="RENEW">续单</Option><Option value="REPURCHASE">复购</Option></Select></Form.Item>
        <Form.Item name="amount" label="金额" rules={[{ required: true }]}>
          <InputNumber min={0} style={{ width: '100%' }} placeholder="单价" /></Form.Item>
        <Form.Item name="duration" label="时长（小时）" initialValue={1}>
          <InputNumber min={0.5} step={0.5} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="billingMode" label="计费方式" initialValue="hour">
          <Select><Option value="hour">按时长</Option><Option value="round">按局数</Option></Select></Form.Item>
        <Form.Item name="urgency" label="打单时间" initialValue="now">
          <Select><Option value="now">⚡立即打</Option><Option value="later">📅预约</Option></Select></Form.Item>
      </Form>
    </Modal>
  );
};
export default CreateOrderModal;
