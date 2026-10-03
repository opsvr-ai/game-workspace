// craftsman-ignore: TS001,TS002
import React, { memo, useState, useEffect } from 'react';
import { Modal, Form, Input, Select, InputNumber, message, Upload, Button, Checkbox } from 'antd';
import { ordersApi } from '../api/orders';
import { companionsApi } from '../api/companions';
import { trafficAccountApi } from '../api/trafficAccount';
import { financeApi } from '../api/finance';
import { DispatchType } from '@chunlv/shared';
import http from '../api/client';
import PasteImageBox from './PasteImageBox';
import { TransferNote, transferList } from './OrderTransferNote';
import { orderTypeConfig, dispatchTypeConfig, deltaMissionDefaultPrice } from '../constants/orders';

const { Option } = Select;

const ORDER_TYPES = Object.entries(orderTypeConfig).filter(([k]) => k !== 'TIP');
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

  /**
   * 「先给谁抢」的默认值来自发单客服自己的档位（老板 2026-09-29）：
   * 邵泽慧这类「先本店线下」，孙可馨这类「先桥接 + 线上」。没配过就是先本店线下。
   * 客服 / 店长 / 老板都能读这张表；陪玩读不到就按默认来（catch 掉）。
   */
  useEffect(() => {
    if (!open || editingOrder) return;
    financeApi.commission
      .csProfiles()
      .then(({ data: res }: any) => {
        const me = (res?.data?.items || []).find((it: any) => it.userId === userId);
        if (me?.poolScope && !form.getFieldValue('poolScope')) {
          form.setFieldsValue({ poolScope: me.poolScope });
        }
      })
      .catch(() => {});
  }, [open, userId, editingOrder, form]);

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
        // 原客户ID必须显式带上：`validateFields()` 只返回「注册过的字段」，而 customerId 只是
        // setFieldsValue 塞进去的隐藏值（弹窗里没有这个 Form.Item），所以 `...v` 里根本没有它 ——
        // 结果每发一次单就新插一条客户档案，「客户管理」里同一个人出现两条
        // （2026-09-29 线上只读核查：sj13771731714 三条、amm070701 两条、slsz899 两条……）。
        customerId: (v as any).customerId || prefill.customerId || undefined,
        isCompensation: (v as any).isCompensation,
        csCultivated: prefill.csCultivated === true ? true : undefined,
        // 客服养好的客户重新派单：记下从哪张单派出去的（流转明细可追溯）
        sourceOrderId: prefill.sourceOrderId || undefined,
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
        message.success(customerPreFill ? '已开始服务' : directAddMode ? '客户已加入「管理端直添客户流转明细」' : '订单已发布');
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
      okText={editingOrder ? '保存修改' : customerPreFill ? '开始服务' : directAddMode ? '加入客户流转明细' : '发布'}
      cancelText="取消"
      destroyOnClose
      width={520}
    >
      {/* 转让留痕（老板 2026-10-03「400 订单转给王甲振，怎么没看到转让记录」）：
          订单管理里老板点开这一单走的是编辑弹窗，之前这里一个字都没有。 */}
      {transferList(editingOrder?.transfers).length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 10px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 6 }}>
          <TransferNote transfers={editingOrder?.transfers} />
        </div>
      )}
      <Form
        form={form}
        layout="vertical"
        style={{ marginTop: 8 }}
        size="small"
        initialValues={{
          type: 'NEW',
          gameName: '三角洲行动',
          // 老板 2026-10-01 起发单弹窗只剩「广播 / 指定」。这里以前写的是 POOL（入池），
          // 而 Form 的 initialValues 优先级高于 Form.Item 的 initialValue ——
          // 下面那个「派单方式」下拉的 initialValue={BROADCAST} 根本没生效，选中的一直是 POOL。
          // 下拉里又已经把「入池」这个选项删了，rc-select 找不到对应选项时会把原始值直接打出来，
          // 于是界面上显示成英文「POOL」，发出去的单也真的按「入池」走（陪玩端不弹窗）。
          dispatchType: DispatchType.BROADCAST,
          urgency: 'now',
          billingMode: 'hour',
          duration: 1,
          serviceType: 'PLAY_WITH',
          customerSource: '小红书',
        }}
      >
        <Form.Item name="type" label="订单类型" initialValue="NEW" rules={[{ required: true }]}>
          <Select>
            {ORDER_TYPES.map(([k, cfg]) => (
              <Option key={k} value={k}>
                {cfg.label}
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
          <Select
            placeholder="可选"
            allowClear
            onChange={(v: string) => {
              // 老板 2026-10-01：选「机密」金额默认 35、选「绝密」默认 45。
              // 只在金额为空、或还是那两个默认价时自动带出来；已经手动填过别的价就不覆盖。
              const preset = deltaMissionDefaultPrice[v];
              if (preset == null) return;
              const cur = form.getFieldValue('amount');
              const isDefault = Object.values(deltaMissionDefaultPrice).includes(Number(cur));
              if (cur === undefined || cur === null || cur === '' || isDefault) {
                form.setFieldsValue({ amount: preset });
              }
            }}
          >
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
            {/* 老板 2026-10-01：发布订单里去掉「入池」（代码留着），
                默认选「广播」。入池只剩管理端「直添客户」走它自己的隐式路径。 */}
            <Form.Item name="dispatchType" label="派单方式" initialValue={DispatchType.BROADCAST} rules={[{ required: true }]}>
              <Select
                // 兜底：万一还有老值（例如 POOL）被预填进来，这里也一律显示中文名，
                // 不让下拉把英文枚举原文打给客服看（rc-select 找不到选项时会直接显示 value）。
                labelRender={(item: any) => dispatchTypeConfig[String(item.value)]?.label ?? item.label ?? item.value}
              >
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
            {/* 入池方式（老板 2026-09-29）：广播单用得到（线上→线下流转），
                “入池”方式只剩管理端直添客户那条隐式路径。默认值自动带发单客服自己的档位。 */}
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.dispatchType !== cur.dispatchType}>
              {({ getFieldValue }) =>
                getFieldValue('dispatchType') !== DispatchType.DIRECT ? (
                  <Form.Item
                    name="poolScope"
                    label="入池方式"
                    initialValue="OFFLINE_FIRST"
                    extra="线下→线上流转：本店线下先抢，几分钟没人接轮到桥接工作室 + 线上俱乐部。线上→线下流转：桥接工作室 + 线上俱乐部秒看到，几分钟没人接自动放到本店线下（客服也可以随时手动放给线下）。"
                  >
                    <Select>
                      <Option value="OFFLINE_FIRST">线下→线上流转</Option>
                      <Option value="ONLINE_FIRST">线上→线下流转</Option>
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
        <Form.Item label="来源 / 引流账号" required>
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
                placeholder="引流账号"
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
            label="工作微信"
            rules={[{ required: true, message: '请选择添加客户用的工作微信' }]}
          >
            <Select placeholder="用哪个微信添加客户" allowClear>
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
        <Form.Item label="客户微信二维码">
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
              <Form.Item name="duration" label="时长" initialValue={1}>
                <InputNumber min={0.5} step={0.5} suffix="小时" style={{ width: '100%' }} disabled={!!editingOrder && editingOrder.status === 'DONE'} />
              </Form.Item>
            )
          }
        </Form.Item>
      </Form>
    </Modal>
  );
};
export default memo(CreateOrderModal);
