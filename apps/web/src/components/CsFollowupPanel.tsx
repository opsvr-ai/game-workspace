// craftsman-ignore: TS001,TS002
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Space, Table, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { ordersApi } from '../api/orders';
import {
  ACTIONS_CELL_CLASS,
  DATA_SUB_FONT_SIZE,
  LEDGER_FIELD_WIDTH,
  LEDGER_TABLE_WIDTH,
  TABLE_STYLE,
} from '../constants/datasetColumns';
import { visibleInterval } from '../hooks/usePolling';
import { extractErrorMessage } from '../utils/error-handler';
import FollowUpModal from './FollowUpModal';

interface Props {
  refreshSignal?: number;
  onDispatch?: (item: any) => void;
}

/** 台账状态：待添加 / 已添加 / 客户已同意 / 添加失败 / 已派单（不再出现「无人接单」） */
const stateOf = (r: any): { text: string; color: string } => {
  switch (r.contactStatus) {
    case 'dispatched':
      return { text: '已派单', color: '#2563EB' };
    case 'agreed':
      return { text: '客户已同意', color: '#15803D' };
    case 'added':
      return { text: '已添加', color: '#15803D' };
    case 'not_accepted':
      return { text: '添加失败', color: '#B45309' };
    default:
      return { text: '待添加', color: '#B45309' };
  }
};

/** 台账里的时间：月-日 时:分（当年的年份不显示，省宽度） */
const mmddhhmm = (value?: string | null): string => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * 客服跟进台账（老板 2026-09-29 定稿；以前叫「管理端直添客户跟进列表」）。
 *
 * 老板的原话：「不就是客户现在不打，客服加到了客服自己的工作微信上了么？
 * 这里不就是负责让客服持续追踪客户用的，然后时机成熟客服直接派单出去」。
 * 所以这一页不看「订单」，只按**客户**看：
 *   客户（编号 / 微信 / 昵称 / 来源账号）→ 客服工作微信 → 添加情况 → 最后跟进 → 下次跟进 → 操作。
 *
 * 状态和订单池那套脱钩：待添加 / 已添加 / 客户已同意 / 添加失败 / 已派单，
 * 不会再出现「无人接单」这种和客服无关的词。
 * 「记跟进」写的是**客户档案里那条跟进记录**（客户管理里能看到同一条），
 * 「直接派单」沿用养客客户重新发单那条链路（带原客户ID + 标记客服养好的客户）。
 */
