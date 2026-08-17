// craftsman-ignore: TS001,TS002
import React, { useCallback, useEffect, useState } from 'react';
import {
  Button, Space, Table, Typography, Tag, message, Modal, Form, Input, Select, Popconfirm, Row, Col, DatePicker,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, DeleteOutlined, TagsOutlined, FolderOpenOutlined, SettingOutlined,
  LeftOutlined, RightOutlined,
} from '@ant-design/icons';
import { trafficAccountApi, TrafficAccountItem } from '../../api/trafficAccount';
import { configApi } from '../../api/config';
import dayjs from 'dayjs';

const { Text, Title } = Typography;
const TYPE_COLORS: Record<string, string> = {
  小红书: 'volcano', 抖音: 'blue', 咸鱼: 'gold', B站: 'purple', 视频号: 'green',
};
const TRAFFIC_LEVELS = ['优', '中', '差'];
const YES_NO = ['是', '否'];

interface ColumnDef { key: string; label: string; custom: boolean }

const TrafficAccountPage: React.FC = () => {
  const [items, setItems] = useState<TrafficAccountItem[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TrafficAccountItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [newType, setNewType] = useState('');
  const [colModalOpen, setColModalOpen] = useState(false);
  const [newColLabel, setNewColLabel] = useState('');
  const [form] = Form.useForm();

  const fetchConfig = useCallback(async () => {
    try {
      const { data } = await configApi.get(['traffic.account_types', 'traffic.account_columns']);
      const t = data?.data?.['traffic.account_types'];
      const c = data?.data?.['traffic.account_columns'];
      setTypes(Array.isArray(t) ? t : []);
      setColumns(Array.isArray(c) && c.length ? c : []);
    } catch {}
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await trafficAccountApi.list();
      setItems(data.data ?? []);
    } catch {
      message.error('加载引流账号失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchItems();
  }, [fetchConfig, fetchItems]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record: TrafficAccountItem) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      registerDate: record.registerDate ? dayjs(record.registerDate) : null,
      banDate: record.banDate ? dayjs(record.banDate) : null,
      ...(record.extra || {}),
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const extra: Record<string, any> = {};
    const base: any = {};
    for (const [k, v] of Object.entries(values)) {
      const col = columns.find((c) => c.key === k);
      if (col?.custom) extra[k] = v;
      else if (k === 'registerDate' || k === 'banDate') base[k] = v ? dayjs(v as any).format('YYYY-MM-DD') : null;
      else base[k] = v;
    }
    const payload = { ...base, extra };
    setSubmitting(true);
    try {
      if (editing) {
        await trafficAccountApi.update(editing.id, payload);
        message.success('已更新');
      } else {
        await trafficAccountApi.create(payload);
        message.success('已添加');
      }
      setModalOpen(false);
      fetchItems();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const addType = async () => {
    const t = newType.trim();
    if (!t) return;
    if (types.includes(t)) { message.warning('该类型已存在'); return; }
    const updated = [...types, t];
    setTypes(updated);
    await configApi.update({ 'traffic.account_types': updated });
    setNewType(''); setTypeModalOpen(false);
    message.success('类型已添加');
  };

  const addColumn = async () => {
    const label = newColLabel.trim();
    if (!label) return;
    if (columns.some((c) => c.label === label)) { message.warning('该列已存在'); return; }
    const key = `c_${Date.now().toString(36)}`;
    const updated = [...columns, { key, label, custom: true }];
    setColumns(updated);
    await configApi.update({ 'traffic.account_columns': updated });
    setNewColLabel('');
    message.success('列已添加');
  };

  const removeColumn = async (key: string) => {
    const updated = columns.filter((c) => c.key !== key);
    setColumns(updated);
    await configApi.update({ 'traffic.account_columns': updated });
  };

  const moveColumn = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= columns.length) return;
    const updated = [...columns];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    setColumns(updated);
    await configApi.update({ 'traffic.account_columns': updated });
  };

  const openFolder = (path?: string | null) => {
    if (!path) { message.warning('请先填写图片文件夹路径'); return; }
    const api = (window as any).electronAPI;
    if (api?.openFolder) api.openFolder(path).catch(() => message.info(`文件夹路径：${path}`));
    else { navigator.clipboard?.writeText(path); message.info(`已复制文件夹路径：${path}`); }
  };

  const renderField = (col: ColumnDef, r: TrafficAccountItem): React.ReactNode => {
    const v = col.custom ? r.extra?.[col.key] : (r as any)[col.key];
    if (col.key === 'type') return <Tag color={TYPE_COLORS[v] || 'default'}>{v}</Tag>;
    if (col.key === 'trafficLevel') return v ? <Tag color={v === '优' ? 'green' : v === '中' ? 'gold' : 'red'}>{v}</Tag> : '-';
    if (col.key === 'riskPopped' || col.key === 'banned') return v === '是' ? <Tag color="green">是</Tag> : v === '否' ? <Tag color="red">否</Tag> : '-';
    if (col.key === 'accountId') return v ? <Text copyable>{v}</Text> : '-';
    if (col.key === 'imageSourceNote') return (
      <Space size={4}>
        <Text ellipsis style={{ maxWidth: 90 }}>{v || '-'}</Text>
        <Button size="small" type="link" icon={<FolderOpenOutlined />} onClick={() => openFolder(r.imageFolder)}>文件夹</Button>
      </Space>
    );
    return v || '-';
  };

  const tableColumns = [
    ...columns.map((col) => ({
      title: col.label, key: col.key, dataIndex: col.custom ? undefined : col.key, width: 110,
      render: (_: unknown, r: TrafficAccountItem) => renderField(col, r),
    })),
    {
      title: '操作', key: 'actions', width: 120, fixed: 'right' as const,
      render: (_: unknown, r: TrafficAccountItem) => (
        <Space size={4}>
          <Button size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={async () => { await trafficAccountApi.remove(r.id); fetchItems(); }}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>引流账号管理</Title>
          <Text type="secondary">管理小红书、抖音、咸鱼、B站、视频号等引流账号</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchItems} loading={loading}>刷新</Button>
          <Button icon={<TagsOutlined />} onClick={() => setTypeModalOpen(true)}>管理类型</Button>
          <Button icon={<SettingOutlined />} onClick={() => setColModalOpen(true)}>列设置</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加账号</Button>
        </Space>
      </div>
      <Table rowKey="id" columns={tableColumns} dataSource={items} loading={loading} scroll={{ x: 2200 }} pagination={{ pageSize: 20 }} />

      {/* 账号编辑/新增 */}
      <Modal
        title={editing ? '编辑引流账号' : '添加引流账号'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        confirmLoading={submitting}
        width={760}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={8}><Form.Item name="type" label="平台" rules={[{ required: true, message: '请选择类型' }]}><Select options={types.map((t) => ({ value: t, label: t }))} placeholder="选择类型" /></Form.Item></Col>
            <Col span={8}><Form.Item name="code" label="编号"><Input placeholder="例如 XHS-001" /></Form.Item></Col>
            <Col span={8}><Form.Item name="trafficLevel" label="流量"><Select options={TRAFFIC_LEVELS.map((v) => ({ value: v, label: v }))} placeholder="优/中/差" allowClear /></Form.Item></Col>
            <Col span={8}><Form.Item name="accountStyle" label="账号风格"><Input placeholder="例如 高冷 / 甜妹" /></Form.Item></Col>
            <Col span={8}><Form.Item name="nickname" label="昵称" rules={[{ required: true, message: '请输入昵称' }]}><Input placeholder="昵称" /></Form.Item></Col>
            <Col span={8}><Form.Item name="accountId" label="ID"><Input placeholder="账号ID / 主页链接" /></Form.Item></Col>
            <Col span={8}><Form.Item name="wifi" label="WiFi"><Input placeholder="WiFi名称" /></Form.Item></Col>
            <Col span={8}><Form.Item name="wifiRegion" label="WiFi地区"><Input placeholder="例如 杭州" /></Form.Item></Col>
            <Col span={8}><Form.Item name="riskPopped" label="是否弹过风险"><Select options={YES_NO.map((v) => ({ value: v, label: v }))} allowClear /></Form.Item></Col>
            <Col span={8}><Form.Item name="riskNote" label="风险备注"><Input placeholder="风险说明" /></Form.Item></Col>
            <Col span={8}><Form.Item name="banned" label="是否封禁过"><Select options={YES_NO.map((v) => ({ value: v, label: v }))} allowClear /></Form.Item></Col>
            <Col span={8}><Form.Item name="banNote" label="封禁备注"><Input placeholder="封禁说明" /></Form.Item></Col>
            <Col span={8}><Form.Item name="phone" label="注册手机号"><Input placeholder="手机号" /></Form.Item></Col>
            <Col span={8}><Form.Item name="promotionContact" label="地推联系人"><Input placeholder="地推联系人" /></Form.Item></Col>
            <Col span={8}><Form.Item name="realName" label="实名"><Input placeholder="实名姓名" /></Form.Item></Col>
            <Col span={8}><Form.Item name="registerDate" label="注册日期"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="banDate" label="封禁日期"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="imageSourceNote" label="图片来源备注"><Input placeholder="图片来源说明" /></Form.Item></Col>
            <Col span={12}><Form.Item name="imageFolder" label="本地图片文件夹"><Input addonAfter={<Button type="link" size="small" icon={<FolderOpenOutlined />} onClick={() => openFolder(form.getFieldValue('imageFolder'))} style={{ padding: 0 }} />} placeholder="本地文件夹路径" /></Form.Item></Col>
            <Col span={24}><Form.Item name="otherNote" label="其他备注"><Input.TextArea rows={2} placeholder="其他备注" /></Form.Item></Col>
            {columns.filter((c) => c.custom).map((c) => (
              <Col span={12} key={c.key}><Form.Item name={c.key} label={c.label}><Input placeholder={`填写 ${c.label}`} /></Form.Item></Col>
            ))}
          </Row>
        </Form>
      </Modal>

      {/* 平台类型管理 */}
      <Modal title="管理平台类型" open={typeModalOpen} onCancel={() => setTypeModalOpen(false)} onOk={addType} okText="添加" cancelText="关闭">
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {types.map((t) => <Tag key={t} color={TYPE_COLORS[t] || 'default'}>{t}</Tag>)}
          </div>
          <Input value={newType} onChange={(e) => setNewType(e.target.value)} onPressEnter={addType} placeholder="输入新平台类型，例如 快手" />
        </div>
      </Modal>

      {/* 列设置：添加列 + 左右移动 */}
      <Modal title="列设置" open={colModalOpen} onCancel={() => setColModalOpen(false)} footer={null} width={520}>
        <div style={{ marginTop: 12 }}>
          <Space style={{ width: '100%', marginBottom: 12 }}>
            <Input value={newColLabel} onChange={(e) => setNewColLabel(e.target.value)} onPressEnter={addColumn} placeholder="新列名称" style={{ width: 220 }} />
            <Button type="primary" icon={<PlusOutlined />} onClick={addColumn}>添加列</Button>
          </Space>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {columns.map((c, i) => (
              <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <Text style={{ flex: 1 }}>{c.label}{c.custom ? <Tag color="cyan" style={{ marginLeft: 8 }}>自定义</Tag> : null}</Text>
                <Space size={4}>
                  <Button size="small" icon={<LeftOutlined />} disabled={i === 0} onClick={() => moveColumn(i, -1)} />
                  <Button size="small" icon={<RightOutlined />} disabled={i === columns.length - 1} onClick={() => moveColumn(i, 1)} />
                  {c.custom && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeColumn(c.key)} />}
                </Space>
              </div>
            ))}
          </div>
          <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>左右箭头调整列顺序，自定义列可删除。</Text>
        </div>
      </Modal>
    </div>
  );
};

export default TrafficAccountPage;
