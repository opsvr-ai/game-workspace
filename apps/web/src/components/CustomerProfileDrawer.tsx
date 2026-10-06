// craftsman-ignore: TS001,TS002
/**
 * 客户画像抽屉（老板 2026-10-04）。
 *
 * 老板原话：「这同一个客户在多少个工作微信上，各自消费了多少、打机密还是绝密、打了多久、
 * 维护多久了，不就能评判这个客户喜欢什么样的陪玩、喜欢什么样的单价等信息了，以后再遇到
 * 这个客户咨询小红书，客服不就应该单独派给什么样的陪玩了。」
 *
 * 客户看板里点「画像」打开。三块内容：
 *  ① 一句话建议：派给谁、为什么、习惯什么单价；
 *  ② 这个客户长什么样：成交单数 / 累计时长 / 毛收入 / 常打模式 / 单价区间 / 维护天数；
 *  ③ 「这个客户在 N 个工作微信上」：每个工作微信各消费多少、打机密还是绝密、打了多久、
 *     维护多久、经手的陪玩是谁（双陪单会把主陪 + 副陪一起列出来）。
 *
 * 数据口径跟客户看板 / 盈亏统计一条线：只算已完成（DONE）的单与会话；
 * 消费 = 单价 × 实际时长（主陪、副陪各算各的）。
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Avatar,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Progress,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import EmptyState from './EmptyState';
import LoadingState from './LoadingState';
import { customersApi } from '../api/customers';
import { TEXT } from '../styles/tokens';

const { Text } = Typography;

interface Props {
  customerId: string | null;
  open: boolean;
  onClose: () => void;
  showWechat: boolean;
}

function yuan(n: unknown): string {
  const v = Number(n) || 0;
  return '¥' + (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
}

function fmtHours(h: unknown): string {
  const v = Number(h) || 0;
  if (v <= 0) return '—';
  return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') + ' 小时';
}

function maskWechat(v?: string | null): string {
  const s = String(v || '');
  if (!s) return '—';
  if (s.length <= 3) return s.slice(0, 1) + '***';
  return s.slice(0, 2) + '***' + s.slice(-2);
}

function fmtDay(v?: string | Date | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysAgoText(n: unknown): string {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v <= 0) return '今天';
  if (v === 1) return '昨天';
  return v + ' 天前';
}

const MODE_COLOR: Record<string, string> = { 绝密: 'red', 机密: 'orange' };
const modeColor = (m: string) => MODE_COLOR[m] || 'default';

const STAFF_STATUS: Record<string, string> = {
  AVAILABLE: '空闲',
  BUSY: '接单中',
  ENTERTAINMENT: '娱乐中',
  RESTING: '休息中',
  OFFLINE: '离线',
};

const CustomerProfileDrawer: React.FC<Props> = ({ customerId, open, onClose, showWechat }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setFailed(false);
    try {
      const { data: res } = await customersApi.profileAnalytics(id);
      setData((res as any)?.data ?? res);
    } catch {
      setData(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && customerId) {
      setData(null);
      void load(customerId);
    }
  }, [open, customerId, load]);

  const companionView = !!data?.companionView; // 陪玩端：只给「客户喜好」，不给经手人 / 工作微信明细
  const customer = data?.customer;
  const totals = data?.totals;
  const rec = data?.recommendation;

  const showWx = (v?: string | null) => (showWechat ? v || '—' : maskWechat(v));

  const columns: any[] = [
    {
      title: '工作微信 / 谁在用',
      key: 'wx',
      render: (_: any, r: any) => (
        <Space size={8}>
          <Avatar size={28} src={r.companionAvatar || undefined}>
            {(r.companionName || '?').slice(0, 1)}
          </Avatar>
          <div style={{ lineHeight: 1.5 }}>
            <div>
              {r.workWechatId ? (
                <>
                  <Tooltip title={showWechat ? '' : '已打码：看板右上角「显示微信号」可展开'}>
                    <Text strong>{showWx(r.workWechatId)}</Text>
                  </Tooltip>
                  {!r.recorded ? (
                    <span style={{ fontSize: 11, color: TEXT.tertiary }}>（按绑定号）</span>
                  ) : null}
                </>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>未绑定工作微信</Text>
              )}
              {r.companionsCount > 1 ? (
                <Tag color="purple" style={{ marginInlineStart: 6 }}>{r.companionsCount} 人打过</Tag>
              ) : null}
              {r.isResigned ? <Tag style={{ marginInlineStart: 6 }}>已离职</Tag> : null}
            </div>
            <div style={{ fontSize: 11, color: TEXT.secondary }}>
              {r.role === 'CO' ? '副陪 ' : r.role === 'BOTH' ? '主/副陪 ' : '主陪 '}
              <span style={{ color: '#334155' }}>{r.companionName}</span>
              {r.studioName ? ' · ' + r.studioName : ''}
              {r.workWechatNickname ? ' · ' + r.workWechatNickname : ''}
            </div>
            {r.companionsCount > 1 && r.companions?.length ? (
              <div style={{ fontSize: 11, color: '#7C3AED' }}>
                一起打的：{r.companions.map((c: any) => `${c.companionName} ${fmtHours(c.hours)}`).join(' · ')}
              </div>
            ) : null}
          </div>
        </Space>
      ),
    },
    {
      title: '现在',
      key: 'online',
      width: 84,
      render: (_: any, r: any) => (
        <span style={{ fontSize: 12, color: r.online ? '#15803D' : TEXT.tertiary }}>
          {r.online ? STAFF_STATUS[r.status] || '在线' : '离线'}
        </span>
      ),
    },
    { title: '单数', dataIndex: 'orders', key: 'orders', width: 58, align: 'right' },
    {
      title: '打了多久',
      dataIndex: 'hours',
      key: 'hours',
      width: 88,
      align: 'right',
      render: (v: number) => fmtHours(v),
    },
    {
      title: '消费',
      dataIndex: 'money',
      key: 'money',
      width: 84,
      align: 'right',
      render: (v: number) => <span style={{ color: '#B91C1C', fontWeight: 600 }}>{yuan(v)}</span>,
    },
    {
      title: '机密 / 绝密',
      key: 'modes',
      width: 142,
      render: (_: any, r: any) =>
        r.modes?.length ? (
          <Space size={4} wrap>
            {r.modes.map((m: any) => (
              <Tag key={m.mode} color={modeColor(m.mode)} style={{ marginInlineEnd: 0 }}>
                {m.mode} {fmtHours(m.hours)}
              </Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '习惯单价',
      key: 'price',
      width: 104,
      render: (_: any, r: any) =>
        r.priceAvg != null ? (
          <Tooltip title={r.priceMin === r.priceMax ? '' : `区间 ${r.priceMin}~${r.priceMax} 元/小时`}>
            <span>{r.priceMin === r.priceMax ? r.priceAvg + ' 元/时' : r.priceMin + '~' + r.priceMax + ' 元/时'}</span>
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '维护',
      key: 'maintain',
      width: 122,
      render: (_: any, r: any) => (
        <span style={{ fontSize: 12, color: TEXT.heading }}>
          维护 {r.maintainDays} 天
          <div style={{ fontSize: 11, color: TEXT.tertiary }}>最近 {daysAgoText(r.lastDaysAgo)}</div>
        </span>
      ),
    },
  ];

  const wxC = totals?.workWechatCount ?? 0;
  const rowC = totals?.workWechatRowCount ?? 0;

  return (
    <Drawer
      width={900}
      open={open}
      onClose={onClose}
      destroyOnClose
      title={
        <Space size={8}>
          <span>{companionView ? '客户喜好' : '客户画像'}</span>
          {customer ? <Text strong>{customer.customerCode}</Text> : null}
          {data?.scope === 'all' ? <Tag color="gold">全站</Tag> : null}
        </Space>
      }
    >
      {loading ? (
        <LoadingState minHeight={200} />
      ) : failed || !data ? (
        <EmptyState description="画像加载失败，请关掉重开一次" />
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <Card size="small" style={{ background: '#F5F3FF', borderColor: '#DDD6FE' }} bodyStyle={{ padding: 12 }}>
            <div style={{ fontSize: 13, color: '#4C1D95', fontWeight: 600, marginBottom: 4 }}>{companionView ? '💡 这个客户喜欢什么' : '💡 派单建议'}</div>
            <div style={{ fontSize: 13, lineHeight: 1.7, color: '#312E81' }}>{rec?.summary}</div>
            {rec?.picks?.length ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {rec.picks.map((p: any, i: number) => (
                  <div
                    key={p.companionId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      borderRadius: 8,
                      background: i === 0 ? '#EDE9FE' : '#fff',
                      border: '1px solid ' + (i === 0 ? '#A78BFA' : '#E9D5FF'),
                    }}
                  >
                    <Avatar size={24} src={p.companionAvatar || undefined}>
                      {(p.companionName || '?').slice(0, 1)}
                    </Avatar>
                    <div style={{ lineHeight: 1.4 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        {p.companionName}
                        {i === 0 ? <Tag color="purple" style={{ marginInlineStart: 6 }}>首选</Tag> : null}
                      </div>
                      <div style={{ fontSize: 11, color: '#6B7280' }}>
                        陪他 {fmtHours(p.modeHours)} {p.topMode} · 共 {fmtHours(p.hours)} / {p.orders} 单
                      </div>
                      <div style={{ fontSize: 11, color: p.online ? '#15803D' : TEXT.tertiary }}>
                        {p.online ? STAFF_STATUS[p.status] || '在线' : '离线'}
                        {p.workWechatId ? ' · ' + showWx(p.workWechatId) : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="客户微信">
              <Tooltip title={showWechat ? '' : '已打码'}>
                <span>{showWx(customer.wechatId)}</span>
              </Tooltip>
            </Descriptions.Item>
            <Descriptions.Item label="归属陪玩">{customer.ownerCompanionName || '未分配'}</Descriptions.Item>
            <Descriptions.Item label="维护时长">
              {customer.maintainDays} 天
              <span style={{ color: TEXT.tertiary, fontSize: 12 }}>
                （首次 {fmtDay(customer.firstOrderAt)} · 最近 {daysAgoText(customer.lastDaysAgo)}）
              </span>
            </Descriptions.Item>
            <Descriptions.Item label="成交 / 时长 / 毛收入">
              {totals.doneOrders} 单 · {fmtHours(totals.hours)} · {yuan(totals.gross)}
            </Descriptions.Item>
          </Descriptions>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Card size="small" style={{ flex: '1 1 300px' }} title={<span style={{ fontSize: 13 }}>喜欢打什么</span>}>
              {totals.modes?.length ? (
                totals.modes.map((m: any) => (
                  <div key={m.mode} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <Tag color={modeColor(m.mode)} style={{ marginInlineEnd: 0 }}>{m.mode}</Tag>
                      <span style={{ color: TEXT.heading }}>
                        {m.orders} 单 · {fmtHours(m.hours)} · {yuan(m.money)} · {m.ratio}%
                      </span>
                    </div>
                    <Progress
                      percent={m.ratio}
                      showInfo={false}
                      size="small"
                      strokeColor={m.mode === '绝密' ? '#DC2626' : '#F59E0B'}
                    />
                  </div>
                ))
              ) : (
                <Text type="secondary">还没有成交记录</Text>
              )}
              <div style={{ fontSize: 12, color: TEXT.secondary, marginTop: 6 }}>
                习惯单价：
                {totals.price?.min != null
                  ? `${totals.price.min}~${totals.price.max} 元/小时（均值 ${totals.price.avg}，共 ${totals.price.samples} 次）`
                  : '还没有记录'}
              </div>
            </Card>

            {!companionView && (
              <Card size="small" style={{ flex: '1 1 220px' }} title={<span style={{ fontSize: 13 }}>速览</span>}>
                <div style={{ fontSize: 13, lineHeight: 2, color: '#334155' }}>
                  <div>打过的工作微信：<Text strong>{wxC}</Text> 个</div>
                  <div>经手的陪玩：<Text strong>{totals.companionCount ?? 0}</Text> 人</div>
                  <div>其中现在在线：<Text strong>{totals.onlineCompanions ?? 0}</Text> 人</div>
                </div>
              </Card>
            )}
          </div>

          {!companionView && (
            <Card
              size="small"
              title={
                <span style={{ fontSize: 13 }}>
                  这个客户在 {wxC} 个工作微信上
                  {rowC > wxC ? `（另有 ${rowC - wxC} 个陪玩没记录工作微信，也一并列出来了）` : ''}
                </span>
              }
              bodyStyle={{ padding: 0 }}
            >
              <Table
                rowKey="key"
                size="small"
                columns={columns}
                dataSource={data.workWechats || []}
                pagination={false}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有成交记录" /> }}
              />
            </Card>
          )}
        </div>
      )}
    </Drawer>
  );
};

export default CustomerProfileDrawer;