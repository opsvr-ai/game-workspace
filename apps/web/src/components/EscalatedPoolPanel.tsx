import React, { useCallback, useEffect, useState } from 'react';
import { Card, Col, DatePicker, Row, Space, Table, Tag, Typography, message } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { ordersApi } from '../api/orders';
import { extractErrorMessage } from '../utils/error-handler';
import { visibleInterval } from '../hooks/usePolling';

const { Text } = Typography;

/**
 * 「线下+线上流转入池」的单，线下没人接、被桥接工作室 / 线上俱乐部接走的统计 + 标注
 * （老板 2026-09-29）。
 *
 * 老板原话：「选择线下+线上入池的时候，线下没人接，被桥接工作室或者线上俱乐部接走你要做好统计，
 * 并做好标注，被桥接工作室接走的是首单不结的模式，记录好机密还是绝密、应收多少，钱在哪里等信息
 * 并做好汇总，被线上俱乐部接走的 是按照抽成的模式」。
 *
 * 这页只做「看」：每张单标出去向、结算模式、机密/绝密、单量、应收、应返还、钱在哪，
 * 顶部给一份按月的汇总。算钱口径全部在后端 `listEscalatedPoolOrders` 里，前端只显示。
 */

const yuan = (n: unknown) => `¥${Number(n || 0).toFixed(2)}`;

const MONTH_FMT = 'YYYY-MM';

const EscalatedPoolPanel: React.FC = () => {
  const [month, setMonth] = useState<string>(dayjs().format(MONTH_FMT));
  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    try {
      const { data } = await ordersApi.escalatedPool({ month: m });
      const payload = (data as any)?.data || {};
      setRows(payload.rows || []);
      setTotals(payload.totals || {});
    } catch (e: any) {
      message.error(extractErrorMessage(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(month);
    const t = visibleInterval(() => load(month), 120000);
    return () => clearInterval(t);
  }, [month, load]);

  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 130,
      render: (v: string) => (v ? dayjs(v).format('MM-DD HH:mm') : '-'),
    },
    {
      title: '客户 / 客服',
      key: 'customer',
      width: 180,
      render: (_: any, r: any) => (
        <div>
          <div>{r.customerCode || r.customerWechat || '—'}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.csName || '—'} 派单
          </Text>
        </div>
      ),
    },
    {
      title: '游戏 / 任务',
      key: 'mission',
      width: 170,
      render: (_: any, r: any) => (
        <Space size={4} wrap>
          <span>{r.gameName}</span>
          {r.mission && <Tag color={r.mission === '绝密' ? 'red' : 'blue'}>{r.mission}</Tag>}
          <Tag>{r.countText}</Tag>
        </Space>
      ),
    },
    {
      title: '被谁接走',
      key: 'destination',
      width: 170,
      render: (_: any, r: any) => (
        <div>
          <Tag color={r.destination === '线上俱乐部' ? 'geekblue' : 'purple'}>{r.destination}</Tag>
          <div style={{ fontSize: 12, color: '#64748B' }}>{r.destinationStudioName || '—'}</div>
        </div>
      ),
    },
    {
      title: '结算模式',
      dataIndex: 'settleMode',
      width: 100,
      render: (v: string) => <Tag color={v === '首单不结' ? 'orange' : 'cyan'}>{v}</Tag>,
    },
    {
      title: '单量',
      dataIndex: 'units',
      width: 70,
      align: 'right' as const,
      render: (v: number) => `${v} 单`,
    },
    {
      title: '应收（流水）',
      dataIndex: 'grossYuan',
      width: 110,
      align: 'right' as const,
      render: (v: number) => <Text strong>{yuan(v)}</Text>,
    },
    {
      title: '应返还',
      dataIndex: 'returnYuan',
      width: 100,
      align: 'right' as const,
      render: (v: number) => (v > 0 ? <span style={{ color: '#DC2626' }}>{yuan(v)}</span> : '—'),
    },
    {
      title: '工作室净得',
      dataIndex: 'studioNetYuan',
      width: 110,
      align: 'right' as const,
      render: (v: number) => <span style={{ color: '#15803D' }}>{yuan(v)}</span>,
    },
    {
      title: '钱在哪里',
      key: 'moneyWhere',
      width: 240,
      render: (_: any, r: any) => {
        const bits: string[] = r.moneyWhere || [];
        return (
          <div style={{ fontSize: 12 }}>
            {bits.length ? (
              bits.map((b, i) => <div key={i}>{b}</div>)
            ) : (
              <span style={{ color: '#94A3B8' }}>还没记录收款去向</span>
            )}
            {(r.moneyInYuan > 0 || r.moneyOutYuan > 0) && (
              <div style={{ color: '#64748B', marginTop: 2 }}>
                已记流入 {yuan(r.moneyInYuan)} / 流出 {yuan(r.moneyOutYuan)}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: '结果',
      dataIndex: 'state',
      width: 100,
      render: (v: string, r: any) => {
        const map: Record<string, { text: string; color: string }> = {
          SUCCESS: { text: '成功', color: '#15803D' },
          FAILED: { text: '不成功', color: '#DC2626' },
          PENDING: { text: '待反馈', color: '#B45309' },
          NONE: { text: '已退款/取消', color: '#94A3B8' },
        };
        const s = map[v] || { text: v || '—', color: '#475569' };
        return (
          <span style={{ color: s.color }} title={r.stateReason || ''}>
            {s.text}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Text strong>线下转桥接 / 线上统计</Text>
          <DatePicker
            picker="month"
            allowClear={false}
            value={dayjs(month, MONTH_FMT)}
            onChange={(d: Dayjs | null) => d && setMonth(d.format(MONTH_FMT))}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            只统计「线下+线上流转入池」的单：本店线下先抢、没人接被桥接工作室 / 线上俱乐部接走的（含待反馈）
          </Text>
        </div>
      </Card>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Text type="secondary">被接走</Text>
            <div style={{ fontSize: 22, fontWeight: 600 }}>
              {totals.count || 0} 单
              <span style={{ fontSize: 13, color: '#64748B', marginLeft: 8 }}>
                桥接 {totals.bridgeCount || 0} / 线上 {totals.onlineCount || 0}
              </span>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              共 {totals.units || 0} 单量（机密 {totals.jimiUnits || 0} / 绝密 {totals.juejuUnits || 0}）
            </Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Text type="secondary">应收（客户流水）</Text>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{yuan(totals.grossYuan)}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              桥接 {yuan(totals.bridgeGrossYuan)} / 线上 {yuan(totals.onlineGrossYuan)}
            </Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Text type="secondary">应返还（绝密）</Text>
            <div style={{ fontSize: 22, fontWeight: 600, color: '#DC2626' }}>{yuan(totals.returnYuan)}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              桥接 {yuan(totals.bridgeReturnYuan)} / 线上 {yuan(totals.onlineReturnYuan)}
            </Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Text type="secondary">工作室净得</Text>
            <div style={{ fontSize: 22, fontWeight: 600, color: '#15803D' }}>{yuan(totals.studioNetYuan)}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              已记流入 {yuan(totals.moneyInYuan)} / 流出 {yuan(totals.moneyOutYuan)}
            </Text>
          </Card>
        </Col>
      </Row>

      <Card size="small">
        <Table
          rowKey="orderId"
          size="small"
          loading={loading}
          dataSource={rows}
          columns={columns as any}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 1500 }}
          locale={{ emptyText: '这个月还没有「线下没人接、被桥接 / 线上接走」的单' }}
        />
      </Card>
    </>
  );
};

export default EscalatedPoolPanel;
