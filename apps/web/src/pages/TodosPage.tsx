// craftsman-ignore: TS001,TS002
import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Empty, Space, Spin, Tag, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ReloadOutlined } from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import http from '../api/client';

const { Text } = Typography;

/**
 * 待处理工作台（老板 2026-10-06）。
 *
 * 老板原话：「能不能把店长 / 老板 / 客服需要处理的集合起来，要不然到处都是，
 * 每天上班先点开待处理看一下」。
 *
 * 这一页自己不存放业务逻辑，全部来自 `GET /api/todos`（按登录角色给的清单）：
 * 成交核对待拍板、补单申请、报账 / 支取 / 流水、战绩图、工作微信、实名审核、删除客户、
 * 桥接申请、客服该核对的失败单、客服该跟进的客户……
 * 一行一条，点「去处理 ›」直接跳到那个页面做（同意 / 驳回 / 拍板还在原页面，
 * 权限、留痕、实时通知都不用重写一遍）。
 */

interface TodoItem {
  id: string;
  title: string;
  sub?: string;
  at?: string | null;
  href: string;
}

interface TodoGroup {
  key: string;
  label: string;
  hint: string;
  count: number;
  href: string;
  items: TodoItem[];
}

const mmddhhmm = (value?: string | null): string => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 多久之前（今天只显示时分，昨天 / 更早显示日期） */
const ago = (value?: string | null): string => {
  if (!value) return '';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)} 小时前`;
  if (mins < 60 * 24 * 7) return `${Math.floor(mins / 1440)} 天前`;
  return mmddhhmm(value);
};

/** 每一类给个颜色，扫一眼就知道轻重 */
const GROUP_TINT: Record<string, string> = {
  outcome_decide: '#DC2626',
  outcome_confirm: '#DC2626',
  cs_recheck: '#D97706',
  followup_due: '#2563EB',
  supplement: '#7C3AED',
  expense_report: '#059669',
  withdraw: '#059669',
  transaction: '#059669',
  battle_screenshot: '#F97316',
  work_wechat: '#0891B2',
  realname: '#4F46E5',
  customer_delete: '#BE123C',
  bridge: '#9333EA',
};

const TodosPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [groups, setGroups] = useState<TodoGroup[]>([]);
  const [at, setAt] = useState<string>('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await http.get('/todos');
      const d = data?.data || {};
      setTotal(Number(d.total) || 0);
      setGroups(Array.isArray(d.groups) ? d.groups : []);
      setAt(d.generatedAt || '');
    } catch (e: any) {
      if (!silent) message.error(e?.response?.data?.message || '加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // 别人处理完了这一页也要跟着少 —— 60 秒自己刷一次（页面不可见时不刷）
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 60000);
    return () => clearInterval(t);
  }, [load]);

  const go = (href: string) => {
    if (href) navigate(href);
  };

  return (
    <div style={{ padding: '0 4px' }}>
      <PageHeader
        title="待处理"
        subtitle="店长 / 老板 / 客服今天要处理的事都在这儿，一行一条，点「去处理」直接跳过去"
        extra={
          <Space>
            {at ? <Text type="secondary" style={{ fontSize: 12 }}>更新于 {mmddhhmm(at)}</Text> : null}
            <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => load()}>
              刷新
            </Button>
          </Space>
        }
      />

      {loading && !groups.length ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin />
        </div>
      ) : total === 0 ? (
        <Card>
          <Empty description="今天没有待处理的事，可以安心摸鱼了" />
        </Card>
      ) : (
        <>
          {/* 顶部总览：今天一共欠多少事，点一下滚到那一类 */}
          <Card style={{ marginBottom: 12 }}>
            <Space size={8} wrap align="center">
              <Tag color="#DC2626" style={{ fontSize: 14, padding: '4px 10px', fontWeight: 700 }}>
                一共 {total} 条待处理
              </Tag>
              {groups.map((g) => (
                <Button
                  key={g.key}
                  size="small"
                  onClick={() => {
                    const el = document.getElementById(`todo-group-${g.key}`);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  <span style={{ color: GROUP_TINT[g.key] || '#374151', fontWeight: 600 }}>{g.label}</span>
                  <Badge
                    count={g.count}
                    size="small"
                    overflowCount={999}
                    style={{ marginLeft: 6, backgroundColor: GROUP_TINT[g.key] || '#FF4D4F' }}
                  />
                </Button>
              ))}
            </Space>
          </Card>

          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {groups.map((g) => {
              const tint = GROUP_TINT[g.key] || '#FF4D4F';
              return (
                <Card
                  key={g.key}
                  id={`todo-group-${g.key}`}
                  title={
                    <Space size={8}>
                      <span style={{ display: 'inline-block', width: 4, height: 16, background: tint, borderRadius: 2 }} />
                      <span style={{ fontWeight: 700 }}>{g.label}</span>
                      <Badge count={g.count} overflowCount={999} style={{ backgroundColor: tint }} />
                    </Space>
                  }
                  extra={
                    <Button type="link" size="small" onClick={() => go(g.href)}>
                      全部 {g.count} 条 ›
                    </Button>
                  }
                  styles={{ body: { paddingTop: 8, paddingBottom: 8 } }}
                >
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    {g.hint}
                  </Text>
                  {g.items.map((it) => (
                    <div
                      key={it.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid #F1F5F9',
                        marginBottom: 6,
                        cursor: 'pointer',
                      }}
                      onClick={() => go(it.href || g.href)}
                    >
                      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {it.title}
                        </div>
                        {it.sub ? (
                          <div style={{ fontSize: 12, color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {it.sub}
                          </div>
                        ) : null}
                      </div>
                      <Text type="secondary" style={{ fontSize: 12, flex: '0 0 auto' }}>
                        {ago(it.at)}
                      </Text>
                      <Button type="link" size="small" style={{ flex: '0 0 auto', padding: 0 }}>
                        去处理 ›
                      </Button>
                    </div>
                  ))}
                  {g.count > g.items.length ? (
                    <Button type="link" size="small" onClick={() => go(g.href)}>
                      还有 {g.count - g.items.length} 条，去 {g.label} 看全部 ›
                    </Button>
                  ) : null}
                </Card>
              );
            })}
          </Space>
        </>
      )}
    </div>
  );
};

export default TodosPage;
