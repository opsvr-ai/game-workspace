import React, { useEffect, useState, useCallback } from 'react';
  Card,
  Descriptions,
  Tag,
  Timeline,
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Skeleton,
  Space,
  Typography,
  message,
  Row,
  Col,
} from 'antd';
import { SaveOutlined,
  ArrowLeftOutlined,
  EditOutlined,
  ReloadOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { customersApi } from '../api/customers';

const { Text, Title } = Typography;
const { TextArea } = Input;

// ── Helpers ────────────────────────────────────────────────────

const statusMap: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: '活跃', color: 'green' },
  FOLLOW_UP: { label: '待跟进', color: 'orange' },
  LOST: { label: '流失', color: 'red' },
  PENDING_DEVELOPMENT: { label: '待开发', color: 'default' },
};

const platformLabels: Record<string, string> = {
  WECHAT: '微信',
  QQ: 'QQ',
  PHONE: '电话',
  OTHER: '其他',
};

const orderTypeLabels: Record<string, string> = {
  NEW: '首单',
  RENEW: '续单',
  REPURCHASE: '复购',
  TIP: '打赏',
};

const orderStatusLabels: Record<string, { label: string; color: string }> = {
  PENDING: { label: '待接单', color: 'blue' },
  GRABBED: { label: '已接单', color: 'cyan' },
  CONFIRMED: { label: '已确认', color: 'geekblue' },
  DONE: { label: '已完成', color: 'green' },
  CANCELLED: { label: '已取消', color: 'default' },
};

