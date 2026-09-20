// craftsman-ignore: TS001,TS002,TS003
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Typography,
  message,
  DatePicker,
  Tag,
  Statistic,
  Row,
  Col,
  Select,
} from 'antd';
import { ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { bridgeApi, BridgeSettlement, BridgeSettlementRow } from '../api/bridge';

const { Text } = Typography;

const money = (v: number | undefined) => `¥${Number(v || 0).toFixed(2)}`;

const ROLE_LABEL: Record<string, string> = {
  PRIMARY: '主陪',
  CO: '搭档',
  SPLIT: '分成',
};

/**
 * 桥接往来对账（老板 2026-09-21 口径）：
 * 桥接 = 双方能互相抢单、人员互通；系统**只统计**谁接了谁的单、该给对方店多少钱，
 * 钱由两个店长在微信上定期互相结，这里不做任何自动转账。
 */
const BridgeSettlementPanel: React.FC = () => {
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [peerId, setPeerId] = useState<string | undefined>(undefined);
  const [data, setData] = useState<BridgeSettlement | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await bridgeApi.settlement(month.format('YYYY-MM'), peerId);
      setData((res.data as any)?.data || null);
    } catch {
      message.error('加载桥接往来失败');
    } finally {
      setLoading(false);
    }
  }, [month, peerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totals = data?.totals;
  const rows: BridgeSettlementRow[] = data?.rows || [];
  const peers = data?.peers || [];
  const net = Number(totals?.net || 0);

  const peerOptions = useMemo(
    () => peers.map((p) => ({ label: p.peerStudioName, value: p.peerStudioId })),
    [peers],
  );

  const netLabel = net > 0 ? `对方应给我 ${money(net)}` : net < 0 ? `我应付对方 ${money(-net)}` : '账已平';

  const copyDetail = async () => {
    if (!data) return;
    const lines = [
      `【桥接往来对账 ${data.month}】`,
      `对方陪我店的单：${totals?.inboundCount || 0} 单，业绩 ${money(totals?.inboundAmount)} → 我应付 ${money(totals?.payable)}`,
      `我店陪对方店的单：${totals?.outboundCount || 0} 单，业绩 ${money(totals?.outboundAmount)} → 我应收 ${money(totals?.receivable)}`,
      `净额：${netLabel}`,
      '— 明细 —',
      ...rows.map((r) => {
        const day = String(r.finishedAt || r.createdAt || '').slice(0, 10);
        const dir = r.direction === 'INBOUND' ? `我付${r.peerStudioName}` : `${r.peerStudioName}付我`;
        return `${day} ${r.orderCode || r.orderId.slice(0, 8)} ${r.gameName || ''} 客户${r.customerWechat || r.customerCode || '-'} ${r.companionName}(${r.companionStudioName}) 业绩${money(r.amount)} ${r.companionPct}% 应给${money(r.companionShare)} ${dir}`;
      }),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      message.success('明细已复制，可直接发微信');
    } catch {
      message.error('复制失败，请手动选中表格复制');
    }
  };

  const peerColumns = [
    { title: '对方工作室', dataIndex: 'peerStudioName', render: (v: string) => <Text strong>{v}</Text> },
    {
      title: '对方陪我店（我应付）',
      dataIndex: 'payable',
      render: (v: number, r: any) => (
        <Text style={{ color: v ? '#cf1322' : undefined }}>
          {money(v)} <Text type="secondary">（{r.payableCount} 单）</Text>
        </Text>
      ),
    },
    {
      title: '我陪对方店（我应收）',
      dataIndex: 'receivable',
      render: (v: number, r: any) => (
        <Text style={{ color: v ? '#389e0d' : undefined }}>
          {money(v)} <Text type="secondary">（{r.receivableCount} 单）</Text>
        </Text>
      ),
    },
    {
      title: '净额',
      dataIndex: 'net',
      render: (v: number) => {
        const val = Number(v || 0);
        return (
          <Text strong style={{ color: val > 0 ? '#389e0d' : val < 0 ? '#cf1322' : undefined }}>
            {val > 0 ? `对方给我 ${money(val)}` : val < 0 ? `我给对方 ${money(-val)}` : '已平'}
          </Text>
        );
      },
    },
  ];

  const detailColumns = [
    {
      title: '完成时间',
      key: 'when',
      width: 105,
      render: (_: unknown, r: BridgeSettlementRow) =>
        r.finishedAt || r.createdAt
          ? dayjs(r.finishedAt || r.createdAt).format('MM-DD HH:mm')
          : '-',
    },
    {
      title: '方向',
      key: 'direction',
      width: 132,
      render: (_: unknown, r: BridgeSettlementRow) => (
        <>
          {r.direction === 'INBOUND' ? (
            <Tag color="red" style={{ margin: 0 }}>
              对方陪我店 · 我付
            </Tag>
          ) : (
            <Tag color="green" style={{ margin: 0 }}>
              我陪对方店 · 我收
            </Tag>
          )}
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              发单：{r.publisherStudioName}
            </Text>
          </div>
        </>
      ),
    },
    { title: '单号', dataIndex: 'orderCode', width: 118, render: (v: string, r: BridgeSettlementRow) => v || r.orderId.slice(0, 8) },
    { title: '游戏', dataIndex: 'gameName', width: 80 },
    {
      title: '客户',
      key: 'customer',
      width: 100,
      render: (_: unknown, r: BridgeSettlementRow) => r.customerWechat || r.customerCode || '-',
    },
    {
      title: '接单陪玩',
      key: 'companion',
      width: 145,
      render: (_: unknown, r: BridgeSettlementRow) => (
        <Text style={{ fontSize: 12 }}>
          {r.companionName}
          <Text type="secondary">（{r.companionStudioName}·{ROLE_LABEL[r.role] || r.role}）</Text>
        </Text>
      ),
    },
    { title: '业绩', dataIndex: 'amount', width: 88, render: (v: number) => money(v) },
    { title: '比例', dataIndex: 'companionPct', width: 58, render: (v: number) => `${v}%` },
    {
      title: '应给对方的钱',
      dataIndex: 'companionShare',
      width: 118,
      render: (v: number) => <Text strong>{money(v)}</Text>,
    },
    { title: '发单店留下', dataIndex: 'studioShare', width: 100, render: (v: number) => money(v) },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12 }} wrap>
        <DatePicker
          picker="month"
          value={month}
          onChange={(v) => v && setMonth(v)}
          allowClear={false}
        />
        <Select
          allowClear
          style={{ width: 180 }}
          placeholder="全部桥接工作室"
          value={peerId}
          onChange={setPeerId}
          options={peerOptions}
        />
        <Button icon={React.createElement(ReloadOutlined)} onClick={fetchData} loading={loading}>
          刷新
        </Button>
        <Button
          icon={React.createElement(CopyOutlined)}
          onClick={copyDetail}
          disabled={!rows.length}
        >
          复制明细（发微信）
        </Button>
      </Space>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="我应付对方（对方陪我店的单）"
              value={totals?.payable || 0}
              precision={2}
              prefix="¥"
              suffix={`${totals?.inboundCount || 0} 单`}
              valueStyle={{ color: totals?.payable ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="我应收对方（我陪对方店的单）"
              value={totals?.receivable || 0}
              precision={2}
              prefix="¥"
              suffix={`${totals?.outboundCount || 0} 单`}
              valueStyle={{ color: totals?.receivable ? '#389e0d' : undefined }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="净额"
              value={Math.abs(net)}
              precision={2}
              prefix={net > 0 ? '+¥' : net < 0 ? '−¥' : '¥'}
              suffix={net > 0 ? '对方该给我' : net < 0 ? '我该给对方' : '已平'}
            />
          </Card>
        </Col>
      </Row>

      {peers.length > 0 && (
        <Card size="small" title="按工作室分开算（一家店一笔账）" style={{ marginBottom: 16 }}>
          <Table
            rowKey="peerStudioId"
            size="small"
            pagination={false}
            dataSource={peers}
            columns={peerColumns as any}
          />
        </Card>
      )}

      <Card size="small" title={`${month.format('YYYY-MM')} 桥接往来明细（${rows.length} 单）`}>
        <Table
          rowKey={(r: BridgeSettlementRow) => `${r.orderId}-${r.companionId}`}
          size="small"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          dataSource={rows}
          columns={detailColumns as any}
          scroll={{ x: 1150 }}
          locale={{ emptyText: '这个月两家店之间没有互相接单' }}
        />
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          📌 口径：发单店收客户的钱，接单陪玩的提成由他自己店发工资，所以<b>发单店要把「陪玩那一份」还给对方店</b>，
          剩下的（工作室 + 客服 + 店长那份）留在发单店。比例按陪玩自己店的分成阶梯、按他当月总流水落档，
          和月末发工资用的是同一套数。月份按营业月（每日 12:00 为界）。本页<b>只统计、不自动转账</b>，
          两个店长在微信上按这个数互相结即可，结完不用在这里改动任何数据。
        </Text>
      </Card>
    </div>
  );
};

export default BridgeSettlementPanel;
