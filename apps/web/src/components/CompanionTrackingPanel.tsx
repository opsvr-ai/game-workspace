// craftsman-ignore: TS001,TS002,TS003
import React, { useEffect, useState, useCallback } from 'react';
import { Row, Col, Button, Tag, Space, Typography, message, Empty, Spin, Modal, Select, Input, Form } from 'antd';
import { ThunderboltOutlined, AimOutlined, FireOutlined, PlusOutlined, DeleteOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { customerTrackingApi } from '../api/customerTracking';
import { extractErrorMessage } from '../utils/error-handler';

const { Text, Title } = Typography;
const { Option } = Select;

const glass = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 18,
} as const;

const resultOptions = [
  { value: 'NOW', label: '现在打' },
  { value: 'RESCHEDULE', label: '改天' },
  { value: 'REJECT', label: '不同意' },
  { value: 'NO_REPLY', label: '未回复' },
  { value: 'DELETED', label: '已删除' },
  { value: 'DONGGU', label: '懂哥' },
  { value: 'REFUND', label: '退款' },
];

const trackOptions = [
  { value: 'TEXT', label: '纯文字' },
  { value: 'IMAGE', label: '纯截图' },
  { value: 'TEXT_IMAGE', label: '截图+文字' },
];

const CompanionTrackingPanel: React.FC = () => {
  const [status, setStatus] = useState<any>(null);
  const [reminders, setReminders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [contactCustomer, setContactCustomer] = useState<any>(null);
  const [trackCustomer, setTrackCustomer] = useState<any>(null);
  const [deleteCustomer, setDeleteCustomer] = useState<any>(null);
  const [contactForm] = Form.useForm();
  const [trackForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([customerTrackingApi.status(), customerTrackingApi.reminders()]);
      setStatus((s as any).data.data ?? null);
      setReminders((r as any).data.data ?? []);
    } catch (e: any) {
      message.error(extractErrorMessage(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submitContact = async () => {
    const v = await contactForm.validateFields();
    setSubmitting(true);
    try {
      await customerTrackingApi.registerContact({ customerId: contactCustomer.id, result: v.result, note: v.note });
      message.success('联系结果已登记');
      setContactCustomer(null);
      contactForm.resetFields();
      load();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '登记失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const submitTrack = async () => {
    const v = await trackForm.validateFields();
    setSubmitting(true);
    try {
      await customerTrackingApi.addTrack({ customerId: trackCustomer.id, type: v.type, content: v.content, images: [] });
      message.success('追踪已记录');
      setTrackCustomer(null);
      trackForm.resetFields();
      load();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '记录失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const submitDelete = async () => {
    setSubmitting(true);
    try {
      await customerTrackingApi.submitDeleteRequest({ customerId: deleteCustomer.id });
      message.success('删除申请已提交，等待管理端审核');
      setDeleteCustomer(null);
      load();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '申请失败'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  const cfg = status?.config ?? {};
  const stat = [
    { label: '今日有效客户', value: `${status?.todayValidCustomers ?? 0} / ${cfg.quota ?? 3}`, icon: ThunderboltOutlined, color: '#00E5FF' },
    { label: '今日流水', value: `¥${Math.round(status?.todayRevenue ?? 0)}`, icon: AimOutlined, color: '#7C4DFF' },
    { label: '综合成功率', value: `${status?.success?.sum ?? 0}%`, icon: CheckCircleOutlined, color: '#FFB300' },
  ];

  return (
    <div
      style={{
        background: 'radial-gradient(900px 400px at 0% 0%, rgba(0,229,255,0.16), transparent 55%), linear-gradient(160deg,#070B18,#0B1024 50%,#130B2E)',
        borderRadius: 24,
        padding: '26px 24px 32px',
        color: '#EAF2FF',
        minHeight: 520,
      }}
    >
      <Title level={3} style={{ color: '#fff', marginTop: 0 }}>
        我的追踪战报
      </Title>
      {!status?.allowed && (
        <div
          style={{
            marginBottom: 18,
            padding: '14px 16px',
            borderRadius: 14,
            background: 'linear-gradient(90deg, rgba(255,46,154,0.20), rgba(255,46,154,0.04))',
            border: '1px solid rgba(255,46,154,0.35)',
          }}
        >
          <Space direction="vertical" size={4}>
            <Text strong style={{ color: '#FF7AC1' }}>当前抢单受限</Text>
            {status?.reasons?.map((r: string) => <Text key={r} style={{ color: '#E9C7FF' }}>· {r}</Text>)}
          </Space>
        </div>
      )}

      <Row gutter={[14, 14]}>
        {stat.map((s) => (
          <Col xs={24} sm={8} key={s.label}>
            <div style={{ ...glass, padding: 18, position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: -24, right: -24, width: 90, height: 90, borderRadius: '50%', background: `radial-gradient(circle, ${s.color}44, transparent 70%)` }} />
              <s.icon style={{ color: s.color, fontSize: 20 }} />
              <div style={{ marginTop: 12, fontSize: 30, fontWeight: 800, textShadow: `0 0 22px ${s.color}66` }}>{s.value}</div>
              <Text style={{ color: '#A9B7D9' }}>{s.label}</Text>
            </div>
          </Col>
        ))}
      </Row>

      <div style={{ ...glass, padding: 20, marginTop: 22 }}>
        <Space align="center" style={{ marginBottom: 14 }}>
          <FireOutlined style={{ color: '#FFB300', fontSize: 18 }} />
          <Text strong style={{ color: '#fff', fontSize: 16 }}>待追踪客户</Text>
          <Tag color="gold" style={{ borderRadius: 999 }}>{reminders.length}</Tag>
        </Space>
        {reminders.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ color: '#8A97B8' }}>暂无待追踪客户</span>} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {reminders.slice(0, 12).map((c: any) => (
              <div key={c.id} style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Text strong style={{ color: '#fff' }}>{c.wechatId || c.customerCode || '未知客户'}</Text>
                    <div><Text style={{ color: '#A9B7D9', fontSize: 12 }}>{c.platform || '未知平台'}</Text></div>
                  </div>
                  <Space>
                    <Button size="small" ghost onClick={() => setContactCustomer(c)}>登记结果</Button>
                    <Button size="small" icon={React.createElement(PlusOutlined)} onClick={() => setTrackCustomer(c)}>追踪</Button>
                    <Button size="small" danger icon={React.createElement(DeleteOutlined)} onClick={() => setDeleteCustomer(c)}>删除</Button>
                  </Space>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal title="登记联系结果" open={!!contactCustomer} onOk={submitContact} confirmLoading={submitting} onCancel={() => setContactCustomer(null)} okText="提交" cancelText="取消" destroyOnClose>
        <Form form={contactForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="result" label="联系结果" rules={[{ required: true, message: '请选择结果' }]}>
            <Select placeholder="选择结果">{resultOptions.map((o) => <Option key={o.value} value={o.value}>{o.label}</Option>)}</Select>
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={3} placeholder="可补充说明" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="添加追踪" open={!!trackCustomer} onOk={submitTrack} confirmLoading={submitting} onCancel={() => setTrackCustomer(null)} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={trackForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="type" label="追踪类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select placeholder="选择类型">{trackOptions.map((o) => <Option key={o.value} value={o.value}>{o.label}</Option>)}</Select>
          </Form.Item>
          <Form.Item name="content" label="追踪内容">
            <Input.TextArea rows={4} placeholder="记录客户情况或上传截图说明" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="申请删除客户" open={!!deleteCustomer} onOk={submitDelete} confirmLoading={submitting} onCancel={() => setDeleteCustomer(null)} okText="提交申请" cancelText="取消">
        <Text style={{ display: 'block', marginTop: 12 }}>
          确认客户 <Text strong>{deleteCustomer?.wechatId || deleteCustomer?.customerCode}</Text> 已删除你吗？提交后需管理端审核。
        </Text>
      </Modal>
    </div>
  );
};

export default CompanionTrackingPanel;
