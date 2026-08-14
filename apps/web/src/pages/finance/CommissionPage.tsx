// craftsman-ignore: TS001,TS002,TS003
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Space, Typography, message, Modal, Form, InputNumber, Select, Switch, DatePicker, Tag, Statistic, Row, Col, Popconfirm } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, CalculatorOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { financeApi } from '../../api/finance';
import PageHeader from '../../components/PageHeader';
import { useAuthStore } from '../../stores/authStore';
import { UserRole } from '@chunlv/shared';

const { Text } = Typography;

const roleOptions = [
  { label: '客服', value: 'CS' },
  { label: '店长', value: 'ADMIN' },
];

const basisOptions = [
  { label: '认领流水（元）', value: 'CLAIMED_AMOUNT' },
  { label: '派单量（单）', value: 'ORDER_COUNT' },
  { label: '认领量（单）', value: 'CLAIMED_COUNT' },
];

const typeOptions = [
  { label: '按比例（%）', value: 'RATE' },
  { label: '固定金额', value: 'FIXED' },
];

const basisLabel: Record<string, string> = {
  CLAIMED_AMOUNT: '认领流水',
  ORDER_COUNT: '派单量',
  CLAIMED_COUNT: '认领量',
};

const CommissionPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const canWrite = user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN;
  const [rules, setRules] = useState<any[]>([]);
  const [ledgers, setLedgers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [form] = Form.useForm();

  const fetchRules = useCallback(async () => {
    try {
      const { data } = await financeApi.commission.listRules();
      setRules((data as any)?.data || []);
    } catch {
      message.error('加载提成规则失败');
    }
  }, []);

  const fetchLedgers = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await financeApi.commission.list(month.format('YYYY-MM'));
      setLedgers((data as any)?.data || []);
    } catch {
      message.error('加载提成结算失败');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  useEffect(() => {
    fetchLedgers();
  }, [fetchLedgers]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ role: 'CS', basis: 'CLAIMED_AMOUNT', type: 'RATE', rate: 2, isActive: true });
    setModalOpen(true);
  };

  const openEdit = (record: any) => {
    setEditing(record);
    form.setFieldsValue({
      role: record.role,
      basis: record.basis,
      type: record.type,
      rate: record.type === 'RATE' ? Math.round((record.rate ?? 0) * 100) : undefined,
      fixedAmountYuan: record.type === 'FIXED' ? (record.fixedAmount ?? 0) / 100 : undefined,
      isActive: record.isActive,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        id: editing?.id,
        role: values.role,
        basis: values.basis,
        type: values.type,
        isActive: values.isActive,
      };
      if (values.type === 'RATE') {
        payload.rate = (values.rate ?? 0) / 100;
        payload.fixedAmountYuan = null;
      } else {
        payload.rate = null;
        payload.fixedAmountYuan = values.fixedAmountYuan ?? 0;
      }
      await financeApi.commission.upsertRule(payload);
      message.success(editing ? '已更新提成规则' : '已新增提成规则');
      setModalOpen(false);
      await fetchRules();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const setLedgerStatus = async (id: string, status: string) => {
    try {
      await financeApi.commission.setLedgerStatus(id, status);
      message.success(status === 'CONFIRMED' ? '已确认提成' : '已撤销为草稿');
      await fetchLedgers();
    } catch {
      message.error('操作失败');
    }
  };

  const calculate = async () => {
    setCalculating(true);
    try {
      const { data } = await financeApi.commission.calculate(month.format('YYYY-MM'));
      const res = (data as any)?.data;
      message.success(`计算完成，共生成 ${res?.created ?? 0} 条提成记录`);
      await fetchLedgers();
    } catch {
      message.error('计算失败');
    } finally {
      setCalculating(false);
    }
  };

  const totalAmount = ledgers.reduce((sum: number, l: any) => sum + (l.amountYuan || 0), 0);

  return (
    <div>
      <PageHeader
        title="客服/店长提成"
        subtitle="配置提成规则并计算月度提成，计提基数按客服认领的已完成订单统计"
        extra={
          <Space>
            <DatePicker picker="month" value={month} onChange={(v) => v && setMonth(v)} allowClear={false} />
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchLedgers} loading={loading}>刷新</Button>
            {canWrite && <Button type="primary" icon={React.createElement(CalculatorOutlined)} onClick={calculate} loading={calculating}>计算当月提成</Button>}
          </Space>
        }
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic title={`${month.format('YYYY-MM')} 提成合计`} value={totalAmount} precision={2} prefix="¥" />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="提成人数" value={ledgers.length} suffix="人" />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="启用规则数" value={rules.filter((r: any) => r.isActive).length} suffix="条" />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title="提成规则"
        style={{ marginBottom: 16 }}
        extra={canWrite ? <Button type="dashed" size="small" icon={React.createElement(PlusOutlined)} onClick={openCreate}>新增规则</Button> : null}
      >
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={rules}
          locale={{ emptyText: '暂无提成规则' }}
        >
          <Table.Column title="角色" dataIndex="role" render={(v: string) => (v === 'CS' ? <Tag color="blue">客服</Tag> : <Tag color="purple">店长</Tag>)} />
          <Table.Column title="计提基数" dataIndex="basis" render={(v: string) => basisLabel[v] || v} />
          <Table.Column
            title="方式"
            dataIndex="type"
            render={(v: string, record: any) => {
              if (v === 'RATE') return <Tag color="green">比例 {Math.round((record.rate ?? 0) * 100)}%</Tag>;
              return <Tag color="orange">固定 ¥{(record.fixedAmount ?? 0) / 100}</Tag>;
            }}
          />
          <Table.Column
            title="启用"
            dataIndex="isActive"
            render={(v: boolean) => (v ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>)}
          />
          {canWrite && (
            <Table.Column
              title="操作"
              width={100}
              render={(_: any, record: any) => (
                <Button size="small" type="link" icon={React.createElement(EditOutlined)} onClick={() => openEdit(record)}>编辑</Button>
              )}
            />
          )}
        </Table>
      </Card>

      <Card size="small" title={`${month.format('YYYY-MM')} 提成结算`}>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          pagination={false}
          dataSource={ledgers}
          locale={{ emptyText: '暂无结算记录，请先点击「计算当月提成」' }}
        >
          <Table.Column title="姓名" dataIndex="displayName" render={(v: string, r: any) => v || r.username || '-'} />
          <Table.Column title="账号" dataIndex="username" />
          <Table.Column title="角色" dataIndex="role" render={(v: string) => (v === 'CS' ? '客服' : v === 'ADMIN' ? '店长' : v)} />
          <Table.Column title="计提基数" dataIndex="basisValue" render={(v: number, r: any) => (r.basis === 'CLAIMED_AMOUNT' ? `¥${Number(v || 0).toFixed(2)}` : `${v} 单`)} />
          <Table.Column title="提成金额" dataIndex="amountYuan" render={(v: number) => <Text strong>¥{Number(v || 0).toFixed(2)}</Text>} />
          <Table.Column title="状态" dataIndex="status" render={(v: string) => (v === 'CONFIRMED' ? <Tag color="green">已确认</Tag> : <Tag color="gold">草稿</Tag>)} />
          {canWrite && (
            <Table.Column
              title="操作"
              width={120}
              render={(_: any, r: any) =>
                r.status === 'DRAFT' ? (
                  <Popconfirm title="确认该提成金额？" onConfirm={() => setLedgerStatus(r.id, 'CONFIRMED')}>
                    <Button size="small" type="link">确认</Button>
                  </Popconfirm>
                ) : (
                  <Popconfirm title="撤销为草稿？" onConfirm={() => setLedgerStatus(r.id, 'DRAFT')}>
                    <Button size="small" type="link">撤销</Button>
                  </Popconfirm>
                )
              }
            />
          )}
        </Table>
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          📌 计算幂等：重复计算会覆盖同月同规则记录；规则快照随结算锁定，后续改规则不影响已结算月份。
        </Text>
      </Card>

      <Modal
        title={editing ? '编辑提成规则' : '新增提成规则'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ role: 'CS', basis: 'CLAIMED_AMOUNT', type: 'RATE', rate: 2, isActive: true }}>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select options={roleOptions} />
          </Form.Item>
          <Form.Item name="basis" label="计提基数" rules={[{ required: true }]}>
            <Select options={basisOptions} />
          </Form.Item>
          <Form.Item name="type" label="提成方式" rules={[{ required: true }]}>
            <Select options={typeOptions} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.type !== cur.type}>
            {({ getFieldValue }) =>
              getFieldValue('type') === 'RATE' ? (
                <Form.Item name="rate" label="比例（%）" rules={[{ required: true, message: '请输入比例' }]}>
                  <InputNumber min={0} max={100} step={0.1} style={{ width: '100%' }} />
                </Form.Item>
              ) : (
                <Form.Item name="fixedAmountYuan" label="固定金额（元/单）" rules={[{ required: true, message: '请输入固定金额' }]}>
                  <InputNumber min={0} step={1} precision={2} style={{ width: '100%' }} />
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item name="isActive" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CommissionPage;
