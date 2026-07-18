// craftsman-ignore: TS001,TS002
import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, InputNumber, message } from 'antd';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import { DispatchType } from '@chunlv/shared';

const { Option } = Select;

const orderTypeConfig: Record<string,string> = { NEW:'首单', RENEW:'续单', REPURCHASE:'复购' };
const gameList = ['王者荣耀','三角洲行动','英雄联盟','永劫无间','无畏契约','CS2','绝地求生'];

interface Props { open: boolean; onClose: () => void; onCreated: () => void; userId?: string; customerPreFill?: { customerId?: string; customerWechat?: string; gameName?: string; amount?: number; companionId?: string; dispatchType?: string; notes?: string; }; }

const CreateOrderModal: React.FC<Props> = ({ open, onClose, onCreated, userId, customerPreFill }) => {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [companions, setCompanions] = useState<any[]>([]);

  useEffect(() => {
    if (open) companionsApi.list().then(({data}:any) => setCompanions(data.data||[])).catch(()=>{});
  }, [open]);

  useEffect(() => {
    if (open && customerPreFill) {
      form.setFieldsValue({
        type: 'NEW', gameName: customerPreFill.gameName || '三角洲行动',
        dispatchType: customerPreFill.dispatchType || DispatchType.DIRECT, urgency: 'now', billingMode: 'hour', duration: 1, companionId: customerPreFill.companionId || undefined,
        
        customerId: customerPreFill.customerId, customerWechat: customerPreFill.customerWechat,
        amount: customerPreFill.amount || 0,
        deltaNote: customerPreFill.notes || '',
      });
    }
  }, [open, customerPreFill, form]);

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
      <Form form={form} layout="vertical" style={{ marginTop: 8 }} size="small" initialValues={{ type:'NEW', gameName:'三角洲行动', dispatchType:DispatchType.POOL, urgency:'now', billingMode:'hour', duration:1, serviceType:'PLAY_WITH', customerSource:'小红书' }}>
        <Form.Item name="type" label="订单类型" initialValue="NEW" rules={[{ required: true }]}>
          <Select>{Object.entries(orderTypeConfig).map(([k,v]) => <Option key={k} value={k}>{v}</Option>)}</Select></Form.Item>
        <Form.Item name="gameName" label="游戏名称" rules={[{ required: true }]}>
          <Select showSearch>{gameList.map(g => <Option key={g} value={g}>{g}</Option>)}</Select></Form.Item>
        <Form.Item name="serviceType" label="服务类型" initialValue="PLAY_WITH">
          <Select>
            <Option value="PLAY_WITH">陪玩</Option>
            <Option value="ESCORT">护航</Option>
            <Option value="DO_TASK">做任务</Option>
          </Select>
        </Form.Item>
        <Form.Item name="deltaMission" label="任务类型"><Select placeholder="可选" allowClear><Option value="机密">机密</Option><Option value="绝密">绝密</Option></Select></Form.Item>
        <Form.Item name="deltaCount" label="陪陪数量" initialValue="单"><Select><Option value="单">单</Option><Option value="双">双</Option></Select></Form.Item>
        <Form.Item name="deltaNote" label="备注"><Input.TextArea rows={2} placeholder="补充说明" /></Form.Item>
        <Form.Item name="amount" label="金额" rules={[{ required: true }]}>
          <InputNumber min={0} style={{ width: '100%' }} placeholder="单价" prefix="¥" /></Form.Item>
        <Form.Item name="dispatchType" label="派单方式" initialValue={DispatchType.POOL} rules={[{ required: true }]}>
          <Select><Option value={DispatchType.POOL}>入池抢单</Option><Option value={DispatchType.DIRECT}>指定陪玩</Option><Option value="BROADCAST">📢 群发</Option></Select></Form.Item>
        <Form.Item noStyle shouldUpdate={(p,c) => p.dispatchType !== c.dispatchType}>
          {({ getFieldValue }) => getFieldValue('dispatchType') === DispatchType.DIRECT ? (<>
            <Form.Item name="companionId" label="指定陪玩" rules={[{ required: true }]}>
              <Select placeholder="选择陪玩" showSearch optionFilterProp="label">
                {companions.filter((c:any) => c.status !== 'OFFLINE' && c.status !== 'RESTING').map((c:any) => (
                  <Option key={c.id} value={c.id} label={c.user?.username}>{c.user?.username ?? c.id}</Option>))}
              </Select></Form.Item>
            <Form.Item noStyle shouldUpdate={(p,c) => p.deltaCount !== c.deltaCount}>
              {({ getFieldValue: getV }) => getV('deltaCount') === '双' ? (
                <Form.Item name="coCompanionId" label="协同陪玩" rules={[{ required: true, message: '请选择协同陪玩' }]}>
                  <Select placeholder="选择协同陪玩" showSearch optionFilterProp="label" allowClear>
                    {companions.filter((c:any) => c.status !== 'OFFLINE' && c.status !== 'RESTING').map((c:any) => (
                      <Option key={c.id} value={c.id} label={c.user?.username}>{c.user?.username ?? c.id}</Option>))}
                  </Select></Form.Item>) : null}
            </Form.Item>
          </>) : null}
        </Form.Item>
        <Form.Item name="urgency" label="打单时间" initialValue="now">
          <Select><Option value="now">⚡立即打</Option><Option value="later">📅预约</Option></Select></Form.Item>
        <Form.Item label="客户来源" required>
          <Input.Group compact>
            <Form.Item name="customerSource" noStyle rules={[{ required: true, message: '请选择客户来源' }]}>
              <Select placeholder="来源" style={{ width: '35%' }}><Option value="小红书">小红书</Option><Option value="抖音">抖音</Option><Option value="快手">快手</Option><Option value="转介绍">转介绍</Option></Select>
            </Form.Item>
            <Form.Item name="customerSourceAccount" noStyle>
              <Input style={{ width: '65%' }} placeholder="来源账号（如小红书ID/抖音号）" />
            </Form.Item>
          </Input.Group>
        </Form.Item>
        <Form.Item label="客户联系方式">
          <Input.Group compact>
            <Form.Item name="customerWechat" noStyle><Input style={{ width: '25%' }} placeholder="微信" /></Form.Item>
            <Form.Item name="customerYy" noStyle><Input style={{ width: '25%' }} placeholder="YY号" /></Form.Item>
            <Form.Item name="customerPlatformAccount" noStyle><Input style={{ width: '25%' }} placeholder="KOOK号" /></Form.Item>
            <Form.Item name="customerRoomCode" noStyle><Input style={{ width: '25%' }} placeholder="房间码" /></Form.Item>
          </Input.Group>
        </Form.Item>
        <Form.Item name="billingMode" label="计费方式" initialValue="hour">
          <Select><Option value="hour">按小时</Option><Option value="round">按局数</Option></Select></Form.Item>
        <Form.Item noStyle shouldUpdate={(p,c) => p.billingMode !== c.billingMode}>
          {({ getFieldValue }) => getFieldValue('billingMode') === 'round' ? (
            <Form.Item name="duration" label="局数"><InputNumber min={1} step={1} style={{ width: '100%' }} /></Form.Item>
          ) : (
            <Form.Item name="duration" label="时长（小时）" initialValue={1}><InputNumber min={0.5} step={0.5} style={{ width: '100%' }} /></Form.Item>
          )}
        </Form.Item>
      </Form>
    </Modal>
  );
};
export default CreateOrderModal;
