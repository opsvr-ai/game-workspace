// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Table, Button, Input, Popconfirm, Tag, Typography, Select, Space, Card, Modal, Tooltip, Alert } from 'antd';
import { message } from '../utils/feedback';
import { PlusOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import http from '../api/client';
import PageHeader from '../components/PageHeader';
import { useAuthStore } from '../stores/authStore';
import { CELL_ONE_LINE } from '../constants/datasetColumns';
import { TEXT, SEMANTIC } from '../styles/tokens';

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

  /**
   * 这一张表的行 = 「陪玩自己提交、还在等审核的号」+「已经生效的工作微信」（老板 2026-10-02 合并）。
   *
   * 原来这两拨各占一张表（上面一张审核卡片、下面一张工作微信表），老板说「现在是上下两部分，
   * 合并成一整块，要不然很乱」。现在同一张表：待审核的排在最上面（橙色行 + 通过 / 驳回），
   * 审核通过的那一瞬间它就变成下面那种正常行（那个号已经绑给他了），不用在两张表之间来回看。
   * 已通过 / 已驳回的申请不再单列一行 —— 通过的号本身就在这张表里，被驳回的原因陪玩那边能看到。
   */
  const tableRows = useMemo(() => {
    const reqRows =
      typeFilter === 'STUDIO'
        ? []
        : requests
            .filter((r: any) => r.status === 'PENDING')
            .map((r: any) => ({ ...r, _request: true, _rowKey: `req:${r.id}` }));
    const wxRows = wechats.map((w: any) => ({ ...w, _request: false, _rowKey: `wx:${w.id}` }));
    return [...reqRows, ...wxRows];
  }, [requests, wechats, typeFilter]);

  return (
    <div>
      <PageHeader
        title={typeFilter === 'STUDIO' ? '客服工作微信' : typeFilter === 'COMPANION' ? '陪玩工作微信' : '工作微信管理'}
        subtitle={typeFilter === 'STUDIO' ? '管理客服使用的工作微信，并绑定给客服' : typeFilter === 'COMPANION' ? '管理陪玩使用的工作微信，并绑定给陪玩' : '管理本店工作微信'}
        extra={
          <Button icon={<ReloadOutlined />} onClick={fetch} loading={loading}>
            刷新
          </Button>
        }
      />

      {/* 老板 2026-10-05：「客服更换工作微信需要店长同意吧？」——客服看得到台账，但绑 / 解绑按钮
          只给店长 / 老板；客服要换号就找店长。 */}
      {isCs && typeFilter === 'STUDIO' && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="客服工作微信由店长 / 老板绑定"
          description="要换工作微信，把新微信号发给店长，让他在这一页改；客服自己改不了（需要店长同意）。"
        />
      )}

      <Card size="small">
        {/* 一块：上面这一行是「加号」、下面就是这张表 —— 陪玩自己提交、等审核的那几行直接排在
            这张表最上面，不再单开一张卡片（老板 2026-10-02：「现在是上下两部分，合并成一整块，
            要不然很乱」）。审核通过的那一瞬间，上面那行就变成下面那种「已绑定」的行。 */}
        {(!isCs || (typeFilter !== 'STUDIO' && pendingRequestCount > 0)) && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginBottom: 12,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {!isCs && (
              <Input
                placeholder="输入微信号"
                value={newWechatId}
                onChange={(e) => setNewWechatId(e.target.value)}
                onPressEnter={handleAdd}
                style={{ width: 200 }}
              />
            )}
            {!isCs && !typeFilter && (
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
            {!isCs && (
              <Button type="primary" icon={<PlusOutlined />} loading={adding} onClick={handleAdd}>
                添加
              </Button>
            )}
            {typeFilter !== 'STUDIO' && pendingRequestCount > 0 && (
              <Tag color="red">{pendingRequestCount} 条陪玩提交待审核（在下面表的最上面几行）</Tag>
            )}
          </div>
        )}

        <Table
          scroll={{ x: 770 }}
          dataSource={tableRows}
          rowKey={(r: any) => r._rowKey}
          loading={loading || requestsLoading}
          pagination={{ pageSize: 20, showTotal: (t: number) => `共 ${t} 个` }}
          onRow={(r: any) => (r._request ? { style: { background: SEMANTIC.warningSoft } } : {})}
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
                // 等审核的那一行还没生效（号都还没绑给他），没有昵称可填，别显示「未设置 / 设置」
                if (r._request) return <Text type="secondary">-</Text>;
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
              render: (_: any, r: any) => {
                if (r._request) {
                  const who =
                    r.companion?.user?.displayName || r.companion?.user?.username || '陪玩';
                  const at = r.createdAt
                    ? new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })
                    : '';
                  return (
                    <Tooltip title={`${who} 提交于 ${at}；通过后这个号立刻生效并绑给他`}>
                      <Tag color="orange">待审核</Tag>
                    </Tooltip>
                  );
                }
                return r.status === 'BOUND' ? (
                  <Tag color="blue">已绑定</Tag>
                ) : (
                  <Tag color="green">可用</Tag>
                );
              },
            },
            {
              title: '绑定对象',
              key: 'binding',
              width: 180,
              render: (_: any, r: any) => {
                // 等审核的提交：这里先写清「通过以后会绑给谁」，一眼知道该不该通过
                if (r._request) {
                  const who =
                    r.companion?.user?.displayName || r.companion?.user?.username || '（陪玩已删除）';
                  const studio = role === 'OWNER' && r.studioName ? ` · ${r.studioName}` : '';
                  return (
                    <div style={CELL_ONE_LINE} title={`${who} 提交的号 · 通过后绑给他`}>
                      <Text>{who}</Text>
                      <span style={{ fontSize: 11, color: TEXT.tertiary }}> · 提交人{studio}</span>
                    </div>
                  );
                }
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
                        {/* 客服本人不能解绑（换号要店长同意） */}
                        {!isCs && (
                          <Button type="link" size="small" onClick={() => handleUnbindCs(r.id)}>
                            解绑
                          </Button>
                        )}
                      </Space>
                    );
                  }
                  if (isCs) return <Text type="secondary">由店长 / 老板绑定</Text>;
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
              width: 150,
              render: (_: any, r: any) => {
                // 等审核的提交：这一格是「通过 / 驳回」（原来在上面的审核卡片里，合并到这一张表）
                if (r._request) {
                  return (
                    <Space size={4}>
                      <Popconfirm
                        title={`通过「${r.wechatId}」？通过后立刻生效并绑给他`}
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
                  );
                }
                return (
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
                );
              },
            },
          ]}
        />

        {/* 这一句只在「陪玩工作微信」这一页说 —— 客服工作微信页没有陪玩提交这回事 */}
        {typeFilter !== 'STUDIO' && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            陪玩自己在客户端提交的号会直接出现在这张表最上面（橙色「待审核」那几行）：只有点「通过」才会把这个号
            绑给他（他原来绑的号自动退下来）；审核通过之前，抢单判重用的还是他现在生效的那个号。
          </Text>
        )}
      </Card>

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
