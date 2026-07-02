import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, InputNumber, message } from 'antd';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import { DispatchType } from '@chunlv/shared';

const { Option } = Select;

interface Props { open: boolean; onClose: () => void; onCreated: () => void; userId?: string; }

const orderTypeConfig: Record<string,string> = { NEW:'首单', RENEW:'续单', REPURCHASE:'复购' };

const CreateOrderModal: React.FC<Props> = ({ open, onClose, onCreated, userId }) => {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [companions, setCompanions] = useState<any[]>([]);

  useEffect(() => { if (open) companionsApi.list().then(({data}:any) => setCompanions(data.data||[])).catch(()=>{}); }, [open]);

  const handleOk = async () => {
    try {
      const v = await form.validateFields();
      setLoading(true);
      await ordersApi.create({ ...v, csUserId: userId });
      message.success('订单已发布'); form.resetFields(); onClose(); onCreated();
    } catch (e: any) { if (!e?.errorFields) message.error(e?.response?.data?.message||'创建失败'); }
    finally { setLoading(false); }
  };

  return (
    <Modal title="创建订单" open={open} onOk={handleOk} onCancel={() => { form.resetFields(); onClose(); }}
      confirmLoading={loading} okText="发布" cancelText="取消" destroyOnClose width={520}>
      <Form form={form} layout="vertical" style={{ marginTop: 16 }} initialValues={{ type:'NEW', dispatchType:DispatchType.POOL, urgency:'now' }}>
        <Form.Item name="type" label="订单类型" rules={[{ required: true }]}>
          <Select>{Object.entries(orderTypeConfig).map(([k,v]) => <Option key={k} value={k}>{v}</Option>)}</Select></Form.Item>
        <Form.Item name="gameName" label="游戏名称" rules={[{ required: true }]}>
          <Select placeholder="选择游戏" showSearch>
            {['王者荣耀','三角洲行动','英雄联盟','永劫无间','无畏契约','CS2','绝地求生'].map(g=><Option key={g} value={g}>{g}</Option>)}
          </Select></Form.Item>
        <Form.Item noStyle shouldUpdate={(p,c) => p.gameName !== c.gameName}>
          {({ getFieldValue }) => getFieldValue('gameName') === '三角洲行动' ? <>
            <Form.Item name="deltaMode" label="模式" initialValue="陪玩">
              <Select><Option value="护航">护航</Option><Option value="陪玩">陪玩</Option></Select></Form.Item>
            <Form.Item name="deltaMission" label="任务类型">
              <Select placeholder="可选" allowClear><Option value="机密">机密</Option><Option value="绝密">绝密</Option></Select></Form.Item>
            <Form.Item name="deltaCount" label="陪陪数量" initialValue="单">
              <Select><Option value="单">单</Option><Option value="双">双</Option></Select></Form.Item>
            <Form.Item name="deltaNote" label="备注"><Input.TextArea rows={2} placeholder="补充说明" /></Form.Item>
          </> : null}
        </Form.Item>
        <Form.Item name="amount" label="金额" rules={[{ required: true }]}>
          <InputNumber min={0} style={{ width: '100%' }} placeholder="单价" prefix="¥" /></Form.Item>
        <Form.Item name="duration" label="时长（小时）" initialValue={1}>
          <InputNumber min={0.5} step={0.5} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="billingMode" label="计费方式" initialValue="hour">
          <Select><Option value="hour">按时长</Option><Option value="round">按局数</Option></Select></Form.Item>
        <Form.Item name="dispatchType" label="派单方式" initialValue={DispatchType.POOL}>
          <Select><Option value={DispatchType.POOL}>入池抢单</Option><Option value={DispatchType.DIRECT}>指定派单</Option></Select></Form.Item>
        <Form.Item noStyle shouldUpdate={(p,c) => p.dispatchType !== c.dispatchType}>
          {({ getFieldValue }) => getFieldValue('dispatchType') === DispatchType.DIRECT ? (
            <Form.Item name="companionId" label="指定陪玩" rules={[{ required: true }]}>
              <Select placeholder="选择陪玩" showSearch optionFilterProp="label">
                {companions.filter((c:any) => c.status !== 'OFFLINE').map((c:any) => (
                  <Option key={c.id} value={c.id} label={c.user?.username}>{c.user?.username ?? c.id}</Option>))}
              </Select></Form.Item>) : null}
        </Form.Item>
        <Form.Item name="urgency" label="打单时间" initialValue="now">
          <Select><Option value="now">⚡立即打</Option><Option value="later">📅预约</Option></Select></Form.Item>
      </Form>
    </Modal>
  );
};
export default CreateOrderModal;