const CsFollowupPanel: React.FC<Props> = ({ refreshSignal, onDispatch }) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [followTarget, setFollowTarget] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await ordersApi.csFollowup();
      setItems(data.data || []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = visibleInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (refreshSignal) load();
  }, [refreshSignal]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((r) => {
      const cf = r.customFields || {};
      const c = r.customer || {};
      const last = (c.followUps || [])[0] || {};
      const haystack = [
        r.gameName,
        r.orderCode,
        c.wechatId,
        c.customerCode,
        c.platform,
        cf.customerSource,
        cf.customerSourceAccount,
        cf.customerNickname,
        cf.customerAccountId,
        cf.customerWechat,
        cf.customerYy,
        cf.customerPlatformAccount,
        cf.customerRoomCode,
        cf.deltaNote,
        cf.scheduledTimeText,
        cf.notes,
        cf.csWorkWechatName,
        last.content,
        last.workWechatName,
      ]
        .filter((v) => v != null && String(v).trim() !== '')
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, search]);

  const mark = async (item: any, status: string, addResult?: 'passed' | 'failed', done?: string) => {
    try {
      await ordersApi.markCsContact(item.id, status, undefined, addResult ? { addResult } : undefined);
      message.success(done || '已记录');
      load();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '操作失败'));
    }
  };

  const handleDone = async (item: any) => {
    try {
      await ordersApi.markPoolHandled(item.id);
      message.success('已从台账里收起来');
      load();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '操作失败'));
    }
  };

  // 客户的「一行看全」：编号 · 微信 · 昵称 · 来源账号 · 客户账号ID，段间只有一个小灰点。
  const customerBits = (r: any): string[] => {
    const cf = r.customFields || {};
    const c = r.customer || {};
    const source = [cf.customerSource || c.platform, cf.customerSourceAccount].filter(Boolean).join(' ');
    return [
      c.customerCode ? `#${c.customerCode}` : '',
      c.wechatId || cf.customerWechat || '',
      cf.customerNickname || '',
      source,
      cf.customerAccountId || '',
    ].filter((v) => v != null && String(v).trim() !== '');
  };

  const workWechatOf = (r: any): string =>
    (r.customFields || {}).csWorkWechatName ||
    ((r.customer || {}).followUps || [])[0]?.workWechatName ||
    '';

  const renderActions = (r: any) => {
    const st = r.contactStatus;
    const buttons: React.ReactNode[] = [];
    if (st === 'dispatched') {
      buttons.push(
        <Button key="done" size="small" onClick={() => handleDone(r)}>
          处理完成
        </Button>,
      );
    } else if (st === 'agreed') {
      buttons.push(
        <Button key="dispatch" size="small" type="primary" onClick={() => onDispatch?.(r)}>
          直接派单
        </Button>,
      );
    } else if (st === 'added') {
      buttons.push(
        <Button key="agree" size="small" onClick={() => mark(r, 'agreed', undefined, '已标记：客户同意打了')}>
          客户已同意
        </Button>,
      );
      buttons.push(
        <Button key="dispatch" size="small" type="primary" onClick={() => onDispatch?.(r)}>
          直接派单
        </Button>,
      );
    } else if (st === 'not_accepted') {
      buttons.push(
        <Button
          key="passed"
          size="small"
          type="primary"
          style={{ background: '#16A34A', borderColor: '#16A34A' }}
          onClick={() => mark(r, 'added', 'passed', '已标记添加成功')}
        >
          加上了
        </Button>,
      );
      buttons.push(
        <Button key="agree" size="small" onClick={() => mark(r, 'agreed', undefined, '已标记：客户同意打了')}>
          客户已同意
        </Button>,
      );
    } else {
      buttons.push(
        <Button
          key="passed"
          size="small"
          type="primary"
          style={{ background: '#16A34A', borderColor: '#16A34A' }}
          onClick={() => mark(r, 'added', 'passed', '已标记添加成功')}
        >
          添加成功
        </Button>,
      );
      buttons.push(
        <Button key="failed" size="small" danger onClick={() => mark(r, 'added', 'failed', '已标记添加失败')}>
          添加失败
        </Button>,
      );
    }
    buttons.push(
      <Button key="follow" size="small" onClick={() => setFollowTarget(r)}>
        记跟进
      </Button>,
    );
    return <Space size={4}>{buttons}</Space>;
  };

  const columns: any[] = [
    {
      title: '客户',
      key: 'customer',
      width: LEDGER_FIELD_WIDTH.customer,
      fixed: 'left' as const,
      render: (_: unknown, r: any) => {
        const bits = customerBits(r);
        // 段之间只留一个小灰点，不加空格（和订单管理的「客户账号」列同一个规矩 ——
        // 老板 2026-09-29：「把标签之间的间距压缩一下，现在左右标签之间距离太大了」）。
        const text = bits.join('·');
        return (
          <div
            style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={text}
          >
            {bits.length ? (
              bits.map((bit, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span style={{ color: '#CBD5E1' }}>·</span>}
                  <span>{bit}</span>
                </React.Fragment>
              ))
            ) : (
              <span style={{ color: '#94A3B8' }}>-</span>
            )}
          </div>
        );
      },
    },
    {
      title: '客服工作微信',
      key: 'workWechat',
      width: LEDGER_FIELD_WIDTH.workWechat,
      render: (_: unknown, r: any) => {
        const wx = workWechatOf(r);
        return (
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={wx}>
            {wx || <span style={{ color: '#94A3B8' }}>-</span>}
          </div>
        );
      },
    },
    {
      title: '添加情况',
      key: 'state',
      width: LEDGER_FIELD_WIDTH.state,
      render: (_: unknown, r: any) => {
        const st = stateOf(r);
        const fail = r.customFields?.deltaNote;
        return (
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fail ? `${st.text} · ${fail}` : st.text}>
            <span style={{ color: st.color }}>{st.text}</span>
            {fail && <span style={{ fontSize: DATA_SUB_FONT_SIZE, color: '#94A3B8' }}> · {fail}</span>}
          </div>
        );
      },
    },
    {
      title: '最后跟进',
      key: 'lastFollow',
      width: LEDGER_FIELD_WIDTH.lastFollow,
      render: (_: unknown, r: any) => {
        const last = ((r.customer || {}).followUps || [])[0];
        if (!last) {
          return <span style={{ color: '#94A3B8' }}>还没记过跟进</span>;
        }
        const text = `${mmddhhmm(last.createdAt)} · ${last.content || ''}`;
        return (
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={text}>
            <span style={{ color: '#94A3B8' }}>{mmddhhmm(last.createdAt)}</span>
            <span style={{ color: '#CBD5E1' }}> · </span>
            <span>{last.content}</span>
          </div>
        );
      },
    },
    {
      title: '下次跟进',
      key: 'nextFollow',
      width: LEDGER_FIELD_WIDTH.nextFollow,
      render: (_: unknown, r: any) => {
        const last = ((r.customer || {}).followUps || [])[0];
        const at = last?.nextFollowUpAt;
        if (!at) return <span style={{ color: '#94A3B8' }}>-</span>;
        return <span style={{ color: '#7C3AED' }}>{mmddhhmm(at)}</span>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: LEDGER_FIELD_WIDTH.actions,
      fixed: 'right' as const,
      className: ACTIONS_CELL_CLASS,
      render: (_: unknown, r: any) => renderActions(r),
    },
  ];

  return (
    <Card size="small" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>客服跟进台账</div>
          <div style={{ fontSize: DATA_SUB_FONT_SIZE, color: '#94A3B8' }}>
            客户先加到客服工作微信上、慢慢聊；谈得差不多了点「直接派单」发给陪玩。没记过跟进的客户排在最前面记一次。
          </div>
        </div>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索客户微信/昵称/编号/来源/跟进内容..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 300 }}
        />
      </div>
      <Table
        className="data-table"
        rowKey="id"
        columns={columns}
        dataSource={filtered}
        size="small"
        loading={loading}
        pagination={false}
        style={TABLE_STYLE}
        scroll={{ x: LEDGER_TABLE_WIDTH }}
        locale={{ emptyText: '暂无待跟进的客户（客户还没决定打的，从「派单工作台 → 直接添加客户」登记）' }}
      />
      <FollowUpModal
        open={!!followTarget}
        item={followTarget}
        onClose={() => setFollowTarget(null)}
        onSaved={() => load()}
      />
    </Card>
  );
};

export default CsFollowupPanel;
