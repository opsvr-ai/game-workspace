// craftsman-ignore: TS001,TS002
import React, { memo, useEffect, useState } from 'react';
import {
  Drawer,
  Descriptions,
  Button,
  Tag,
  Input,
  Select,
  Switch,
  Space,
  Typography,
  message,
  Form,
  Divider,
  Spin,
  Empty,
  Tooltip,
} from 'antd';
import { EditOutlined, SaveOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { customersApi } from '../api/customers';

const { Text } = Typography;
const { TextArea } = Input;

interface CustomerDetailDrawerProps {
  customerId: string | null;
  customerCode?: string;
  open: boolean;
  onClose: () => void;
}

interface ProfileData {
  age?: number | null;
  address?: string | null;
  occupation?: string | null;
  preferredGame?: string | null;
  preferredMode?: string | null;
  preferredSingleDouble?: string | null;
  preferredTime?: string | null;
  playFrequency?: string | null;
  pricePreference?: string | null;
  relationshipStatus?: string | null;
  afraidWechatCheck?: boolean;
  likedVoice?: string | null;
  myVoice?: string | null;
  likesTalkative?: boolean;
  likesSkill?: boolean;
  likesBoth?: boolean;
  customNotes?: string | null;
}

interface FollowUp {
  id: string;
  content: string;
  nextAction?: string | null;
  createdAt: string;
  playerId?: string | null;
  adminId?: string | null;
}

const frequencyOptions = [
  { label: '每天', value: '每天' },
  { label: '每周2-3次', value: '每周2-3次' },
  { label: '每周1次', value: '每周1次' },
  { label: '偶尔', value: '偶尔' },
  { label: '首次', value: '首次' },
];

const voiceOptions = [
  { label: '少女音', value: '少女音' },
  { label: '御姐音', value: '御姐音' },
  { label: '甜妹音', value: '甜妹音' },
  { label: '少御音', value: '少御音' },
  { label: '青年音', value: '青年音' },
  { label: '大叔音', value: '大叔音' },
  { label: '少年音', value: '少年音' },
];

const CustomerDetailDrawer: React.FC<CustomerDetailDrawerProps> = ({ customerId, customerCode, open, onClose }) => {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm();
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [newFollowUp, setNewFollowUp] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadData = async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const [profileRes, followUpsRes] = await Promise.all([
        customersApi.getProfile(customerId),
        customersApi.getFollowUps(customerId),
      ]);
      setProfile(profileRes.data.data ?? null);
      setFollowUps(followUpsRes.data.data ?? []);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      message.error(err?.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && customerId) loadData();
  }, [open, customerId]);

  const startEdit = () => {
    if (profile) form.setFieldsValue(profile);
    setEditing(true);
  };
  const cancelEdit = () => {
    form.resetFields();
    setEditing(false);
  };

  const saveProfile = async () => {
    if (!customerId) return;
    try {
      const values = await form.validateFields();
      setSaving(true);
      await customersApi.updateProfile(customerId, values);
      setProfile(values as ProfileData);
      setEditing(false);
      message.success('画像已更新');
    } catch (e: unknown) {
      const err = e as { errorFields?: unknown[]; response?: { data?: { message?: string } } };
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const addFollowUp = async () => {
    if (!newFollowUp.trim() || !customerId) return;
    try {
      await customersApi.addFollowUp(customerId, {
        content: newFollowUp.trim(),
        nextAction: nextAction.trim() || undefined,
      });
      message.success('跟进已记录');
      setNewFollowUp('');
      setNextAction('');
      loadData();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      message.error(err?.response?.data?.message || '添加失败');
    }
  };

  const deriveType = (p: ProfileData | null): { label: string; color: string } => {
    if (!p) return { label: '未分类', color: 'default' };
    const score =
      (p.playFrequency === '每天' ? 3 : p.playFrequency === '每周2-3次' ? 2 : p.playFrequency === '每周1次' ? 1 : 0) +
      (p.pricePreference === '高' ? 2 : p.pricePreference === '中' ? 1 : 0);
    if (score >= 4) return { label: 'VIP', color: 'gold' };
    if (score >= 2) return { label: '活跃', color: 'green' };
    if (score >= 1) return { label: '普通', color: 'blue' };
    return { label: '新客', color: 'default' };
  };

  const ct = deriveType(profile);

  return (
    <Drawer
      title={
        <Space>
          {customerCode && (
            <Text strong style={{ fontSize: 15 }}>
              {customerCode}
            </Text>
          )}
          <Tag color={ct.color}>{ct.label}</Tag>
        </Space>
      }
      open={open}
      onClose={onClose}
      width={520}
      styles={{ body: { paddingTop: 0 } }}
    >
      <Spin spinning={loading}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text strong style={{ fontSize: 14 }}>
              📋 客户画像
            </Text>
            {!editing ? (
              <Tooltip title="编辑画像">
                <Button type="link" size="small" icon={React.createElement(EditOutlined)} onClick={startEdit}>
                  编辑
                </Button>
              </Tooltip>
            ) : (
              <Space>
                <Button size="small" icon={React.createElement(CloseOutlined)} onClick={cancelEdit}>
                  取消
                </Button>
                <Button
                  type="primary"
                  size="small"
                  icon={React.createElement(SaveOutlined)}
                  onClick={saveProfile}
                  loading={saving}
                >
                  保存
                </Button>
              </Space>
            )}
          </div>
          {editing ? (
            <Form form={form} layout="vertical" size="small" initialValues={profile || {}}>
              <Space style={{ width: '100%' }} direction="vertical" size={8}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Form.Item name="age" label="年龄" style={{ marginBottom: 0 }}>
                    <Input type="number" />
                  </Form.Item>
                  <Form.Item name="occupation" label="职业" style={{ marginBottom: 0 }}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="preferredGame" label="偏好游戏" style={{ marginBottom: 0 }}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="preferredMode" label="偏好模式" style={{ marginBottom: 0 }}>
                    <Select
                      allowClear
                      options={[
                        { label: '排位', value: '排位' },
                        { label: '匹配', value: '匹配' },
                        { label: '娱乐', value: '娱乐' },
                        { label: '三角洲', value: '三角洲' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="preferredSingleDouble" label="单/双陪" style={{ marginBottom: 0 }}>
                    <Select
                      allowClear
                      options={[
                        { label: '单陪', value: '单陪' },
                        { label: '双陪', value: '双陪' },
                        { label: '皆可', value: '皆可' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="playFrequency" label="频率" style={{ marginBottom: 0 }}>
                    <Select allowClear options={frequencyOptions} />
                  </Form.Item>
                  <Form.Item name="pricePreference" label="价格偏好" style={{ marginBottom: 0 }}>
                    <Select
                      allowClear
                      options={[
                        { label: '低', value: '低' },
                        { label: '中', value: '中' },
                        { label: '高', value: '高' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="preferredTime" label="偏好时间" style={{ marginBottom: 0 }}>
                    <Select
                      allowClear
                      options={[
                        { label: '白天', value: '白天' },
                        { label: '晚上', value: '晚上' },
                        { label: '深夜', value: '深夜' },
                        { label: '周末', value: '周末' },
                      ]}
                    />
                  </Form.Item>
                </div>
                <Divider style={{ margin: '4px 0' }}>声音 / 沟通</Divider>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Form.Item name="likedVoice" label="喜欢声音" style={{ marginBottom: 0 }}>
                    <Select allowClear options={voiceOptions.slice(0, 4)} />
                  </Form.Item>
                  <Form.Item name="myVoice" label="自己声音" style={{ marginBottom: 0 }}>
                    <Select allowClear options={voiceOptions.slice(4)} />
                  </Form.Item>
                  <Form.Item name="relationshipStatus" label="情感状态" style={{ marginBottom: 0 }}>
                    <Select
                      allowClear
                      options={[
                        { label: '单身', value: '单身' },
                        { label: '恋爱中', value: '恋爱中' },
                        { label: '已婚', value: '已婚' },
                        { label: '未知', value: '未知' },
                      ]}
                    />
                  </Form.Item>
                </div>
                <Divider style={{ margin: '4px 0' }}>特征标记</Divider>
                <Space size="middle">
                  <Form.Item
                    name="afraidWechatCheck"
                    label="怕查微信"
                    valuePropName="checked"
                    style={{ marginBottom: 0 }}
                  >
                    <Switch />
                  </Form.Item>
                  <Form.Item name="likesTalkative" label="喜欢话多" valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Switch />
                  </Form.Item>
                  <Form.Item name="likesSkill" label="喜欢技术" valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Switch />
                  </Form.Item>
                  <Form.Item name="likesBoth" label="话多+技术" valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Switch />
                  </Form.Item>
                </Space>
                <Form.Item name="customNotes" label="自定义备注" style={{ marginBottom: 0 }}>
                  <TextArea rows={2} />
                </Form.Item>
              </Space>
            </Form>
          ) : profile ? (
            <Descriptions size="small" column={2} colon={false}>
              {[
                'age',
                'occupation',
                'preferredGame',
                'preferredMode',
                'preferredSingleDouble',
                'playFrequency',
                'pricePreference',
                'preferredTime',
                'likedVoice',
                'myVoice',
                'relationshipStatus',
              ].map((k) => (
                <Descriptions.Item
                  key={k}
                  label={
                    {
                      age: '年龄',
                      occupation: '职业',
                      preferredGame: '偏好游戏',
                      preferredMode: '模式',
                      preferredSingleDouble: '单/双陪',
                      playFrequency: '频率',
                      pricePreference: '价格偏好',
                      preferredTime: '时间',
                      likedVoice: '喜欢声音',
                      myVoice: '自己声音',
                      relationshipStatus: '情感状态',
                    }[k]
                  }
                >
                  {profile[k as keyof ProfileData] ?? '-'}
                </Descriptions.Item>
              ))}
            </Descriptions>
          ) : (
            <Empty description="尚未创建画像" image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <Button type="primary" size="small" onClick={startEdit}>
                创建画像
              </Button>
            </Empty>
          )}
          {profile && !editing && (
            <Space size={4} style={{ marginTop: 8 }} wrap>
              {profile.afraidWechatCheck && <Tag color="orange">怕查微信</Tag>}
              {profile.likesTalkative && <Tag color="volcano">喜欢话多</Tag>}
              {profile.likesSkill && <Tag color="cyan">喜欢技术</Tag>}
              {profile.likesBoth && <Tag color="purple">话多+技术</Tag>}
              {profile.customNotes && <Tag color="geekblue">{profile.customNotes}</Tag>}
            </Space>
          )}
        </div>
        <Divider style={{ margin: '8px 0' }} />
        <div>
          <Text strong style={{ fontSize: 14 }}>
            📝 跟进记录
          </Text>
          <div style={{ marginTop: 8 }}>
            <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
              <Input
                size="small"
                placeholder="添加跟进..."
                value={newFollowUp}
                onChange={(e) => setNewFollowUp(e.target.value)}
                onPressEnter={addFollowUp}
              />
              <Input
                size="small"
                placeholder="下一步（可选）"
                value={nextAction}
                onChange={(e) => setNextAction(e.target.value)}
                style={{ width: 130 }}
              />
              <Button
                type="primary"
                size="small"
                icon={React.createElement(PlusOutlined)}
                onClick={addFollowUp}
                disabled={!newFollowUp.trim()}
              >
                添加
              </Button>
            </Space.Compact>
            {followUps.length > 0 ? (
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {followUps.map((f) => (
                  <div key={f.id} style={{ borderLeft: '2px solid #1677ff', paddingLeft: 10, marginBottom: 10 }}>
                    <Text style={{ fontSize: 13 }}>{f.content}</Text>
                    {f.nextAction && (
                      <Tag color="green" style={{ fontSize: 10, marginLeft: 4 }}>
                        ▶ {f.nextAction}
                      </Tag>
                    )}
                    <br />
                    <Text type="secondary" style={{ fontSize: 10 }}>
                      {new Date(f.createdAt).toLocaleString('zh-CN')}
                      {f.playerId ? ' · 陪玩' : ''}
                      {f.adminId ? ' · 管理员' : ''}
                    </Text>
                  </div>
                ))}
              </div>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                暂无跟进记录
              </Text>
            )}
          </div>
        </div>
      </Spin>
    </Drawer>
  );
};

const MemoizedCustomerDetailDrawer = memo(CustomerDetailDrawer);
export { MemoizedCustomerDetailDrawer as CustomerDetailDrawer };
