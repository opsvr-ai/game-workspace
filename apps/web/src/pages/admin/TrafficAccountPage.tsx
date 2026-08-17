// craftsman-ignore: TS001,TS002
import React, { useCallback, useEffect, useState } from 'react';
import {
  Button, Space, Table, Typography, Tag, message, Modal, Form, Input, Select, Popconfirm, Row, Col, DatePicker,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, DeleteOutlined, TagsOutlined, FolderOpenOutlined,
} from '@ant-design/icons';
import { trafficAccountApi, TrafficAccountItem } from '../../api/trafficAccount';
import { configApi } from '../../api/config';
import dayjs from 'dayjs';

const { Text, Title } = Typography;
const TYPE_COLORS: Record<string, string> = {
  小红书: 'volcano',
  抖音: 'blue',
  咸鱼: 'gold',
  B站: 'purple',
  视频号: 'green',
};
const TRAFFIC_LEVELS = ['优', '中', '差'];
const YES_NO = ['是', '否'];

const TrafficAccountPage: React.FC = () => {
  const [items, setItems] = useState<TrafficAccountItem[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TrafficAccountItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [newType, setNewType] = useState('');
  const [form] = Form.useForm();

  const fetchTypes = useCallback(async () => {
    try {
      const { data } = await configApi.get(['traffic.account_types']);
      const list = data?.data?.['traffic.account_types'];
      setTypes(Array.isArray(list) ? list : []);
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
    fetchTypes();
    fetchItems();
  }, [fetchTypes, fetchItems]);

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
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      registerDate: values.registerDate ? dayjs(values.registerDate).format('YYYY-MM-DD') : null,
      banDate: values.banDate ? dayjs(values.banDate).format('YYYY-MM-DD') : null,
    };
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
    if (types.includes(t)) {
      message.warning('该类型已存在');
      return;
    }
    const updated = [...types, t];
    setTypes(updated);
    await configApi.update({ 'traffic.account_types': updated });
    setNewType('');
    setTypeModalOpen(false);
    message.success('类型已添加');
  };

  const openFolder = (path?: string | null) => {
    if (!path) {
      message.warning('请先填写图片文件夹路径');
      return;
    }
    const api = (window as any).electronAPI;
    if (api?.openFolder) {
      api.openFolder(path).catch(() => message.info(`文件夹路径：${path}`));
    } else {
      navigator.clipboard?.writeText(path);
      message.info(`已复制文件夹路径：${path}`);
    }
  };

  const tag = (v?: string | null, yesColor = 'green', noColor = 'red') => {
    if (v === '是') return <Tag color={yesColor}>是</Tag>;
    if (v === '否') return <Tag color={noColor}>否</Tag>;
    return '-';
  };

  const columns = [
    { title: '平台', dataIndex: 'type', key: 'type', width: 90, fixed: 'left' as const,
      render: (v: string) => <Tag color={TYPE_COLORS[v] || 'default'}>{v}</Tag> },
    { title: '编号', dataIndex: 'code', key: 'code', width: 90, render: (v?: string | null) => v || '-' },
    { title: '流量', dataIndex: 'trafficLevel', key: 'trafficLevel', width: 70,
      render: (v?: string | null) => v ? <Tag color={v === '优' ? 'green' : v === '中' ? 'gold' : 'red'}>{v}</Tag> : '-' },
    { title: '账号风格', dataIndex: 'accountStyle', key: 'accountStyle', width: 110, render: (v?: string | null) => v || '-' },
    { title: '昵称', dataIndex: 'nickname', key: 'nickname', width: 130 },
    { title: 'ID', dataIndex: 'accountId', key: 'accountId', width: 130, render: (v?: string | null) => v ? <Text copyable>{v}</Text> : '-' },
    { title: 'WiFi', dataIndex: 'wifi', key: 'wifi', width: 110, render: (v?: string | null) => v || '-' },
    { title: 'WiFi地区', dataIndex: 'wifiRegion', key: 'wifiRegion', width: 100, render: (v?: string | null) => v || '-' },
    { title: '弹过风险', dataIndex: 'riskPopped', key: 'riskPopped', width: 90, render: (v?: string | null) => tag(v) },
    { title: '风险备注', dataIndex: 'riskNote', key: 'riskNote', width: 120, render: (v?: string | null) => v || '-' },
    { title: '封禁过', dataIndex: 'banned', key: 'banned', width: 80, render: (v?: string | null) => tag(v) },
    { title: '封禁备注', dataIndex: 'banNote', key: 'banNote', width: 120, render: (v?: string | null) => v || '-' },
    { title: '注册手机号', dataIndex: 'phone', key: 'phone', width: 120, render: (v?: string | null) => v || '-' },
    { title: '地推联系人', dataIndex: 'promotionContact', key: 'promotionContact', width: 110, render: (v?: string | null) => v || '-' },
    { title: '实名', dataIndex: 'realName', key: 'realName', width: 90, render: (v?: string | null) => v || '-' },
    { title: '注册日期', dataIndex: 'registerDate', key: 'registerDate', width: 110, render: (v?: string | null) => v || '-' },
    { title: '封禁日期', dataIndex: 'banDate', key: 'banDate', width: 110, render: (v?: string | null) => v || '-' },
    {
      title: '图片来源备注', dataIndex: 'imageSourceNote', key: 'imageSourceNote', width: 170,
      render: (v?: string | null, r?: TrafficAccountItem) => (
        <Space size={4}>
          <Text ellipsis style={{ maxWidth: 90 }}>{v || '-'}</Text>
          <Button size="small" type="link" icon={<FolderOpenOutlined />} onClick={() => openFolder(r?.imageFolder)}>文件夹</Button>
        </Space>
      ),
    },
    { title: '其他备注', dataIndex: 'otherNote', key: 'otherNote', width: 140, render: (v?: string | null) => v || '-' },
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
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加账号</Button>
        </Space>
      </div>
      <Table rowKey="id" columns={columns} dataSource={items} loading={loading} scroll={{ x: 2200 }} pagination={{ pageSize: 20 }} />

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
            <Col span={12}>
              <Form.Item name="imageFolder" label="本地图片文件夹">
                <Input addonAfter={<Button type="link" size="small" icon={<FolderOpenOutlined />} onClick={() => openFolder(form.getFieldValue('imageFolder'))} style={{ padding: 0 }} />} placeholder="本地文件夹路径" />
              </Form.Item>
            </Col>
            <Col span={24}><Form.Item name="otherNote" label="其他备注"><Input.TextArea rows={2} placeholder="其他备注" /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title="管理平台类型"
        open={typeModalOpen}
        onCancel={() => setTypeModalOpen(false)}
        onOk={addType}
        okText="添加"
        cancelText="关闭"
      >
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {types.map((t) => <Tag key={t} color={TYPE_COLORS[t] || 'default'}>{t}</Tag>)}
          </div>
          <Input value={newType} onChange={(e) => setNewType(e.target.value)} onPressEnter={addType} placeholder="输入新平台类型，例如 快手" />
        </div>
      </Modal>
    </div>
  );
};

export default TrafficAccountPage;
