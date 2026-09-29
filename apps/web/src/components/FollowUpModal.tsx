// craftsman-ignore: TS001,TS002
import React, { useEffect, useState } from 'react';
import { DatePicker, Form, Input, Modal, Select, message } from 'antd';
import { companionsApi } from '../api/companions';
import { customersApi } from '../api/customers';
import { extractErrorMessage } from '../utils/error-handler';

interface Props {
  open: boolean;
  /** 流转明细里的那一行（带 customerId / customer / customFields） */
  item: any;
  onClose: () => void;
  onSaved?: () => void;
}

/**
 * 「记跟进」弹窗（老板 2026-09-29 定的用法）：
 * 客服写一句「这次聊到哪一步」+ 选个下次跟进时间，写进**客户档案里那条跟进记录**
 * （customer 的跟进记录），所以在客户管理 / 客户详情里能看到同一条 —— 不开第二本账。
 * 顺手记一下这次是用哪个客服工作微信加的，「管理端直添客户流转明细」的「工作微信」列就有了。
 */
const FollowUpModal: React.FC<Props> = ({ open, item, onClose, onSaved }) => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [wechats, setWechats] = useState<any[]>([]);
  const [loadingWechats, setLoadingWechats] = useState(false);

  useEffect(() => {
    if (!open) return;
    const cf = (item && item.customFields) || {};
    const last = ((item || {}).customer || {}).followUps?.[0];
    form.resetFields();
    form.setFieldsValue({
      workWechatName: cf.csWorkWechatName || last?.workWechatName || undefined,
    });
    setLoadingWechats(true);
    companionsApi
      .listWorkWechats()
      // 只要客服工作微信（工作室微信）；陪玩的个人微信不在这里选
      .then(({ data }) => setWechats((data.data || []).filter((w: any) => w.type !== 'COMPANION')))
      .catch(() => {})
      .finally(() => setLoadingWechats(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  const submit = async () => {
    const values = await form.validateFields();
    const customerId = item?.customerId || item?.customer?.id;
    if (!customerId) {
      message.warning('这条记录没有关联客户，记不了跟进');
      return;
    }
    setSaving(true);
    try {
      await customersApi.addFollowUp(customerId, {
        content: values.content,
        nextFollowUpAt: values.nextFollowUpAt ? values.nextFollowUpAt.toISOString() : undefined,
        workWechatName: values.workWechatName || undefined,
      });
      message.success('跟进已记下（客户管理里能看到同一条）');
      onSaved?.();
      onClose?.();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '记跟进失败'));
    } finally {
      setSaving(false);
    }
  };

  const cf = (item && item.customFields) || {};
  const customer = (item || {}).customer || {};
  const who = cf.customerNickname || customer.wechatId || (customer.customerCode ? `#${customer.customerCode}` : '');

  return (
    <Modal
      title={who ? `记跟进 · 客户 ${who}` : '记跟进'}
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="保存"
      cancelText="取消"
      confirmLoading={saving}
      destroyOnClose
      width={460}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item label="客服工作微信">
          <Select
            allowClear
            showSearch
            loading={loadingWechats}
            placeholder="这次是用哪个工作微信跟的？（可留空）"
            optionFilterProp="label"
            options={wechats.map((w: any) => ({
              value: w.wechatId,
              label: w.nickname ? `${w.wechatId}（${w.nickname}）` : w.wechatId,
            }))}
          />
        </Form.Item>
        <Form.Item
          label="这次聊到哪一步"
          name="content"
          rules={[{ required: true, message: '写一句这次跟进的进展' }]}
        >
          <Input.TextArea
            rows={3}
            maxLength={200}
            showCount
            placeholder="如：已加上微信，客户说这周先不打，等他忙完自己找我们"
          />
        </Form.Item>
        <Form.Item label="下次跟进时间" name="nextFollowUpAt">
          <DatePicker
            showTime
            format="M月D日 HH:mm"
            placeholder="可选：哪天再跟这位客户聊一次"
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default FollowUpModal;
