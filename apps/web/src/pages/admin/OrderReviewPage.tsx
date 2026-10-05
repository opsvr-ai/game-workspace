// craftsman-ignore: TS001,TS002,TS003
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Input, Modal, Radio, Row, Space, Statistic, Table, Tag, Typography, message,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ordersApi } from '../../api/orders';
import { useAuthStore } from '../../stores/authStore';
import PageHeader from '../../components/PageHeader';
import { extractErrorMessage } from '../../utils/error-handler';

const { Text, Paragraph } = Typography;

/**
 * 成交核对（老板 2026-10-06）
 *
 * 老板原话：「接单方点成功那就推给发单者计入考核；失败的推给发单者 + 店长。店长最终拍板
 * 这个到底是谁的原因、到底谁的问题，谁的问题就去找谁；失败的还得粘贴上截图。
 * 成功的不用重点追查，重点追查失败的。」
 *
 * 老板 2026-10-06 又补一步：「失败单先由发单客服点『已跟接单方确认、双方无异议』，
 * 才轮到店长审核拍板」——「他们不跟发单者掰扯明白，直接进店长，那不把店长累死」。
 * 所以「待拍板」里再分两段：等发单客服核对 → 等店长拍板。
 *
 * 所以这一页就四类：
 *  - 待拍板：接单方报了「不成功」还没定责的（带截图）——先让发单客服跟接单方核对，再轮到店长拍板；
 *  - 抢了没结果：抢走 30 分钟了还没点开始首单 / 没反馈、**还在 7 天以内**的（线下的、桥接 / 线上的都在）；
 *  - 历史记录：上面那批**满了 7 天**的（陪玩那边两次提醒走完就进这儿，不再占着要在清单，随时可翻）；
 *  - 已拍板：最近拍过板的留痕，可回看。
 */

const RESPONSIBILITIES = [
  { value: 'COMPANION', label: '接单方的问题' },
  { value: 'CS', label: '发单客服的问题' },
  { value: 'CUSTOMER', label: '客户的问题' },
  { value: 'NONE', label: '谁都没问题（不可抗力）' },
];

const RESP_LABEL: Record<string, string> = {
  COMPANION: '接单方的问题',
  CS: '发单客服的问题',
  CUSTOMER: '客户的问题',
  NONE: '谁都没问题',
};

