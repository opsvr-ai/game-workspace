// craftsman-ignore: TS001,TS002,TS003
import React, { useState, useEffect, useCallback } from 'react';
import { Card, Table, Button, Space, Typography, message, Modal, Form, Input, InputNumber, Select, Switch, Tag } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined } from '@ant-design/icons';
import { financeApi } from '../../api/finance';
import PageHeader from '../../components/PageHeader';
import { serviceTypeConfig } from '../../constants/orders';
import { useAuthStore } from '../../stores/authStore';
import { UserRole } from '@chunlv/shared';

const { Text } = Typography;

const orderTypeOptions = [
  { label: '首单', value: 'FIRST' },
  { label: '续单/复购', value: 'RENEW' },
];

const serviceTypeOptions = Object.entries(serviceTypeConfig).map(([value, cfg]) => ({ value, label: cfg.label }));

const PriceRulesPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const canWrite = user?.role === UserRole.OWNER || user?.role === UserRole.ADMIN;
  const [rules, setRules] = useState<any[]>([]);
  const [builtin, setBuiltin] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, builtinRes] = await Promise.all([
        financeApi.priceRules.list(),
        financeApi.priceRules.builtinModes(),
      ]);
      setRules((rulesRes.data as any)?.data || []);
      setBuiltin((builtinRes.data as any)?.data || []);
    } catch {
      message.error('加载价格规则失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      serviceType: 'PLAY_WITH',
      orderType: 'FIRST',
      isActive: true,
      floorPriceYuan: 35,
    });
    setModalOpen(true);
  };

  const openEdit = (record: any) => {
    setEditing(record);
    form.setFieldsValue({
      gameName: record.gameName,
      serviceType: record.serviceType,
      mode: record.mode,
      orderType: record.orderType,
      floorPriceYuan: record.floorPriceYuan,
      maxPriceYuan: record.maxPriceYuan ?? undefined,
      isActive: record.isActive,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) {
        await financeApi.priceRules.update(editing.id, values);
        message.success('已更新价格规则');
      } else {
        await financeApi.priceRules.create(values);
        message.success('已新增价格规则');
      }
      setModalOpen(false);
      await fetchData();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (record: any) => {
    try {
      await financeApi.priceRules.update(record.id, { isActive: !record.isActive });
      await fetchData();
    } catch {
      message.error('操作失败');
    }
  };

  return (
    <div>
      <PageHeader
        title="价格规则配置"
        subtitle="设置机密/绝密的首单底价与续单/复购区间，陪玩可在底价之上上浮报价"
        extra={
          <Space>
            <Button icon={React.createElement(ReloadOutlined)} onClick={fetchData} loading={loading}>刷新</Button>
            {canWrite && <Button type="primary" icon={React.createElement(PlusOutlined)} onClick={openCreate}>新增规则</Button>}
          </Space>
        }
      />

      <Card size="small" title="内置默认规则（仅作参考）" style={{ marginBottom: 16 }}>
        <Table
          rowKey="mode"
          size="small"
          pagination={false}
          dataSource={builtin}
          locale={{ emptyText: '暂无内置规则' }}
        >
          <Table.Column title="模式" dataIndex="mode" render={(v: string) => <Tag color="blue">{v}</Tag>} />
          <Table.Column title="首单底价（元/时/人）" dataIndex="firstFloor" />
          <Table.Column title="续单下限（元/时/人）" dataIndex="renewFloor" />
          <Table.Column title="续单上限（元/时/人）" dataIndex="renewMax" />
        </Table>
      </Card>

      <Card size="small" title="工作室自定义规则">
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rules}
          locale={{ emptyText: '暂无自定义规则，新增后覆盖内置默认规则' }}
          pagination={false}
        >
          <Table.Column title="游戏" dataIndex="gameName" />
          <Table.Column
            title="服务类型"
            dataIndex="serviceType"
            render={(v: string) => serviceTypeConfig[v]?.label || v || '-'}
          />
          <Table.Column title="模式" dataIndex="mode" render={(v: string) => <Tag color="purple">{v}</Tag>} />
          <Table.Column
            title="单类型"
            dataIndex="orderType"
            render={(v: string) => (v === 'RENEW' ? '续单/复购' : '首单')}
          />
          <Table.Column title="底价（元）" dataIndex="floorPriceYuan" />
          <Table.Column title="上限（元）" dataIndex="maxPriceYuan" render={(v: number | null) => (v == null ? '不限' : v)} />
          <Table.Column
            title="启用"
            dataIndex="isActive"
            render={(v: boolean, record: any) => (
              canWrite ? (
                <Switch size="small" checked={v} onChange={() => toggleActive(record)} />
              ) : (
                <Tag color={v ? 'green' : 'default'}>{v ? '启用' : '停用'}</Tag>
              )
            )}
          />
          {canWrite && (
            <Table.Column
              title="操作"
              width={120}
              render={(_: any, record: any) => (
                <Space>
                  <Button size="small" type="link" icon={React.createElement(EditOutlined)} onClick={() => openEdit(record)}>编辑</Button>
                </Space>
              )}
            />
          )}
        </Table>
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          📌 规则匹配优先级：工作室自定义规则 &gt; 内置默认规则；首单不得低于底价，续单/复购不得低于续单下限。
        </Text>
      </Card>

      <Modal
        title={editing ? '编辑价格规则' : '新增价格规则'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="gameName" label="游戏名称" rules={[{ required: true, message: '请输入游戏名称' }]}>
            <Input placeholder="如：三角洲行动" />
          </Form.Item>
          <Form.Item name="serviceType" label="服务类型" rules={[{ required: true }]}>
            <Select options={serviceTypeOptions} />
          </Form.Item>
          <Form.Item name="mode" label="模式" rules={[{ required: true, message: '请输入模式，如：机密/绝密' }]}>
            <Input placeholder="机密 / 绝密" />
          </Form.Item>
          <Form.Item name="orderType" label="单类型" rules={[{ required: true }]}>
            <Select options={orderTypeOptions} />
          </Form.Item>
          <Form.Item name="floorPriceYuan" label="底价（元/时/人）" rules={[{ required: true, message: '请输入底价' }]}>
            <InputNumber min={0} step={1} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="maxPriceYuan" label="上限（元/时/人，留空不限）">
            <InputNumber min={0} step={1} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="isActive" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default PriceRulesPage;
