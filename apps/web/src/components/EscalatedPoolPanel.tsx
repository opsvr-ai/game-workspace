import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, DatePicker, Row, Select, Space, Table, Tag, Typography, message } from 'antd';
import { DownloadOutlined, FileZipOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { ordersApi } from '../api/orders';
import http from '../api/client';
import { extractErrorMessage } from '../utils/error-handler';
import { visibleInterval } from '../hooks/usePolling';
import { createZip, type ZipEntry } from '../utils/zip';
import { buildEscalatedPoolCsv, safeFileName, STATE_MAP } from '../utils/escalated-pool-csv';
import { useAuthStore } from '../stores/authStore';
import { TEXT } from '../styles/tokens';

const { Text } = Typography;

/**
 * 「线下→线上流转」的单，线下没人接、被桥接工作室 / 线上俱乐部接走的统计 + 标注
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
  const user = useAuthStore((s) => s.user);
  /** 店长 / 老板可以按客服筛、看全店；客服只看自己名下（服务端也兜底，见 orders.controller）。 */
  const canPickCs = user?.role === 'ADMIN' || user?.role === 'OWNER';
  const [month, setMonth] = useState<string>(dayjs().format(MONTH_FMT));
  const [csUserId, setCsUserId] = useState<string>('');
  const [csOptions, setCsOptions] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);

  const load = useCallback(async (m: string, cs: string) => {
    setLoading(true);
    try {
      const { data } = await ordersApi.escalatedPool({ month: m, csUserId: cs || undefined });
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
    load(month, csUserId);
    const t = visibleInterval(() => load(month, csUserId), 120000);
    return () => clearInterval(t);
  }, [month, csUserId, load]);

  // 客服名单只有店长 / 老板会拉（客服端不请求这个接口）
  useEffect(() => {
    if (!canPickCs) return;
    http
      .get('/users/cs')
      .then(({ data }) => setCsOptions((data as any)?.data || []))
      .catch(() => {});
  }, [canPickCs]);

  /** 当前这份数据是「谁名下」的 —— 导出文件名和表头用。 */
  const scopeName = useMemo(() => {
    if (canPickCs) {
      if (!csUserId) return '全部客服';
      const hit = csOptions.find((c: any) => c.id === csUserId);
      return hit?.displayName || hit?.username || '指定客服';
    }
    return user?.displayName || user?.username || '我';
  }, [canPickCs, csUserId, csOptions, user]);

  /** 一份数据的 CSV 文本（共用工具里那份，界面和导出同源）。 */
  const buildCsvText = (data: { rows?: any[]; totals?: any }, scope: string): string =>
    buildEscalatedPoolCsv(month, scope, data);

  const downloadBlob = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** 导出「当前这份」：客服导自己名下的，店长 / 老板导当前选中的那个客服（或全店）。 */
  const exportCsv = () => {
    const csv = buildCsvText({ rows, totals }, scopeName);
    downloadBlob(
      new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }),
      `线下转桥接线上统计_${month}_${safeFileName(scopeName)}_${dayjs().format('YYYYMMDD_HHmm')}.csv`,
    );
    message.success(`已导出 ${rows.length} 单`);
  };

  /**
   * 一键导出全员：每个客服一张月表，打成一个 zip（老板 2026-09-29：「一键导出全体客服（一人一张月表）」）。
   * 每张表都现问服务端（口径跟界面上完全一致），最前面附一张「全店合计」。
   */
  const exportAllCsv = async () => {
    if (!csOptions.length) {
      message.warning('还没拿到客服名单，稍等一下再点');
      return;
    }
    setExportingAll(true);
    try {
      const [allRes, ...perCs] = await Promise.all([
        ordersApi.escalatedPool({ month }),
        ...csOptions.map((c: any) => ordersApi.escalatedPool({ month, csUserId: c.id })),
      ]);
      const files: ZipEntry[] = [
        {
          name: `线下转桥接线上统计_${month}_全店合计.csv`,
          content: buildCsvText(((allRes.data as any)?.data || {}) as any, '全部客服'),
        },
      ];
      csOptions.forEach((c: any, idx: number) => {
        const name = c.displayName || c.username || c.id;
        files.push({
          name: `线下转桥接线上统计_${month}_${safeFileName(name)}.csv`,
          content: buildCsvText(((perCs[idx].data as any)?.data || {}) as any, name),
        });
      });
      downloadBlob(
        createZip(files),
        `线下转桥接线上统计_${month}_全员_${dayjs().format('YYYYMMDD_HHmm')}.zip`,
      );
      message.success(`已打包 ${csOptions.length} 个客服的月表（另附全店合计）`);
    } catch (e: any) {
      message.error(extractErrorMessage(e, '导出失败'));
    } finally {
      setExportingAll(false);
    }
  };

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
          <div style={{ fontSize: 12, color: TEXT.secondary }}>{r.destinationStudioName || '—'}</div>
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
              <span style={{ color: TEXT.tertiary }}>还没记录收款去向</span>
            )}
            {(r.moneyInYuan > 0 || r.moneyOutYuan > 0) && (
              <div style={{ color: TEXT.secondary, marginTop: 2 }}>
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
        const s = STATE_MAP[v] || { text: v || '—', color: TEXT.heading };
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
          {canPickCs ? (
            <Select
              size="small"
              style={{ width: 150 }}
              value={csUserId || undefined}
              onChange={(v) => setCsUserId(v || '')}
              placeholder="全部客服"
              allowClear
              showSearch
              optionFilterProp="label"
              options={csOptions.map((c: any) => ({
                value: c.id,
                label: c.displayName || c.username || c.id,
              }))}
            />
          ) : (
            <Tag color="blue">只看我自己（{scopeName}）</Tag>
          )}
          <Button size="small" icon={<DownloadOutlined />} onClick={exportCsv} disabled={loading}>
            导出 CSV
          </Button>
          {canPickCs && (
            <Button
              size="small"
              icon={<FileZipOutlined />}
              onClick={exportAllCsv}
              loading={exportingAll}
              disabled={loading || !csOptions.length}
            >
              一键导出全员（一人一张）
            </Button>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            只统计「线下→线上流转」的单：本店线下先抢、没人接被桥接工作室 / 线上俱乐部接走的（含待反馈）；
            导出的 CSV 带上面的汇总，Excel 双击就能开
          </Text>
        </div>
      </Card>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Text type="secondary">被接走</Text>
            <div style={{ fontSize: 22, fontWeight: 600 }}>
              {totals.count || 0} 单
              <span style={{ fontSize: 13, color: TEXT.secondary, marginLeft: 8 }}>
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
