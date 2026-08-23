import React, { useEffect, useState } from 'react';
import { Button, Card, Tag, Typography, message, Space, Row, Col } from 'antd';
import { ordersApi } from '../api/orders';
import { useChatStore } from '../stores/chatStore';
import OrderTable from './OrderTable';

const { Text } = Typography;

const companionName = (r: any) =>
  r.companion?.user?.displayName || r.companion?.user?.username || '';

const CsConvertedPanel: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [balances, setBalances] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [convRes, balRes] = await Promise.all([
        ordersApi.csConverted(),
        ordersApi.csWechatBalances(),
      ]);
      const raw = convRes.data.data || [];
      const rank: Record<string, number> = { 添加失败: 0, 待结果: 1, 添加成功: 2 };
      setItems([...raw].sort((a, b) => (rank[a.addStatus] ?? 9) - (rank[b.addStatus] ?? 9)));
      setBalances(balRes.data.data || []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const contactCompanion = async (r: any) => {
    if (!r.companionUserId) return;
    const participant = {
      userId: r.companionUserId,
      username: companionName(r),
      role: 'COMPANION',
    };
    const orderInfo = `${r.gameName} · 客户：${r.customer?.wechatId || r.customFields?.customerWechat || '-'}`;
    const convId = await useChatStore.getState().openConversation(r.companionUserId, participant as any, orderInfo);
    window.dispatchEvent(
      new CustomEvent('open-chat-modal', {
        detail: { conversationId: convId, participant, orderInfo },
      }),
    );
  };

  const destColor: Record<string, string> = {
    线下工作室: 'blue',
    桥接工作室: 'orange',
    线上俱乐部: 'purple',
  };

  const extraColumns = [
    {
      title: '去向',
      key: 'destination',
      width: 100,
      align: 'center' as const,
      render: (_: any, r: any) => (
        <Tag color={destColor[r.destination] || 'default'}>{r.destination}</Tag>
      ),
    },
    {
      title: '加微信',
      key: 'addStatus',
      width: 100,
      align: 'center' as const,
      render: (_: any, r: any) => (
        <Tag color={r.addStatus === '添加成功' ? 'green' : r.addStatus === '添加失败' ? 'red' : 'gold'}>
          {r.addStatus}
        </Tag>
      ),
    },
    {
      title: '资金流转',
      key: 'money',
      width: 240,
      render: (_: any, r: any) => {
        const feeStatus = r.companionFeeStatus === 'PAID' ? '已转' : '未转';
        return (
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>
            <div>
              客户转：
              <Text style={{ color: '#389e0d' }}>¥{(r.moneyIn || 0).toFixed(1)}</Text>
              {r.customerPaymentAccountName ? <Text type="secondary">（{r.customerPaymentAccountName}）</Text> : null}
            </div>
            <div>
              转陪玩：{companionName(r) || '-'}
              {r.companionFeeAmount ? ` ¥${Number(r.companionFeeAmount).toFixed(1)}` : ''}
              {r.companionFeeAmount ? <Text type={r.companionFeeStatus === 'PAID' ? 'success' : 'warning'} style={{ fontSize: 11 }}>（{feeStatus}）</Text> : null}
            </div>
            {r.bridgeReturn > 0 && (
              <div>
                桥接应返还：<Text style={{ color: '#d4380d' }}>¥{Number(r.bridgeReturn).toFixed(1)}</Text>
              </div>
            )}
            <div>
              转出合计：<Text style={{ color: '#d4380d' }}>¥{(r.moneyOut || 0).toFixed(1)}</Text>
            </div>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Text strong style={{ fontSize: 13 }}>💰 今日客服工作微信资金汇总</Text>
        <Row gutter={8} style={{ marginTop: 8 }}>
          {balances.length === 0 ? (
            <Col span={24}><Text type="secondary">暂无客服工作微信资金数据</Text></Col>
          ) : (
            balances.map((b: any) => (
              <Col key={b.id} xs={24} sm={12} md={8} lg={6}>
                <Card size="small" style={{ marginBottom: 8 }}>
                  <Text strong>{b.wechatId}</Text>
                  <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.8 }}>
                    <div>转入：<Text style={{ color: '#389e0d' }}>¥{(b.inTotal || 0).toFixed(1)}</Text></div>
                    <div>转出：<Text style={{ color: '#d4380d' }}>¥{(b.outTotal || 0).toFixed(1)}</Text></div>
                    <div>余额：<Text strong style={{ color: (b.balance || 0) < 0 ? '#cf1322' : '#389e0d' }}>¥{(b.balance || 0).toFixed(1)}</Text></div>
                  </div>
                </Card>
              </Col>
            ))
          )}
        </Row>
      </Card>

      <Card size="small" style={{ marginBottom: 12, borderColor: '#13c2c2' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontWeight: 600 }}>🎯 管理端直添客户流转明细</div>
          <Button size="small" onClick={load} loading={loading}>刷新</Button>
        </div>
        <OrderTable
          dataSource={items}
          loading={loading}
          extraColumns={extraColumns}
          renderActions={(r: any) =>
            r.addStatus !== '添加成功' ? (
              <Button size="small" type="primary" onClick={() => contactCompanion(r)}>
                询问陪玩
              </Button>
            ) : null
          }
        />
      </Card>
    </div>
  );
};

export default CsConvertedPanel;
