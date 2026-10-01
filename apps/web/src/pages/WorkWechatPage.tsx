// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Table, Button, Input, message, Popconfirm, Tag, Typography, Select, Space, Card, Modal } from 'antd';
import { PlusOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import http from '../api/client';
import PageHeader from '../components/PageHeader';
import { useAuthStore } from '../stores/authStore';

const { Text } = Typography;

const WorkWechatPage: React.FC = () => {
  const role = useAuthStore((s) => s.user?.role);
  const isCs = role === 'CS';

  const [searchParams] = useSearchParams();
  const typeFilter = searchParams.get('type') || '';
  const [wechats, setWechats] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newWechatId, setNewWechatId] = useState('');
  const [newType, setNewType] = useState('COMPANION');
  const [companions, setCompanions] = useState<any[]>([]);
  const [csUsers, setCsUsers] = useState<any[]>([]);
  const [bindingId, setBindingId] = useState<string | null>(null);
  const [boundNames, setBoundNames] = useState<Record<string, string>>({});
  const [editingNicknameId, setEditingNicknameId] = useState<string | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState('');
  // 陪玩自己提交的工作微信申请（老板 2026-10-02）：管理端在这里审核
  const [requests, setRequests] = useState<any[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await http.get('/companions/work-wechats');
      const list = data?.data || [];
      setWechats(typeFilter ? list.filter((w: any) => w.type === typeFilter) : list);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  const fetchCompanions = useCallback(async () => {
    try {
      const { data } = await http.get('/companions');
      setCompanions(data?.data || []);
    } catch {
      /* non-critical */
    }
  }, [typeFilter]);

  const fetchRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const { data } = await http.get('/companions/work-wechat-requests');
      setRequests(data?.data || []);
    } catch {
      /* 非关键：拉不到就只显示空表 */
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  const fetchCsUsers = useCallback(async () => {
    try {
      const { data } = await http.get('/users/cs');
      setCsUsers(data?.data || []);
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    fetch();
    fetchCompanions();
    fetchCsUsers();
    fetchRequests();
  }, [fetch, fetchCompanions, fetchCsUsers, fetchRequests]);

  // 管理端可能一直开着这一页：30 秒对一次（有陪玩新提交就自己冒出来）
  useEffect(() => {
    const timer = setInterval(fetchRequests, 30000);
    return () => clearInterval(timer);
  }, [fetchRequests]);

  const handleApproveRequest = async (id: string) => {
    try {
      await http.put(`/companions/work-wechat-requests/${id}/approve`);
      message.success('已通过，这个号从现在起生效');
      fetchRequests();
      fetch();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '审核失败');
    }
  };

  const handleRejectRequest = async () => {
    if (!rejectId) return;
    setRejecting(true);
    try {
      await http.put(`/companions/work-wechat-requests/${rejectId}/reject`, {
        reason: rejectReason.trim() || undefined,
      });
      message.success('已驳回');
      setRejectId(null);
      setRejectReason('');
      fetchRequests();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '驳回失败');
    } finally {
      setRejecting(false);
    }
  };

  const handleAdd = async () => {
    const v = newWechatId.trim();
    if (!v) {
      message.warning('请输入微信号');
      return;
    }
    setAdding(true);
    try {
      await http.post('/companions/work-wechats', { wechatId: v, type: typeFilter || newType });
      message.success('已添加');
      setNewWechatId('');
      fetch();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '添加失败');
    } finally {
      setAdding(false);
    }
  };

  const handleBind = async (wechatId: string, companionId: string) => {
    const name = companions.find((c: any) => c.id === companionId)?.user?.username || companionId;
    try {
      await http.put(`/companions/work-wechats/${wechatId}/bind`, { companionId });
      message.success('已绑定');
      setBoundNames((prev) => ({ ...prev, [wechatId]: name }));
      setBindingId(null);
      fetch();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '绑定失败');
    }
  };

  const handleUnbind = async (wechatId: string) => {
    try {
      await http.put(`/companions/work-wechats/${wechatId}/unbind`);
      message.success('已解绑');
      setBoundNames((prev) => {
        const { [wechatId]: _, ...rest } = prev;
        return rest;
      });
      fetch();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '解绑失败');
    }
  };

  const handleBindCs = async (wechatId: string, csUserId: string) => {
    const name = csUsers.find((u: any) => u.id === csUserId)?.username || csUserId;
    try {
      await http.put(`/companions/work-wechats/${wechatId}/bind-cs`, { csUserId });
      message.success('已绑定客服');
      setBoundNames((prev) => ({ ...prev, [wechatId]: name }));
      setBindingId(null);
      fetch();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '绑定失败');
    }
  };

  const handleUnbindCs = async (wechatId: string) => {
    try {
      await http.put(`/companions/work-wechats/${wechatId}/unbind-cs`);
      message.success('已解绑客服');
      fetch();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '解绑失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await http.delete(`/companions/work-wechats/${id}`);
      message.success('已删除');
      fetch();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  const saveNickname = async (id: string) => {
    try {
      await http.put(`/companions/work-wechats/${id}/nickname`, { nickname: nicknameDraft });
      message.success('昵称已保存');
      setEditingNicknameId(null);
      setNicknameDraft('');
      fetch();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    }
  };

  const pendingRequestCount = requests.filter((r: any) => r.status === 'PENDING').length;

  return (
    <div>
      <PageHeader
        title={typeFilter === 'STUDIO' ? '📱 客服工作微信' : typeFilter === 'COMPANION' ? '📱 陪玩工作微信' : '📱 工作微信管理'}
        subtitle={typeFilter === 'STUDIO' ? '管理客服使用的工作微信，并绑定给客服' : typeFilter === 'COMPANION' ? '管理陪玩使用的工作微信，并绑定给陪玩' : '管理本店工作微信'}
        extra={
          <Button icon={<ReloadOutlined />} onClick={fetch} loading={loading}>
            刷新
          </Button>
        }
      />

      {!isCs && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Input
            placeholder="输入微信号"
            value={newWechatId}
            onChange={(e) => setNewWechatId(e.target.value)}
            onPressEnter={handleAdd}
            style={{ width: 200 }}
          />
          {!typeFilter && (
            <Select
              value={newType}
              onChange={setNewType}
              style={{ width: 150 }}
              options={[
                { label: '陪玩微信', value: 'COMPANION' },
                { label: '工作室/客服微信', value: 'STUDIO' },
              ]}
            />
          )}
          <Button type="primary" icon={<PlusOutlined />} loading={adding} onClick={handleAdd}>
            添加
          </Button>
        </div>
      )}

      {typeFilter !== 'STUDIO' && (
        <Card
          size="small"
          style={{
            marginBottom: 16,
            border: pendingRequestCount > 0 ? '1px solid #ffccc7' : undefined,
            background: pendingRequestCount > 0 ? '#fff7e6' : undefined,
          }}
          title={
            <Space size={8}>
              <span>📥 陪玩自己提交的微信号（管理端审核）</span>
              {pendingRequestCount > 0 ? (
                <Tag color="red">{pendingRequestCount} 条待审核</Tag>
              ) : (
                <Tag>暂无待审核</Tag>
              )}
            </Space>
          }
        >
          <Table
            size="small"
            rowKey="id"
            loading={requestsLoading}
            dataSource={requests}
            pagination={{ pageSize: 5, hideOnSinglePage: true }}
            locale={{ emptyText: '还没有陪玩提交过' }}
            columns={[
              {
                title: '陪玩',
                key: 'companion',
                width: 150,
                render: (_: any, r: any) => (
                  <Text>
                    {r.companion?.user?.displayName || r.companion?.user?.username || '-'}
                  </Text>
                ),
              },
              {
                title: '提交的微信号',
                dataIndex: 'wechatId',
                key: 'wechatId',
                render: (v: string) => <Text strong>📱 {v}</Text>,
              },
              {
                title: '状态',
                key: 'status',
                width: 170,
                render: (_: any, r: any) =>
                  r.status === 'PENDING' ? (
                    <Tag color="orange">待审核</Tag>
                  ) : r.status === 'APPROVED' ? (
                    <Tag color="green">已通过</Tag>
                  ) : (
                    <Tag>已驳回{r.rejectReason ? `：${r.rejectReason}` : ''}</Tag>
                  ),
              },
              {
                title: '提交时间',
                dataIndex: 'createdAt',
                key: 'createdAt',
                width: 160,
                render: (v: string) =>
                  v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-',
              },
              {
                title: '操作',
                key: 'op',
                width: 150,
                render: (_: any, r: any) =>
                  r.status === 'PENDING' ? (
                    <Space size={4}>
                      <Popconfirm
                        title={`通过「${r.wechatId}」？通过后立刻生效`}
                        onConfirm={() => handleApproveRequest(r.id)}
                        okText="通过"
                        cancelText="取消"
                      >
                        <Button type="link" size="small">
                          通过
                        </Button>
                      </Popconfirm>
                      <Button
                        type="link"
                        size="small"
                        danger
                        onClick={() => {
                          setRejectId(r.id);
                          setRejectReason('');
                        }}
                      >
                        驳回
                      </Button>
                    </Space>
                  ) : (
                    <Text type="secondary">—</Text>
                  ),
              },
            ]}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            陪玩提交的只是申请：只有点「通过」才会把这个号绑给他（他原来绑的号自动退下来）。
            审核通过之前，抢单判重用的还是他现在生效的那个号。
          </Text>
        </Card>
      )}

      <Table
        dataSource={wechats}
        rowKey="id"
        loading={loading}
        pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 个` }}
        columns={[
          {
            title: '类型',
            key: 'type',
            width: 120,
            render: (_: any, r: any) =>
              r.type === 'STUDIO' ? <Tag color="purple">工作室/客服</Tag> : <Tag color="blue">陪玩</Tag>,
          },
          {
            title: '微信号',
            dataIndex: 'wechatId',
            key: 'wechatId',
            render: (v: string) => <Text strong>📱 {v}</Text>,
          },
          {
            title: '昵称',
            dataIndex: 'nickname',
            key: 'nickname',
            width: 220,
            render: (v: string, r: any) => {
              if (editingNicknameId === r.id) {
                return (
                  <Input
                    autoFocus
                    size="small"
                    value={nicknameDraft}
                    onChange={(e) => setNicknameDraft(e.target.value)}
                    onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
                    onBlur={() => saveNickname(r.id)}
                    placeholder="输入昵称"
                    style={{ width: 180 }}
                  />
                );
              }
              return (
                <Space size={4}>
                  <Text>{v || <Text type="secondary">未设置</Text>}</Text>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setEditingNicknameId(r.id);
                      setNicknameDraft(v || '');
                    }}
                  >
                    {v ? '改' : '设置'}
                  </Button>
                </Space>
              );
            },
          },
          {
            title: '状态',
            key: 'status',
            width: 100,
            render: (_: any, r: any) =>
              r.status === 'BOUND' ? <Tag color="blue">已绑定</Tag> : <Tag color="green">可用</Tag>,
          },
          {
            title: '绑定对象',
            key: 'binding',
            width: 180,
            render: (_: any, r: any) => {
              if (bindingId === r.id) {
                if (r.type === 'STUDIO') {
                  return (
                    <Select
                      autoFocus
                      size="small"
                      showSearch
                      placeholder="选择客服"
                      style={{ width: 150 }}
                      onChange={(csUserId) => handleBindCs(r.id, csUserId)}
                      options={csUsers.map((u: any) => ({
                        label: u.displayName || u.username,
                        value: u.id,
                      }))}
                    />
                  );
                }
                return (
                  <Select
                    autoFocus
                    size="small"
                    showSearch
                    placeholder="选择陪玩"
                    style={{ width: 150 }}
                    onChange={(companionId) => handleBind(r.id, companionId)}
                    options={companions
                      .filter((c: any) => c.status !== 'OFFLINE')
                      .map((c: any) => ({
                        label: c.user?.displayName || c.user?.username || c.id,
                        value: c.id,
                      }))}
                  />
                );
              }
              if (r.type === 'STUDIO') {
                const cs = csUsers.find((u: any) => u.id === r.csUserId);
                if (cs || boundNames[r.id]) {
                  return (
                    <Space size={4}>
                      <Text>{cs?.username || boundNames[r.id]}</Text>
                      <Button type="link" size="small" onClick={() => handleUnbindCs(r.id)}>
                        解绑
                      </Button>
                    </Space>
                  );
                }
                return (
                  <Button type="link" size="small" onClick={() => setBindingId(r.id)}>
                    绑定客服
                  </Button>
                );
              }
              if (r.companion?.user?.username || boundNames[r.id]) {
                return (
                  <Space size={4}>
                    <Text>{r.companion?.user?.username || boundNames[r.id]}</Text>
                    <Button type="link" size="small" onClick={() => handleUnbind(r.id)}>
                      解绑
                    </Button>
                  </Space>
                );
              }
              return (
                <Button type="link" size="small" onClick={() => setBindingId(r.id)}>
                  绑定陪玩
                </Button>
              );
            },
          },
          {
            title: '操作',
            key: 'actions',
            width: 80,
            render: (_: any, r: any) => (
              <Popconfirm
                title="确定删除该工作微信？"
                onConfirm={() => handleDelete(r.id)}
                okText="确定"
                cancelText="取消"
              >
                <Button type="link" danger size="small" icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />

      <Modal
        open={!!rejectId}
        title="驳回这条微信号申请"
        onCancel={() => {
          setRejectId(null);
          setRejectReason('');
        }}
        onOk={handleRejectRequest}
        okText="驳回"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        confirmLoading={rejecting}
      >
        <Text type="secondary">驳回后陪玩能看到原因；他现在生效的号不受影响。</Text>
        <Input.TextArea
          rows={3}
          style={{ marginTop: 8 }}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="写一下原因（可不填）"
          maxLength={200}
          showCount
        />
      </Modal>
    </div>
  );
};

export default WorkWechatPage;