function fmt(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function ago(v?: string | null): string {
  if (!v) return '—';
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return '—';
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const h = Math.floor(min / 60);
  if (h < 24) return h + ' 小时前';
  return Math.floor(h / 24) + ' 天前';
}

function money(o: any): string {
  const total = (Number(o?.amount || 0) + Number(o?.coAmount || 0)) * (Number(o?.duration) || 1);
  return total ? total.toFixed(0) + ' 元' : '—';
}

const OrderReviewPage: React.FC = () => {
  const user = useAuthStore((s: any) => s.user);
  const canDecide = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const isCs = user?.role === 'CS';
  const [tab, setTab] = useState<'waiting' | 'recheck' | 'archived' | 'decided'>('waiting');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({ waiting: 0, waitingCs: 0, waitingDecide: 0, recheck: 0 });
  const [target, setTarget] = useState<any>(null);
  const [responsibility, setResponsibility] = useState<string>('COMPANION');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [csTarget, setCsTarget] = useState<any>(null);
  const [csNote, setCsNote] = useState('');
  const [csSaving, setCsSaving] = useState(false);

  const fetchList = useCallback(async (scope: 'waiting' | 'recheck' | 'archived' | 'decided') => {
    setLoading(true);
    try {
      const { data } = await ordersApi.orderReviews(scope);
      setRows((data as any)?.data || []);
    } catch (e: any) {
      message.error(extractErrorMessage(e, '加载成交核对失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const { data } = await ordersApi.orderReviewSummary();
      const d = (data as any)?.data || {};
      setSummary({
        waiting: Number(d.waiting || 0),
        waitingCs: Number(d.waitingCs ?? d.waiting ?? 0),
        waitingDecide: Number(d.waitingDecide || 0),
        recheck: Number(d.recheck || 0),
      });
    } catch {
      /* 红点拿不到就算了，不影响清单 */
    }
  }, []);

  useEffect(() => {
    void fetchList(tab);
  }, [tab, fetchList]);

  useEffect(() => {
    void fetchSummary();
    const timer = setInterval(() => void fetchSummary(), 60 * 1000);
    return () => clearInterval(timer);
  }, [fetchSummary]);

  const openDecide = (row: any) => {
    setTarget(row);
    setResponsibility(row.channel === 'offline' ? 'COMPANION' : 'NONE');
    setNote('');
  };

  /** 发单客服点「已跟接单方确认、双方无异议」——失败单先过这一步才轮到店长拍板。 */
  const openConfirmCs = (row: any) => {
    setCsTarget(row);
    setCsNote('');
  };

  const submitConfirmCs = async () => {
    if (!csTarget) return;
    setCsSaving(true);
    try {
      await ordersApi.confirmOutcomeWithCs(csTarget.id, { note: csNote.trim() || undefined });
      message.success('已确认，等店长拍板');
      setCsTarget(null);
      await fetchList(tab);
      void fetchSummary();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '确认失败'));
    } finally {
      setCsSaving(false);
    }
  };

  const submitDecide = async () => {
    if (!target) return;
    if (!note.trim()) {
      message.warning('写清楚结论：到底谁的问题、后面怎么处理');
      return;
    }
    setSaving(true);
    try {
      await ordersApi.reviewOutcome(target.id, { responsibility: responsibility as any, note: note.trim() });
      message.success('已拍板，接单方和发单客服都收到了结论');
      setTarget(null);
      await fetchList(tab);
      void fetchSummary();
    } catch (e: any) {
      message.error(extractErrorMessage(e, '拍板失败'));
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: '订单',
      key: 'order',
      width: 150,
      render: (_: unknown, o: any) => (
        <div style={{ lineHeight: '18px' }}>
          <div>
            <Text strong>{o.orderCode || o.id.slice(0, 8)}</Text>
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
              {o.channel === 'offline' ? '本店线下' : o.channel === 'online' ? '线上俱乐部' : '桥接'}
            </Text>
          </div>
          <div style={{ fontSize: 12, color: '#475569' }}>
            {o.gameName || '—'} · {money(o)}
          </div>
        </div>
      ),
    },
    {
      title: '客户',
      key: 'customer',
      width: 150,
      render: (_: unknown, o: any) => (
        <div style={{ lineHeight: '18px' }}>
          <div>{o.customerCode || o.customerWechat || '—'}</div>
          <div style={{ fontSize: 11, color: '#94A3B8' }}>微信 {o.customerWechat || '—'}</div>
        </div>
      ),
    },
    {
      title: '发单客服 / 接单方',
      key: 'who',
      width: 170,
      render: (_: unknown, o: any) => (
        <div style={{ lineHeight: '18px' }}>
          <div>发单：{o.csUserName || '—'}</div>
          <div style={{ fontSize: 11, color: '#94A3B8' }}>
            接单：{o.companionName || '—'}
            {o.coCompanionName ? '+' + o.coCompanionName : ''}
            {o.companionStudioName && o.channel !== 'offline' ? '（' + o.companionStudioName + '）' : ''}
          </div>
        </div>
      ),
    },
    {
      title: '接单方报的',
      key: 'outcome',
      render: (_: unknown, o: any) => (
        <div style={{ lineHeight: '18px' }}>
          {o.outcome === 'FAILED' ? (
            <Tag color="red" style={{ margin: 0 }}>
              不成功
            </Tag>
          ) : o.outcome === 'SUCCESS' ? (
            <Tag color="green" style={{ margin: 0 }}>
              成功
            </Tag>
          ) : (
            <Tag color="orange" style={{ margin: 0 }}>
              还没结果
            </Tag>
          )}
          <span style={{ marginLeft: 6 }}>{o.outcomeReason || ''}</span>
          {o.outcomeNote ? <div style={{ fontSize: 11, color: '#64748B' }}>{o.outcomeNote}</div> : null}
          {o.started ? (
            <div style={{ fontSize: 11, color: '#16A34A' }}>已点开始首单</div>
          ) : (
            <div style={{ fontSize: 11, color: '#94A3B8' }}>抢单 {ago(o.grabbedAt)}</div>
          )}
        </div>
      ),
    },
    {
      title: '截图（失败凭据）',
      key: 'evidence',
      width: 150,
      render: (_: unknown, o: any) =>
        Array.isArray(o.evidence) && o.evidence.length ? (
          <Space size={4} wrap>
            {o.evidence.map((url: string) => (
              <img
                key={url}
                src={url}
                alt="失败凭据"
                style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, border: '1px solid #E2E8F0', cursor: 'pointer' }}
                onClick={() => window.open(url, '_blank')}
              />
            ))}
          </Space>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {o.outcome === 'FAILED' ? '没有截图（老数据）' : '—'}
          </Text>
        ),
    },
    {
      title: '拍板 / 状态',
      key: 'review',
      width: 190,
      render: (_: unknown, o: any) => {
        if (o.reviewStatus === 'DECIDED') {
          return (
            <div style={{ lineHeight: '18px' }}>
              <Tag color="blue" style={{ margin: 0 }}>
                {RESP_LABEL[o.reviewResponsibility] || '已拍板'}
              </Tag>
              <div style={{ fontSize: 11, color: '#64748B' }}>{o.reviewNote}</div>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>{fmt(o.reviewAt)}</div>
            </div>
          );
        }
        if (o.outcome === 'FAILED') {
          // 第一段：还没过发单本人核对 —— 谁发单谁跟接单方掰扯明白（老板 2026-10-06）。
          if (o.reviewStatus !== 'CS_CONFIRMED') {
            if (o.csUserId === user?.id) {
              return (
                <Space direction="vertical" size={2}>
                  <Button size="small" type="primary" onClick={() => openConfirmCs(o)}>
                    已跟接单方确认、无异议
                  </Button>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    核对完才轮到店长拍板
                  </Text>
                </Space>
              );
            }
            return (
              <Space direction="vertical" size={2}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  等发单的人{o.csUserName ? '（' + o.csUserName + '）' : ''}跟接单方核对
                </Text>
                {canDecide ? (
                  <Button size="small" onClick={() => openConfirmCs(o)}>
                    代发单者确认
                  </Button>
                ) : null}
              </Space>
            );
          }
          // 第二段：客服已核对完，轮到店长拍板。
          return canDecide ? (
            <Space direction="vertical" size={2}>
              <Button size="small" type="primary" danger onClick={() => openDecide(o)}>
                拍板定责
              </Button>
              <Text type="secondary" style={{ fontSize: 11 }}>
                客服已核对{fmt(o.csConfirmedAt)}
              </Text>
            </Space>
          ) : (
            <Text type="secondary" style={{ fontSize: 11 }}>
              客服已核对{fmt(o.csConfirmedAt)}，等店长拍板
            </Text>
          );
        }
        return (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {o.started ? '开始首单了，不用核' : '催接单方给个结果'}
          </Text>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="成交核对"
        subtitle="接单方报「不成功」→ 先由发单客服跟接单方核对（无异议）→ 再轮店长拍板定责；抢了没结果的 7 天内在这儿催，满 7 天自动进「历史记录」"
        extra={
          <Button
            icon={React.createElement(ReloadOutlined)}
            onClick={() => {
              void fetchList(tab);
              void fetchSummary();
            }}
            loading={loading}
          >
            刷新
          </Button>
        }
      />

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title={canDecide ? '① 等发单的人核对（在跟接单方掰扯）' : '① 等我核对（我发的单）'}
              value={summary.waitingCs}
              valueStyle={{ color: summary.waitingCs ? '#D97706' : '#16A34A' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="② 等店长拍板（客服已核对完）"
              value={summary.waitingDecide}
              valueStyle={{ color: summary.waitingDecide ? '#DC2626' : '#16A34A' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="抢了没结果（7 天内）"
              value={summary.recheck}
              valueStyle={{ color: summary.recheck ? '#D97706' : '#16A34A' }}
            />
          </Card>
        </Col>
      </Row>

      {summary.waiting > 0 && tab !== 'waiting' ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            '有 ' + summary.waiting + ' 张报「不成功」的单还没走完：' +
            summary.waitingCs + ' 张等发单客服跟接单方核对、' + summary.waitingDecide + ' 张等店长拍板'
          }
          action={
            <Button size="small" danger onClick={() => setTab('waiting')}>
              去拍板
            </Button>
          }
        />
      ) : null}

      <Card
        size="small"
        tabList={[
          { key: 'waiting', tab: '待拍板（' + summary.waiting + '）' },
          { key: 'recheck', tab: '抢了没结果（' + summary.recheck + '）' },
          { key: 'archived', tab: '历史记录' },
          { key: 'decided', tab: '已拍板' },
        ]}
        activeTabKey={tab}
        onTabChange={(k) => setTab(k as any)}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={rows}
          columns={columns as any}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 980 }}
          locale={{
            emptyText:
              tab === 'waiting'
                ? '没有待拍板的失败单 —— 干净'
                : tab === 'recheck'
                  ? '没有 7 天内还挂着没结果的单'
                  : tab === 'archived'
                    ? '历史记录里还没有单'
                    : '还没有拍过板',
          }}
        />
      </Card>

      <Modal
        title={'跟接单方核对：' + (csTarget?.orderCode || '')}
        open={!!csTarget}
        onOk={submitConfirmCs}
        onCancel={() => setCsTarget(null)}
        okText="确认：双方已核对、无异议"
        cancelText="取消"
        confirmLoading={csSaving}
        destroyOnClose
      >
        {csTarget ? (
          <div>
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              接单方 {csTarget.companionName || '—'} 报的「不成功」：{csTarget.outcomeReason || '未填原因'}
              {csTarget.outcomeNote ? '（' + csTarget.outcomeNote + '）' : ''}。
              **谁发的单谁来点这个确认**：先跟接单方把这事掰扯明白，确实没打成、双方都认，再点确认，
              然后就轮到店长拍板定责 —— 别把没核清楚的单直接堆给店长。
            </Paragraph>
            {Array.isArray(csTarget.evidence) && csTarget.evidence.length ? (
              <Space size={6} wrap style={{ marginBottom: 10 }}>
                {csTarget.evidence.map((url: string) => (
                  <img
                    key={url}
                    src={url}
                    alt="失败凭据"
                    style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid #E2E8F0', cursor: 'pointer' }}
                    onClick={() => window.open(url, '_blank')}
                  />
                ))}
              </Space>
            ) : null}
            <Text strong style={{ display: 'block', marginTop: 10 }}>
              核对说明（可选）
            </Text>
            <Input.TextArea
              rows={2}
              style={{ marginTop: 8 }}
              value={csNote}
              onChange={(e) => setCsNote(e.target.value)}
              placeholder="例如：已微信问过接单方，客户临时不打，双方都认；截图齐了"
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        title={'拍板：' + (target?.orderCode || '') + ' 这张单到底是谁的问题'}
        open={!!target}
        onOk={submitDecide}
        onCancel={() => setTarget(null)}
        okText="确认拍板"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnClose
      >
        {target ? (
          <div>
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              接单方 {target.companionName || '—'} 报的「不成功」：{target.outcomeReason || '未填原因'}
              {target.outcomeNote ? '（' + target.outcomeNote + '）' : ''}。拍板结果会同时推给接单方和发单客服，谁的问题就去找谁。
            </Paragraph>
            {Array.isArray(target.evidence) && target.evidence.length ? (
              <Space size={6} wrap style={{ marginBottom: 10 }}>
                {target.evidence.map((url: string) => (
                  <img
                    key={url}
                    src={url}
                    alt="失败凭据"
                    style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid #E2E8F0', cursor: 'pointer' }}
                    onClick={() => window.open(url, '_blank')}
                  />
                ))}
              </Space>
            ) : (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 10 }}
                message="这张单没有截图凭据（老数据 / 客服代录），定责前最好先在群里问清楚"
              />
            )}
            <Text strong>到底是谁的问题</Text>
            <div style={{ marginTop: 8 }}>
              <Radio.Group
                value={responsibility}
                onChange={(e) => setResponsibility(e.target.value)}
                options={RESPONSIBILITIES}
                optionType="button"
                buttonStyle="solid"
              />
            </div>
            <Text strong style={{ display: 'block', marginTop: 14 }}>
              结论 / 怎么处理（必填）
            </Text>
            <Input.TextArea
              rows={3}
              style={{ marginTop: 8 }}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：接单方没跟客户谈拢就报废，记一次；这张单不计发单客服提成，接单方按店规处理"
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

export default OrderReviewPage;
