// craftsman-ignore: TS001,TS002
import React, { memo, useState, useEffect } from 'react';
import { Modal, Form, Input, Select, InputNumber, message, Upload, Button, Checkbox } from 'antd';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import { trafficAccountApi } from '../api/trafficAccount';
import { DispatchType } from '@chunlv/shared';
import http from '../api/client';
import PasteImageBox from './PasteImageBox';

const { Option } = Select;

const orderTypeConfig: Record<string, string> = { NEW: '首单', RENEW: '续单', REPURCHASE: '复购' };
const gameList = ['王者荣耀', '三角洲行动', '英雄联盟', '永劫无间', '无畏契约', 'CS2', '绝地求生', '金铲铲', '三角洲手游', '和平精英'];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  userId?: string;
  directAddMode?: boolean;
  editingOrder?: any;
  initialValues?: any;
  customerPreFill?: {
    customerId?: string;
    customerWechat?: string;
    gameName?: string;
    amount?: number;
    companionId?: string;
    dispatchType?: string;
    notes?: string;
    isCompensation?: boolean;
    type?: string;
  };
}

const CreateOrderModal: React.FC<Props> = ({ open, onClose, onCreated, userId, directAddMode, editingOrder, initialValues, customerPreFill }) => {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [companions, setCompanions] = useState<any[]>([]);
  const [workWechats, setWorkWechats] = useState<any[]>([]);
  const [trafficAccounts, setTrafficAccounts] = useState<any[]>([]);
  const [showInactiveAccounts, setShowInactiveAccounts] = useState(false);
  const [customerWechatQr, setCustomerWechatQr] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (open)
      companionsApi
        .list()
        .then(({ data }: any) => setCompanions(data.data || []))
        .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (open)
      trafficAccountApi
        .list('studio')
        .then(({ data }: any) => setTrafficAccounts(data.data || []))
        .catch(() => setTrafficAccounts([]));
  }, [open]);

  useEffect(() => {
    if (open && directAddMode) {
      companionsApi
        .listWorkWechats()
        .then(({ data }: any) => setWorkWechats(data?.data || []))
        .catch(() => setWorkWechats([]));
    }
  }, [open, directAddMode]);

  useEffect(() => {
    if (open && customerPreFill) {
      form.setFieldsValue({
        type: customerPreFill.type || 'NEW',
        gameName: customerPreFill.gameName || '三角洲行动',
        dispatchType: customerPreFill.dispatchType || DispatchType.DIRECT,
        urgency: 'now',
        billingMode: 'hour',
        duration: 1,
        companionId: customerPreFill.companionId || undefined,

        customerId: customerPreFill.customerId,
        customerWechat: customerPreFill.customerWechat,
        amount: customerPreFill.amount || 0,
        deltaNote: customerPreFill.notes || '',
        isCompensation: customerPreFill.isCompensation || false,
      });
    }
  }, [open, customerPreFill, form]);

  useEffect(() => {
    if (open && initialValues) {
      form.setFieldsValue(initialValues);
      if (initialValues.customerWechatQr) setCustomerWechatQr(initialValues.customerWechatQr);
    }
  }, [open, initialValues, form]);

  useEffect(() => {
    if (!open || !editingOrder) return;
    const cf = editingOrder.customFields || {};
    form.setFieldsValue({
      type: editingOrder.type || 'NEW',
      gameName: editingOrder.gameName || '三角洲行动',
      serviceType: editingOrder.serviceType || cf.serviceType || 'PLAY_WITH',
      deltaMission: cf.deltaMission,
      deltaCount: cf.deltaCount || '单',
      deltaNote: cf.deltaNote,
      amount: editingOrder.amount,
      urgency: cf.urgency || 'now',
      scheduledTimeText: cf.scheduledTimeText,
      customerSource: cf.customerSource,
      customerSourceAccount: cf.customerSourceAccount,
      customerNickname: cf.customerNickname,
      customerAccountId: cf.customerAccountId,
      customerWechat: cf.customerWechat,
      customerYy: cf.customerYy,
      customerPlatformAccount: cf.customerPlatformAccount,
      customerRoomCode: cf.customerRoomCode,
      customerWechatQr: cf.customerWechatQr || '',
      billingMode: cf.billingMode || 'hour',
      duration: editingOrder.duration,
    });
    setCustomerWechatQr(cf.customerWechatQr || '');
  }, [open, editingOrder, form]);

  const uploadCustomerWechatQr = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await http.post('/upload/screenshot', fd);
      const url = res.data?.data?.url || res.data?.url || '';
      setCustomerWechatQr(url);
      form.setFieldsValue({ customerWechatQr: url });
      message.success('二维码已上传');
    } catch {
      message.error('上传失败');
    } finally {
      setUploading(false);
    }
    return false;
  };

  const handleOk = async () => {
    try {
      const v = await form.validateFields();
      setLoading(true);
      const prefill: any = initialValues || {};
      const workWechat = workWechats.find((w: any) => w.id === (v as any).workWechatId);
      const workWechatId = (v as any).workWechatId || prefill.workWechatId || undefined;
      const workWechatName = (v as any).workWechatId ? workWechat?.wechatId : prefill.workWechatName;
      const payload: any = {
        ...v,
        csUserId: userId,
        isCompensation: (v as any).isCompensation,
        csCultivated: prefill.csCultivated === true ? true : undefined,
        workWechatId,
        workWechatName,
        ...(directAddMode
          ? {
              directAdd: true,
              dispatchType: 'POOL',
              urgency: 'later',
            }
          : {}),
      };
      if (editingOrder?.status === 'DONE') {
        delete payload.amount;
        delete payload.duration;
      }
      if (editingOrder) {
        await ordersApi.updateOrder(editingOrder.id, payload);
        message.success('订单信息已更新');
      } else {
        await ordersApi.create(payload);
        message.success(customerPreFill ? '已开始服务' : directAddMode ? '客户已加入管理端直添客户跟进列表' : '订单已发布');
      }
      form.resetFields();
      onClose();
      onCreated();
    } catch (e: any) {
      if (!e?.errorFields) message.error(e?.response?.data?.message || (editingOrder ? '保存失败' : '创建失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={editingOrder ? '修改订单信息' : directAddMode ? '直接添加客户' : '创建订单'}
      open={open}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      confirmLoading={loading}
      okText={editingOrder ? '保存修改' : customerPreFill ? '开始服务' : directAddMode ? '加入管理端直添客户跟进列表' : '发布'}
      cancelText="取消"
      destroyOnClose
      width={520}
    >
      <Form
        form={form}
        layout="vertical"
        style={{ marginTop: 8 }}
        size="small"
        initialValues={{
          type: 'NEW',
          gameName: '三角洲行动',
          dispatchType: DispatchType.POOL,
          urgency: 'now',
          billingMode: 'hour',
          duration: 1,
          serviceType: 'PLAY_WITH',
          customerSource: '小红书',
        }}
      >
        <Form.Item name="type" label="订单类型" initialValue="NEW" rules={[{ required: true }]}>
          <Select>
            {Object.entries(orderTypeConfig).map(([k, v]) => (
              <Option key={k} value={k}>
                {v}
              </Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item name="gameName" label="游戏名称" rules={[{ required: true }]}>
          <Select showSearch>
            {gameList.map((g) => (
              <Option key={g} value={g}>
                {g}
              </Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item name="serviceType" label="服务类型" initialValue="PLAY_WITH">
          <Select>
            <Option value="PLAY_WITH">陪玩</Option>
            <Option value="ESCORT">护航</Option>
            <Option value="DO_TASK">做任务</Option>
          </Select>
        </Form.Item>
        <Form.Item name="deltaMission" label="任务类型">
          <Select placeholder="可选" allowClear>
            <Option value="机密">机密</Option>
            <Option value="绝密">绝密</Option>
          </Select>
        </Form.Item>
        <Form.Item name="deltaCount" label="单/双陪" initialValue="单">
          <Select>
            <Option value="单">单陪</Option>
            <Option value="双">双陪</Option>
          </Select>
        </Form.Item>
        <Form.Item name="deltaNote" label="备注">
          <Input.TextArea rows={2} placeholder="补充说明" />
        </Form.Item>
        {!directAddMode && !editingOrder && (
          <>
            <Form.Item name="dispatchType" label="派单方式" initialValue={DispatchType.POOL} rules={[{ required: true }]}>
              <Select>
                <Option value={DispatchType.POOL}>入池</Option>
                <Option value={DispatchType.BROADCAST}>广播</Option>
                <Option value={DispatchType.DIRECT}>指定</Option>
              </Select>
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.dispatchType !== cur.dispatchType}>
              {({ getFieldValue }) =>
                getFieldValue('dispatchType') === DispatchType.DIRECT ? (
                  <Form.Item name="companionId" label="主陪" rules={[{ required: true, message: '请选择陪玩' }]}>
                    <Select placeholder="选择主陪" showSearch optionFilterProp="label">
                      {companions.map((c: any) => (
                        <Option key={c.id} value={c.id} label={c.user?.displayName || c.user?.username}>
                          {c.user?.displayName || c.user?.username}
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                ) : null
              }
            </Form.Item>
          </>
        )}
        <Form.Item noStyle shouldUpdate={(p, c) => p.deltaCount !== c.deltaCount}>
          {({ getFieldValue }) => {
            const isDouble = getFieldValue('deltaCount') === '双';
            return (
              <Form.Item name="amount" label={isDouble ? '主陪金额' : '金额'} rules={[{ required: true }]}>
                <InputNumber
                  min={0}
                  style={{ width: '100%' }}
                  placeholder="？/人/h"
                  prefix="¥"
                  disabled={!!editingOrder && editingOrder.status === 'DONE'}
                />
              </Form.Item>
            );
          }}
        </Form.Item>
        {!directAddMode && (
          <>
            <Form.Item name="urgency" label="打单时间" initialValue="now">
              <Select>
                <Option value="now">⚡立即打</Option>
                <Option value="later">📅预约</Option>
              </Select>
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.urgency !== cur.urgency}>
              {({ getFieldValue }) =>
                getFieldValue('urgency') === 'later' ? (
                  <Form.Item name="scheduledTimeText" label="预约时间" style={{ marginBottom: 0 }}>
                    <Input placeholder="自由填写，请带年月日，如：2026/8/20 20:00 或 8月20日晚上8点" />
                  </Form.Item>
                ) : null
              }
            </Form.Item>
          </>
        )}
        <Form.Item label="客户来源" required>
          <Input.Group compact>
            <Form.Item name="customerSource" noStyle rules={[{ required: true, message: '请选择客户来源' }]}>
              <Select placeholder="来源" style={{ width: '30%' }}>
                <Option value="小红书">小红书</Option>
                <Option value="抖音">抖音</Option>
                <Option value="快手">快手</Option>
                <Option value="咸鱼">咸鱼</Option>
                <Option value="B站">B站</Option>
                <Option value="视频号">视频号</Option>
                <Option value="转介绍">转介绍</Option>
                <Option value="其他">其他</Option>
                {trafficAccounts
                  .map((a) => a.type)
                  .filter((t, i, arr) => t && arr.indexOf(t) === i)
                  .filter((t) => !['小红书', '抖音', '快手', '咸鱼', 'B站', '视频号', '转介绍', '其他'].includes(t))
                  .map((t) => (
                    <Option key={t} value={t}>
                      {t}
                    </Option>
                  ))}
              </Select>
            </Form.Item>
            <Form.Item name="customerSourceAccount" noStyle>
              <Select
                style={{ width: '70%' }}
                placeholder="选择引流账号"
                showSearch
                optionFilterProp="label"
                allowClear
                onChange={(nickname: string) => {
                  const acc = trafficAccounts.find((a) => a.nickname === nickname);
                  if (acc?.type) form.setFieldsValue({ customerSource: acc.type });
                }}
                dropdownRender={(menu) => (
                  <>
                    {menu}
                    <div style={{ padding: '6px 8px', borderTop: '1px solid #f0f0f0' }}>
                      <Checkbox checked={showInactiveAccounts} onChange={(e) => setShowInactiveAccounts(e.target.checked)}>
                        显示已弃用账号
                      </Checkbox>
                    </div>
                  </>
                )}
              >
                {trafficAccounts
                  .filter((a) => showInactiveAccounts || a.status !== 'INACTIVE')
                  .map((a) => (
                    <Option key={a.id} value={a.nickname} label={`${a.type} - ${a.nickname}`}>
                      {a.type} - {a.nickname}（{a.user?.displayName || a.user?.username || '未知'}）{a.status === 'INACTIVE' ? ' · 已弃用' : ''}
                    </Option>
                  ))}
              </Select>
            </Form.Item>
          </Input.Group>
        </Form.Item>
        <Form.Item
          name="customerNickname"
          label="客户昵称"
          rules={!customerPreFill ? [{ required: true, message: '请填写客户昵称' }] : []}
        >
          <Input placeholder="客户昵称（小红书昵称/抖音昵称等）" />
        </Form.Item>
        <Form.Item
          name="customerAccountId"
          label="客户账号ID"
          rules={!customerPreFill ? [{ required: true, message: '请填写客户账号ID' }] : []}
        >
          <Input placeholder="客户自己的小红书ID/抖音号/快手号（具体是哪个客户）" />
        </Form.Item>
        <Form.Item label="客户联系方式">
          <Input.Group compact>
            <Form.Item name="customerWechat" noStyle>
              <Input style={{ width: '25%' }} placeholder="微信" />
            </Form.Item>
            <Form.Item name="customerYy" noStyle>
              <Input style={{ width: '25%' }} placeholder="YY号" />
            </Form.Item>
            <Form.Item name="customerPlatformAccount" noStyle>
              <Input style={{ width: '25%' }} placeholder="KOOK号" />
            </Form.Item>
            <Form.Item name="customerRoomCode" noStyle>
              <Input style={{ width: '25%' }} placeholder="房间码" />
            </Form.Item>
          </Input.Group>
        </Form.Item>
        {directAddMode && (
          <Form.Item
            name="workWechatId"
            label="工作微信（用哪个微信添加客户）"
            rules={[{ required: true, message: '请选择添加客户用的工作微信' }]}
          >
            <Select placeholder="选择工作微信" allowClear>
              {workWechats
                .filter((w: any) => w.type === 'STUDIO')
                .map((w: any) => (
                  <Option key={w.id} value={w.id}>
                    {w.wechatId}{w.nickname ? `（${w.nickname}）` : ''}
                  </Option>
                ))}
            </Select>
          </Form.Item>
        )}
        <Form.Item label="客户微信二维码（没有微信文字时上传）">
          <PasteImageBox onFile={uploadCustomerWechatQr}>
            <Upload beforeUpload={uploadCustomerWechatQr} maxCount={1} accept="image/*">
              <Button loading={uploading}>{customerWechatQr ? '重新上传二维码' : '上传客户微信二维码'}</Button>
            </Upload>
          </PasteImageBox>
          <Form.Item name="customerWechatQr" hidden><Input /></Form.Item>
        </Form.Item>
        <Form.Item name="billingMode" label="计费方式" initialValue="hour">
          <Select>
            <Option value="hour">按小时</Option>
            <Option value="round">按局数</Option>
          </Select>
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(p, c) => p.billingMode !== c.billingMode}>
          {({ getFieldValue }) =>
            getFieldValue('billingMode') === 'round' ? (
              <Form.Item name="duration" label="局数">
                <InputNumber min={1} step={1} style={{ width: '100%' }} disabled={!!editingOrder && editingOrder.status === 'DONE'} />
              </Form.Item>
            ) : (
              <Form.Item name="duration" label="时长（小时）" initialValue={1}>
                <InputNumber min={0.5} step={0.5} style={{ width: '100%' }} disabled={!!editingOrder && editingOrder.status === 'DONE'} />
              </Form.Item>
            )
          }
        </Form.Item>
      </Form>
    </Modal>
  );
};
export default memo(CreateOrderModal);
