// craftsman-ignore: TS001,TS002,TS003
import React, { useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, Spin, Typography, Table, Input, DatePicker, Tag, Image, List, Space, Calendar, Select } from 'antd';
import EmptyState from '../../components/EmptyState';
import { SearchOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { UserRole } from '@chunlv/shared';
import { billingApi } from '../../api/billing';
import { companionsApi } from '../../api/companions';
import { expenseReportsApi } from '../../api/expenses';
import PageHeader from '../../components/PageHeader';
import PayoutQrScan from '../../components/PayoutQrScan';
import { useAuthStore } from '../../stores/authStore';
import StatCard from '../../components/StatCard';
import { SEMANTIC } from '../../styles/tokens';

const { Text } = Typography;

const money = (v: number) => (v ?? 0).toFixed(1);

const statusMeta: Record<string, { color: string; label: string }> = {
  PENDING: { color: 'orange', label: '待审核' },
  APPROVED: { color: 'green', label: '已通过' },
  REJECTED: { color: 'red', label: '已拒绝' },
};

const StatusTag: React.FC<{ status?: string }> = ({ status }) => {
  const m = statusMeta[status || ''] || { color: 'default', label: status || '-' };
  return <Tag color={m.color}>{m.label}</Tag>;
};

const CompanionWalletCalendarPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isCompanion = user?.role === UserRole.COMPANION;

  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [data, setData] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  // 管理端：每个陪玩的报账微信码（点开就能扫）——老板 2026-09-29
  const [qrMap, setQrMap] = useState<Record<string, any>>({});
  // 真正按天看的日历：管理端先选一个陪玩，陪玩端默认自己
  const [calendar, setCalendar] = useState<any>({});
  const [selectedCompanionId, setSelectedCompanionId] = useState<string | undefined>();
  const [selectedDay, setSelectedDay] = useState<string>('');

  // 陪玩端：自己的钱包 + 报账/支取
  const [wallet, setWallet] = useState<any>({});
  const [reports, setReports] = useState<any[]>([]);

  const load = async (m: Dayjs) => {
    setLoading(true);
    try {
      const { data: res } = await billingApi.walletDaily(m.format('YYYY-MM'));
      companionsApi
        .list()
        .then((r: any) => {
          const map: Record<string, any> = {};
          ((r as any)?.data?.data || []).forEach((k: any) => { map[k.id] = k; });
          setQrMap(map);
        })
        .catch(() => setQrMap({}));
      setData(res.data || {});
      const first = res.data?.companions?.[0]?.companionId;
      if (first) setSelectedCompanionId((prev) => prev || first);
    } catch {
      setData({});
    } finally {
      setLoading(false);
    }
  };

  const loadCalendar = async (m: Dayjs, companionId?: string) => {
    if (!companionId) {
      setCalendar({});
      return;
    }
    try {
      const { data: res } = await billingApi.walletDaily(m.format('YYYY-MM'), companionId);
      setCalendar(res.data || {});
    } catch {
      setCalendar({});
    }
  };

  const loadCompanion = async () => {
    try {
      const [walletRes, reportRes, calendarRes] = await Promise.all([
        companionsApi.wallet(),
        expenseReportsApi.list(),
        billingApi.walletDaily(month.format('YYYY-MM')),
      ]);
      setWallet((walletRes as any)?.data?.data || {});
      setReports((reportRes as any)?.data?.data || []);
      setCalendar((calendarRes as any)?.data?.data || {});
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (isCompanion) {
      loadCompanion();
    } else {
      load(month);
    }
  }, [isCompanion, month]);

  // 管理端选中某个陪玩 / 切月份 → 拉这个人的按天日历
  useEffect(() => {
    if (!isCompanion) {
      setSelectedDay('');
      loadCalendar(month, selectedCompanionId);
    }
  }, [isCompanion, month, selectedCompanionId]);

  const dailyMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const d of calendar.daily || []) map.set(String(d.date), d);
    return map;
  }, [calendar]);

  const t = data.totals || {};
  const companions: any[] = data.companions || [];

  const filteredCompanions = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return companions;
    return companions.filter((c) =>
      `${c.name || ''} ${c.username || ''} ${c.realName || ''}`.toLowerCase().includes(kw),
    );
  }, [companions, keyword]);

  const selectedDaily = selectedDay ? dailyMap.get(selectedDay) : null;
  const calendarNode = (
    <Card
      size="small"
      title={isCompanion ? '我的报账 / 支取日历' : '陪玩报账 / 支取日历'}
      extra={
        !isCompanion ? (
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择陪玩看日历"
            value={selectedCompanionId}
            onChange={(v) => setSelectedCompanionId(v)}
            options={companions.map((c: any) => ({
              value: c.companionId,
              label: c.realName ? `${c.name}（${c.realName}）` : c.name,
            }))}
            style={{ width: 220 }}
          />
        ) : undefined
      }
      style={{ marginBottom: 16 }}
    >
      <Calendar
        value={month}
        onSelect={(d) => {
          if (d.month() !== month.month()) setMonth(d.startOf('month'));
          setSelectedDay(d.format('YYYY-MM-DD'));
        }}
        onPanelChange={(d) => {
          setMonth(d.startOf('month'));
          setSelectedDay('');
        }}
        cellRender={(current, info) => {
          if (info.type !== 'date') return info.originNode;
          const d = dailyMap.get(current.format('YYYY-MM-DD'));
          if (!d) return info.originNode;
          return (
            <div>
              {info.originNode}
              <div style={{ fontSize: 10, lineHeight: 1.45, marginTop: 1 }}>
                {d.income > 0 ? <div style={{ color: SEMANTIC.success }}>+{money(d.income)}</div> : null}
                {d.withdraw > 0 ? <div style={{ color: SEMANTIC.dangerDeep }}>-{money(d.withdraw)}</div> : null}
              </div>
            </div>
          );
        }}
      />
      {selectedDay ? (
        <div style={{ padding: '8px 4px 2px', borderTop: '1px solid #EEF2F7', marginTop: 8 }}>
          <Text strong>{selectedDay}</Text>
          {selectedDaily ? (
            <Space size={16} wrap style={{ marginLeft: 12 }}>
              <Text style={{ color: SEMANTIC.success }}>收入 ¥{money(selectedDaily.income)}（{selectedDaily.incomeCount} 笔）</Text>
              <Text style={{ color: SEMANTIC.dangerDeep }}>支取 ¥{money(selectedDaily.withdraw)}（{selectedDaily.withdrawCount} 笔）</Text>
              <Text>净额 ¥{money(selectedDaily.net)}</Text>
            </Space>
          ) : (
            <Text type="secondary" style={{ marginLeft: 12 }}>当天没有已通过的报账 / 支取</Text>
          )}
        </div>
      ) : null}
    </Card>
  );

  // 陪玩端：每天的报账（上报今日业绩）
  const dailyReports = useMemo(
    () =>
      reports
        .filter((r) => r.type === 'TODAY_REVENUE' || r.type === 'EXPENSE')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [reports],
  );

  // 陪玩端：支取明细
  const withdraws = useMemo(
    () =>
      (wallet.transactions || [])
        .filter((t: any) => t.type === 'WITHDRAW')
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [wallet.transactions],
  );

  const reportScreenshots = (r: any): string[] => {
    const list: string[] = [];
    if (r.screenshotUrl) list.push(r.screenshotUrl);
    try {
      const desc = JSON.parse(r.description || '{}');
      const screenshots = desc.screenshots || {};
      Object.values(screenshots).forEach((u) => {
        if (typeof u === 'string' && u && !list.includes(u)) list.push(u);
      });
    } catch {
      /* ignore */
    }
    return list;
  };

  // ── 陪玩端：精简视图 ──
  if (isCompanion) {
    return (
      <div>
        <PageHeader title="💰 我的报账与支取" subtitle="业绩、押金、每天的报账与支取明细" />

        {calendarNode}

        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={12}>
            <StatCard label="业绩" value={`¥${money(wallet.balance || 0)}`} tint={SEMANTIC.success} />
          </Col>
          <Col span={12}>
            <StatCard label="押金" value={`¥${money(wallet.deposit || 0)}`} tint={SEMANTIC.warningDeep} />
          </Col>
        </Row>

        <Card
          size="small"
          title="每天的报账"
          extra={<Text type="secondary">可支取 ¥{money(wallet.withdrawable || 0)}</Text>}
          style={{ marginBottom: 16 }}
        >
          <List
            dataSource={dailyReports}
            locale={{ emptyText: <EmptyState description="暂无报账记录" /> }}
            renderItem={(r: any) => {
              const shots = reportScreenshots(r);
              return (
                <List.Item style={{ flexWrap: 'wrap', gap: 12 }}>
                  <Space direction="vertical" size={4} style={{ minWidth: 140 }}>
                    <Text strong>{dayjs(r.createdAt).format('YYYY-MM-DD')}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(r.createdAt).format('HH:mm')}
                    </Text>
                    <StatusTag status={r.status} />
                  </Space>
                  <div style={{ fontWeight: 700, color: SEMANTIC.success, minWidth: 90 }}>
                    ¥{money(r.amount)}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1 }}>
                    {shots.length > 0 ? (
                      shots.map((u) => (
                        <Image
                          key={u}
                          src={u}
                          width={48}
                          height={48}
                          style={{ objectFit: 'cover', borderRadius: 6, border: '1px solid #E5E7EB' }}
                        />
                      ))
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>无截图</Text>
                    )}
                  </div>
                </List.Item>
              );
            }}
          />
        </Card>

        <Card size="small" title="支取明细">
          <List
            dataSource={withdraws}
            locale={{ emptyText: <EmptyState description="暂无支取记录" /> }}
            renderItem={(w: any) => (
              <List.Item>
                <Space direction="vertical" size={2}>
                  <Text strong>{dayjs(w.createdAt).format('YYYY-MM-DD HH:mm')}</Text>
                  <StatusTag status={w.status} />
                </Space>
                <div style={{ fontWeight: 700, color: SEMANTIC.dangerDeep }}>¥{money(w.amount)}</div>
              </List.Item>
            )}
          />
        </Card>
      </div>
    );
  }

  // ── 管理端：按陪玩汇总 ──
  return (
    <div>
      <PageHeader
        title="陪玩报账与支取日历"
        subtitle="选一个陪玩，按日历看每天收入 / 支取；下方是按陪玩汇总"
        extra={
          <DatePicker
            picker="month"
            value={month}
            allowClear={false}
            onChange={(v) => v && setMonth(v)}
          />
        }
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <StatCard label="本月收入" value={`¥${money(t.income || 0)}`} tint={SEMANTIC.success} />
        </Col>
        <Col span={8}>
          <StatCard label="本月支取" value={`¥${money(t.withdraw || 0)}`} tint={SEMANTIC.dangerDeep} />
        </Col>
        <Col span={8}>
          <StatCard
            label="本月净额"
            value={`¥${money(t.net || 0)}`}
            tint={(t.net || 0) >= 0 ? SEMANTIC.success : SEMANTIC.dangerDeep}
          />
        </Col>
      </Row>

      {calendarNode}

      <Card size="small">
        <Spin spinning={loading}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索陪玩姓名 / 账号"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ width: 280, marginBottom: 12 }}
          />
          <Table
            scroll={{ x: 990 }}
            rowKey="companionId"
            size="small"
            dataSource={filteredCompanions}
            onRow={(r: any) => ({
              onClick: () => setSelectedCompanionId(r.companionId),
              style: { cursor: 'pointer' },
            })}
            pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
            locale={{ emptyText: <EmptyState description="本月暂无已通过业绩" /> }}
            columns={[
              { title: '#', width: 50, align: 'center' as const, render: (_: any, __: any, i: number) => i + 1 },
              {
                title: '陪玩',
                dataIndex: 'name',
                width: 170,
                render: (v: string, r: any) => (
                  <span>
                    {v}
                    {r.realName && r.realName !== v ? (
                      <Text type="secondary" style={{ fontSize: 11 }}>（{r.realName}）</Text>
                    ) : null}
                  </span>
                ),
              },
              { title: '本月收入', dataIndex: 'income', width: 120, align: 'right' as const, sorter: (a: any, b: any) => a.income - b.income, render: (v: number) => <span style={{ color: SEMANTIC.success }}>¥{money(v)}</span> },
              { title: '本月支取', dataIndex: 'withdraw', width: 120, align: 'right' as const, render: (v: number) => <span style={{ color: SEMANTIC.dangerDeep }}>¥{money(v)}</span> },
              { title: '净额', dataIndex: 'net', width: 120, align: 'right' as const, sorter: (a: any, b: any) => a.net - b.net, render: (v: number) => <span style={{ color: v >= 0 ? SEMANTIC.success : SEMANTIC.dangerDeep }}>¥{money(v)}</span> },
              { title: '收入笔数', dataIndex: 'incomeCount', width: 90, align: 'center' as const },
              { title: '支取笔数', dataIndex: 'withdrawCount', width: 90, align: 'center' as const },
              { title: '最近一笔', dataIndex: 'lastDate', width: 120, render: (v: string) => v || '-' },
              {
                title: '报账微信码', width: 110,
                render: (_: any, r: any) => (
                  <PayoutQrScan
                    url={qrMap[r.companionId]?.payoutQrUrl}
                    who={r.name || r.realName}
                    updatedAt={qrMap[r.companionId]?.payoutQrUpdatedAt}
                  />
                ),
              },
            ]}
          />
        </Spin>
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          📌 收入 = 结算分成 + 押金；支取 = 提现；只统计已通过的业绩。净额 = 收入 − 支取。
        </Text>
      </Card>
    </div>
  );
};

export default CompanionWalletCalendarPage;
