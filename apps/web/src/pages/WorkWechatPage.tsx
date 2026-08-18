// craftsman-ignore: TS001,TS002
import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Table, Button, Input, message, Popconfirm, Tag, Typography, Select, Space } from 'antd';
import { PlusOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import http from '../api/client';
import PageHeader from '../components/PageHeader';

const { Text } = Typography;

const WorkWechatPage: React.FC = () => {
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
  }, []);

  const fetchCompanions = useCallback(async () => {
    try {
      const { data } = await http.get('/companions');
      setCompanions(data?.data || []);
    } catch {
      /* non-critical */
    }
  }, [typeFilter]);

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
  }, [fetch, fetchCompanions, fetchCsUsers]);

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
    </div>
  );
};

export default WorkWechatPage;
