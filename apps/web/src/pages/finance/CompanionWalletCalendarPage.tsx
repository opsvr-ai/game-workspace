// craftsman-ignore: TS001,TS002,TS003
import React, { useEffect, useMemo, useState } from 'react';
import { Card, Statistic, Row, Col, Spin, Typography, Table, Input, DatePicker, Empty, Tag, Image, List, Space } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { UserRole } from '@chunlv/shared';
import { billingApi } from '../../api/billing';
import { companionsApi } from '../../api/companions';
import { expenseReportsApi } from '../../api/expenses';
import PageHeader from '../../components/PageHeader';
import { useAuthStore } from '../../stores/authStore';

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

  // 陪玩端：自己的钱包 + 报账/支取
  const [wallet, setWallet] = useState<any>({});
  const [reports, setReports] = useState<any[]>([]);

  const load = async (m: Dayjs) => {
    setLoading(true);
    try {
      const { data: res } = await billingApi.walletDaily(m.format('YYYY-MM'));
      setData(res.data || {});
    } catch {
      setData({});
    } finally {
      setLoading(false);
    }
  };

  const loadCompanion = async () => {
    try {
      const [walletRes, reportRes] = await Promise.all([
        companionsApi.wallet(),
        expenseReportsApi.list(),
      ]);
      setWallet((walletRes as any)?.data?.data || {});
      setReports((reportRes as any)?.data?.data || []);
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

  const t = data.totals || {};
  const companions: any[] = data.companions || [];

  const filteredCompanions = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return companions;
    return companions.filter((c) =>
      `${c.name || ''} ${c.username || ''} ${c.realName || ''}`.toLowerCase().includes(kw),
    );
  }, [companions, keyword]);

  // 陪玩端：每天的报账（上报今日流水）
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
        <PageHeader title="💰 我的报账与支取" subtitle="余额、押金、每天的报账与支取明细" />

        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={12}>
            <Card size="small">
              <Statistic title="余额" value={wallet.balance || 0} prefix="¥" precision={1} valueStyle={{ color: '#16A34A', fontSize: 28 }} />
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small">
              <Statistic title="押金" value={wallet.deposit || 0} prefix="¥" precision={1} valueStyle={{ color: '#B45309', fontSize: 28 }} />
            </Card>
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
            locale={{ emptyText: <Empty description="暂无报账记录" /> }}
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
                  <div style={{ fontWeight: 700, color: '#16A34A', minWidth: 90 }}>
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
            locale={{ emptyText: <Empty description="暂无支取记录" /> }}
            renderItem={(w: any) => (
              <List.Item>
                <Space direction="vertical" size={2}>
                  <Text strong>{dayjs(w.createdAt).format('YYYY-MM-DD HH:mm')}</Text>
                  <StatusTag status={w.status} />
                </Space>
                <div style={{ fontWeight: 700, color: '#cf1322' }}>¥{money(w.amount)}</div>
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
        title="📊 陪玩报账与支取统计"
        subtitle="按陪玩汇总本月收入与支取"
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
          <Card size="small">
            <Statistic title="本月收入" value={t.income || 0} prefix="¥" precision={1} valueStyle={{ color: '#16A34A' }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="本月支取" value={t.withdraw || 0} prefix="¥" precision={1} valueStyle={{ color: '#cf1322' }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="本月净额"
              value={t.net || 0}
              prefix="¥"
              precision={1}
              valueStyle={{ color: (t.net || 0) >= 0 ? '#16A34A' : '#cf1322' }}
            />
          </Card>
        </Col>
      </Row>

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
            rowKey="companionId"
            size="small"
            dataSource={filteredCompanions}
            pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
            locale={{ emptyText: <Empty description="本月暂无已通过流水" /> }}
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
              { title: '本月收入', dataIndex: 'income', width: 120, align: 'right' as const, sorter: (a: any, b: any) => a.income - b.income, render: (v: number) => <span style={{ color: '#16A34A' }}>¥{money(v)}</span> },
              { title: '本月支取', dataIndex: 'withdraw', width: 120, align: 'right' as const, render: (v: number) => <span style={{ color: '#cf1322' }}>¥{money(v)}</span> },
              { title: '净额', dataIndex: 'net', width: 120, align: 'right' as const, sorter: (a: any, b: any) => a.net - b.net, render: (v: number) => <span style={{ color: v >= 0 ? '#16A34A' : '#cf1322' }}>¥{money(v)}</span> },
              { title: '收入笔数', dataIndex: 'incomeCount', width: 90, align: 'center' as const },
              { title: '支取笔数', dataIndex: 'withdrawCount', width: 90, align: 'center' as const },
              { title: '最近一笔', dataIndex: 'lastDate', width: 120, render: (v: string) => v || '-' },
            ]}
          />
        </Spin>
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          📌 收入 = 结算分成 + 押金；支取 = 提现；只统计已通过的流水。净额 = 收入 − 支取。
        </Text>
      </Card>
    </div>
  );
};

export default CompanionWalletCalendarPage;