const formatDate = (d: string | null | undefined) => {
  if (!d) return '-';
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

// ── Component ──────────────────────────────────────────────────

const CustomerDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Data states
  const [customer, setCustomer] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [customerType, setCustomerType] = useState<any>(null);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);

  // Loading states
  const [loadingCustomer, setLoadingCustomer] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingFollowUps, setLoadingFollowUps] = useState(true);

  // Modal states
  const [submittingProfile, setSubmittingProfile] = useState(false);
  const [profileForm] = Form.useForm();

  // Follow-up form
  const [followUpContent, setFollowUpContent] = useState('');
  const [followUpNextAction, setFollowUpNextAction] = useState('');
  const [submittingFollowUp, setSubmittingFollowUp] = useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // ── Data fetching ──────────────────────────────────────────

  const fetchCustomer = useCallback(async () => {
    if (!id) return;
    setLoadingCustomer(true);
    try {
      const { data } = await customersApi.getById(id);
      setCustomer(data.data);
      setError(null);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '加载客户信息失败';
      setError(msg);
    } finally {
      setLoadingCustomer(false);
    }
  }, [id]);

  const fetchProfile = useCallback(async () => {
    if (!id) return;
    setLoadingProfile(true);
    try {
      const { data } = await customersApi.getProfile(id);
      setProfile(data.data);
    } catch {
      // profile may not exist yet — non-critical
    } finally {
      setLoadingProfile(false);
    }
  }, [id]);

  const fetchType = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await customersApi.getType(id);
      setCustomerType(data.data);
    } catch {
      // non-critical
    }
  }, [id]);

  const fetchOrders = useCallback(async () => {
    if (!id) return;
    setLoadingOrders(true);
    try {
      const { data } = await customersApi.getOrders(id);
      setOrders(data.data ?? []);
    } finally {
      setLoadingOrders(false);
    }
  }, [id]);

  const fetchFollowUps = useCallback(async () => {
    if (!id) return;
    setLoadingFollowUps(true);
    try {
      const { data } = await customersApi.getFollowUps(id);
      setFollowUps(data.data ?? []);
    } finally {
      setLoadingFollowUps(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCustomer();
    fetchProfile();
    fetchType();
    fetchOrders();
    fetchFollowUps();
  }, [fetchCustomer, fetchProfile, fetchType, fetchOrders, fetchFollowUps]);

  // ── Profile edit ───────────────────────────────────────────


  const handleProfileSubmit = async () => {
    try {
      const values = await profileForm.validateFields();
      setSubmittingProfile(true);
      await customersApi.updateProfile(id!, values);
      message.success('客户画像已更新');
      setProfileModalOpen(false);
      fetchProfile();
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.response?.data?.message || err?.message || '更新失败');
    } finally {
      setSubmittingProfile(false);
    }
  };

  // ── Follow-up submit ───────────────────────────────────────

  const handleFollowUpSubmit = async () => {
    if (!followUpContent.trim()) {
      message.warning('请输入跟进内容');
      return;
    }
    setSubmittingFollowUp(true);
    try {
      await customersApi.addFollowUp(id!, {
        content: followUpContent,
        nextAction: followUpNextAction || undefined,
      });
      message.success('跟进记录已添加');
      setFollowUpContent('');
      setFollowUpNextAction('');
      fetchFollowUps();
      fetchCustomer(); // refresh status
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || '添加失败');
    } finally {
      setSubmittingFollowUp(false);
    }
  };

  // ── Derived values ─────────────────────────────────────────

  const statusInfo = statusMap[customer?.status] ?? { label: customer?.status ?? '未知', color: 'default' };
  const platformLabel = platformLabels[customer?.platform] ?? customer?.platform ?? '-';
  const orderCount = orders.length;

  // Order table columns
  const orderColumns = [
    {
      title: '日期',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (v: string) => formatDate(v),
    },
    {
      title: '陪玩',
      dataIndex: ['companion', 'user', 'username'],
      key: 'companion',
      width: 120,
      render: (v: string) => v ?? <Text type="secondary">-</Text>,
    },
    {
      title: '时长',
      dataIndex: 'duration',
      key: 'duration',
      width: 80,
      render: (v: number | null) => v != null ? `${v}h` : '-',
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 100,
      render: (v: number) => (
        <span style={{ color: '#FF4757', fontWeight: 600 }}>¥{v.toFixed(2)}</span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 80,
      render: (v: string) => <Tag>{orderTypeLabels[v] ?? v}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (v: string) => {
        const s = orderStatusLabels[v] ?? { label: v, color: 'default' };
        return <Tag color={s.color}>{s.label}</Tag>;
      },
    },
  ];

  // ── Render ─────────────────────────────────────────────────

  if (error && !customer) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <Text type="danger" style={{ fontSize: 16 }}>{error}</Text>
        <br />
        <Button style={{ marginTop: 16 }} onClick={() => navigate(-1)}>
          返回
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* ── Header ──────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Space>
          <Button
            type="text"
            icon={React.createElement(ArrowLeftOutlined)}
            onClick={() => navigate(-1)}
          >
            返回
          </Button>
          <Title level={4} style={{ margin: 0 }}>
            客户详情
          </Title>
        </Space>
        <Button
          icon={React.createElement(ReloadOutlined)}
          onClick={() => {
            fetchCustomer();
            fetchProfile();
            fetchType();
            fetchOrders();
            fetchFollowUps();
          }}
        >
          刷新
        </Button>
      </div>

      {/* ── Section 1: Basic Info ────────────────────────── */}
      <Card title="基本信息" style={{ marginBottom: 16 }} loading={loadingCustomer}>
        {customer ? (
          <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small" bordered>
            <Descriptions.Item label="客户编号">
              <Text code>{customer.customerCode}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="微信号">{customer.wechatId}</Descriptions.Item>
            <Descriptions.Item label="平台">
              <Tag>{platformLabel}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="平台账号">{customer.platformAccount || '-'}</Descriptions.Item>
            <Descriptions.Item label="累计消费">
              <span style={{ color: '#FF4757', fontWeight: 700, fontSize: 16 }}>
                ¥{(customer.totalSpent ?? 0).toFixed(2)}
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="订单数">
              <Text strong>{orderCount}</Text>
              {customerType && (
                <Tag style={{ marginLeft: 8 }} color={customerType.type === 'FIRST' ? 'blue' : 'purple'}>
                  {customerType.type === 'FIRST' ? '首单客户' : '复购客户'}
                </Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="客户状态">
              <Tag color={statusInfo.color}>{statusInfo.label}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="归属陪玩">
              {customer.companion?.user?.username ?? <Text type="secondary">未分配</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="最后服务日期">
              {orders.length > 0 ? formatDate(orders[0].createdAt) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="封号状态">
              {customer.isAccountBanned ? <Tag color="red">已封号</Tag> : <Tag color="green">正常</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="被客户删除">
              {customer.isDeletedByCustomer ? <Tag color="orange">是</Tag> : <Tag>否</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="备注">{customer.notes || '-'}</Descriptions.Item>
          </Descriptions>
        ) : (
          <Skeleton active paragraph={{ rows: 6 }} />
        )}
      </Card>

      {/* ── Section 2: Contact Info ──────────────────────── */}
      <Card title="联系方式" style={{ marginBottom: 16 }} loading={loadingCustomer}>
        {customer ? (
          <Descriptions column={3} size="small" bordered>
            <Descriptions.Item label="微信号">{customer.wechatId}</Descriptions.Item>
            <Descriptions.Item label="QQ">
              {customer.platform === 'QQ' ? customer.platformAccount : '未绑定'}
            </Descriptions.Item>
            <Descriptions.Item label="电话">
              {customer.platform === 'PHONE' ? customer.platformAccount : '未绑定'}
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Skeleton active paragraph={{ rows: 2 }} />
        )}
      </Card>

            {/* ── Section 3: Profile Card — direct edit ────────── */}
      <Card
        title="客户画像"
        style={{ marginBottom: 16 }}
        loading={loadingProfile}
        extra={
          <Button type="primary" size="small" icon={React.createElement(SaveOutlined)}
            onClick={handleProfileSubmit} loading={submittingProfile}>
            保存
          </Button>
        }
      >
        <Form form={profileForm} layout="vertical">
          <Row gutter={16}>
            <Col span={8}><Form.Item name="age" label="年龄"><InputNumber min={0} max={150} style={{ width: '100%' }} placeholder="年龄" /></Form.Item></Col>
            <Col span={16}><Form.Item name="address" label="地址"><Input placeholder="地址" /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}><Form.Item name="occupation" label="职业"><Input placeholder="职业" /></Form.Item></Col>
            <Col span={8}><Form.Item name="preferredGame" label="偏好游戏"><Input placeholder="偏好游戏" /></Form.Item></Col>
            <Col span={8}><Form.Item name="preferredMode" label="偏好模式"><Input placeholder="偏好模式" /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}><Form.Item name="preferredSingleDouble" label="单/双人"><Select placeholder="选择" allowClear><Select.Option value="单人">单人</Select.Option><Select.Option value="双人">双人</Select.Option><Select.Option value="均可">均可</Select.Option></Select></Form.Item></Col>
            <Col span={8}><Form.Item name="preferredTime" label="偏好时间"><Input placeholder="如: 晚上8-12点" /></Form.Item></Col>
            <Col span={8}><Form.Item name="playFrequency" label="游戏频率"><Select placeholder="选择" allowClear><Select.Option value="每天">每天</Select.Option><Select.Option value="每周数次">每周数次</Select.Option><Select.Option value="偶尔">偶尔</Select.Option></Select></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}><Form.Item name="pricePreference" label="价格偏好"><Input placeholder="价格偏好" /></Form.Item></Col>
            <Col span={8}><Form.Item name="relationshipStatus" label="情感状态"><Select placeholder="选择" allowClear><Select.Option value="单身">单身</Select.Option><Select.Option value="恋爱">恋爱</Select.Option><Select.Option value="已婚">已婚</Select.Option><Select.Option value="保密">保密</Select.Option></Select></Form.Item></Col>
            <Col span={8}><Form.Item name="afraidWechatCheck" label="恐微信查岗" valuePropName="checked"><Switch /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}><Form.Item name="likedVoice" label="喜欢的声音"><Input placeholder="喜欢的声音" /></Form.Item></Col>
            <Col span={8}><Form.Item name="myVoice" label="我的声音"><Input placeholder="我的声音" /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}><Form.Item name="likesTalkative" label="喜欢话多的" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={8}><Form.Item name="likesSkill" label="喜欢技术好的" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={8}><Form.Item name="likesBoth" label="两者都喜欢" valuePropName="checked"><Switch /></Form.Item></Col>
          </Row>
          <Form.Item name="customNotes" label="自定义备注"><Input.TextArea rows={3} placeholder="其他备注信息" /></Form.Item>
        </Form>
      </Card>

      {/* ── Old profile modal removed ── */}

      {/* ── Section 4: Smart Analysis ──────────────────────── */}
      <Card title="智能分析" style={{ marginBottom: 16 }} loading={loadingCustomer || loadingOrders}>
        {(() => {
          const totalSpent = customer?.totalSpent ?? 0;
          const orderCount = orders.length;
          const lastOrderDate = orders[0]?.createdAt ? new Date(orders[0].createdAt) : null;
          const daysSinceLastOrder = lastOrderDate
            ? Math.floor((Date.now() - lastOrderDate.getTime()) / 86400000)
            : Infinity;

          const tags: string[] = [];
          if (totalSpent > 500) tags.push('高价值客户');
          else if (totalSpent > 100) tags.push('潜力客户');
          if (orderCount > 5) tags.push('忠实客户');
          if (daysSinceLastOrder > 30 && orderCount > 0) tags.push('流失风险');
          if (customer?.status === 'LOST') tags.push('已流失');
          if (customer?.status === 'FOLLOW_UP') tags.push('待跟进');
          if (tags.length === 0) tags.push('新客户');

          const riskLevel = customer?.status === 'LOST' ? 'high'
            : daysSinceLastOrder > 30 && orderCount > 0 ? 'high'
            : daysSinceLastOrder > 14 && orderCount > 0 ? 'medium'
            : 'low';

          const suggestion = riskLevel === 'high'
            ? '建议尽快主动联系客户，超过30天未消费，存在流失风险'
            : riskLevel === 'medium'
            ? '客户近期活跃度下降，可发送活动优惠或新游戏推荐'
            : orderCount === 0
            ? '新客户尚未下单，建议完善画像并推送首次优惠'
            : '客户状态良好，继续保持日常维护和关系经营';

          return (
            <div>
              <div style={{ marginBottom: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {tags.map(t => (
                  <Tag key={t} color={
                    t.includes('风险') || t.includes('流失') ? 'red'
                    : t.includes('高价值') || t.includes('忠实') ? 'blue'
                    : t.includes('潜力') ? 'green'
                    : 'default'
                  }>{t}</Tag>
                ))}
              </div>
              <div style={{
                padding: '12px 16px',
                background: riskLevel === 'high' ? '#fff2f0' : riskLevel === 'medium' ? '#fff7e6' : '#f6ffed',
                border: `1px solid ${riskLevel === 'high' ? '#ffccc7' : riskLevel === 'medium' ? '#ffe7ba' : '#b7eb8f'}`,
                borderRadius: 8,
              }}>
                <Text style={{ fontSize: 13 }}>
                  {suggestion}
                </Text>
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 16 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>累计消费：¥{totalSpent.toFixed(2)}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>订单数：{orderCount}单</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  最近消费：{lastOrderDate ? formatDate(lastOrderDate.toISOString()) : '暂无'}
                </Text>
              </div>
            </div>
          );
        })()}
      </Card>

      {/* ── Section 5: Service History ────────────────────── */}
      <Card
        title="服务记录"
        style={{ marginBottom: 16 }}
        extra={
          <Text type="secondary">
            {loadingOrders ? '加载中...' : `共 ${orders.length} 单`}
          </Text>
        }
      >
        <Table
          columns={orderColumns}
          dataSource={orders}
          rowKey="id"
          loading={loadingOrders}
          size="small"
          locale={{ emptyText: '暂无服务记录' }}
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 单` }}
        />
      </Card>

      {/* ── Section 6: Follow-up Timeline ─────────────────── */}
      <Card
        title="跟进记录"
        loading={loadingFollowUps}
        extra={
          <Text type="secondary">
            {loadingFollowUps ? '加载中...' : `共 ${followUps.length} 条`}
          </Text>
        }
      >
        {/* Add follow-up form */}
        <div
          style={{
            marginBottom: 24,
            padding: 16,
            background: '#fafafa',
            borderRadius: 8,
            border: '1px solid #f0f0f0',
          }}
        >
          <Text strong style={{ display: 'block', marginBottom: 12 }}>添加跟进记录</Text>
          <Form layout="vertical">
            <Form.Item label="跟进内容" required>
              <TextArea
                rows={3}
                value={followUpContent}
                onChange={(e) => setFollowUpContent(e.target.value)}
                placeholder="输入跟进内容..."
              />
            </Form.Item>
            <Form.Item label="下一步行动">
              <Input
                value={followUpNextAction}
                onChange={(e) => setFollowUpNextAction(e.target.value)}
                placeholder="如: 3天后回访、发送优惠券..."
              />
            </Form.Item>
            <Button
              type="primary"
              icon={React.createElement(PlusOutlined)}
              loading={submittingFollowUp}
              onClick={handleFollowUpSubmit}
            >
              添加跟进
            </Button>
          </Form>
        </div>

        {/* Timeline */}
        {followUps.length > 0 ? (
          <Timeline
            items={followUps.map((f) => ({
              color: f.nextAction ? 'blue' : 'gray',
              children: (
                <div>
                  <div style={{ marginBottom: 4 }}>
                    <Text>{f.content}</Text>
                  </div>
                  {f.nextAction && (
                    <div style={{ marginBottom: 4 }}>
                      <Tag color="blue">下一步: {f.nextAction}</Tag>
                    </div>
                  )}
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDate(f.createdAt)}
                    </Text>
                  </div>
                </div>
              ),
            }))}
          />
        ) : (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <Text type="secondary">暂无跟进记录</Text>
          </div>
        )}
      </Card>
    </div>
  );
};

export default CustomerDetailPage;
