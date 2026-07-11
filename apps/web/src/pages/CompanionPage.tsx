import React, { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Button, Typography, Tag, Spin, Space, Modal, Input, Table, message, Tooltip, Empty } from 'antd';
import { ThunderboltOutlined, PlayCircleOutlined, SearchOutlined, CoffeeOutlined, LockOutlined, ReloadOutlined } from '@ant-design/icons';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { companionsApi } from '../api/companions';
import { customersApi } from '../api/customers';
import { useAuthStore } from '../stores/authStore';
import http from '../api/client';
import { companionStatusConfig } from '../constants';

const { Text, Title } = Typography;

const IconThunder = React.createElement(ThunderboltOutlined);
const IconPlay = React.createElement(PlayCircleOutlined);
const IconSearch = React.createElement(SearchOutlined);
const IconCoffee = React.createElement(CoffeeOutlined);
const IconLock = React.createElement(LockOutlined);

const CompanionPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const [ranking, setRanking] = useState<any[]>([]);
  const [rankingLoading, setRankingLoading] = useState(true);

  const fetchRanking = useCallback(async () => {
    try { const { data: res } = await http.get('/companions/ranking?type=revenue'); setRanking((res.data||[]).slice(0,5)); }
    catch {} finally { setRankingLoading(false); }
  }, []);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [wallet, setWallet] = useState<any>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [withdrawVisible, setWithdrawVisible] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState<number>(0);
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await companionsApi.workbench();
      setData(res.data);
    } catch (e) {
      console.error('Workbench fetch error', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWallet = useCallback(async () => {
    setWalletLoading(true);
    try {
      const { data: res } = await companionsApi.wallet();
      setWallet(res.data);
    } catch (e) {
      console.error('Wallet fetch error', e);
    } finally {
      setWalletLoading(false);
    }
  }, []);

  const fetchMyCustomers = useCallback(async () => {
    if (!user?.companionId) return;
    setCustomersLoading(true);
    try {
      const { data: res } = await customersApi.list();
      setMyCustomers(res.data || []);
    } catch (e) {
      console.error('Customers fetch error', e);
    } finally {
      setCustomersLoading(false);
    }
  }, [user?.companionId]);

  useEffect(() => { fetchData(); fetchWallet(); fetchMyCustomers(); fetchRanking(); const t = setInterval(() => { fetchData(); fetchWallet(); }, 30_000); return () => clearInterval(t); }, [fetchData, fetchWallet, fetchMyCustomers]);

  // Auto-refresh when tab becomes visible (catches data changes from admin panel / Electron)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') { fetchData(); fetchWallet(); fetchMyCustomers(); fetchRanking(); } };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [fetchData, fetchWallet, fetchMyCustomers]);

  // Auto-set AVAILABLE on first load if currently OFFLINE
  useEffect(() => {
    if (data?.currentStatus === 'OFFLINE' && user?.companionId) {
      switchStatus('AVAILABLE');
    }
  }, [data?.currentStatus]);

  const handleWithdraw = async () => {
    if (withdrawAmount <= 0) { message.warning('请输入有效金额'); return; }
    setWithdrawSubmitting(true);
    try {
      await companionsApi.requestWithdraw(withdrawAmount);
      message.success('支取申请已提交');
      setWithdrawVisible(false);
      setWithdrawAmount(0);
      fetchWallet();
      fetchData();
    } catch (err: any) {
      message.error(err?.response?.data?.message || err?.message || '申请失败');
    } finally { setWithdrawSubmitting(false); }
  };

  const [blockedModal, setBlockedModal] = useState<any>(null);
  // Boot guide modal (TASK-06)
  const [bootGuideVisible, setBootGuideVisible] = useState(false);
  // No-customer proof modal (TASK-08)
  const [proofVisible, setProofVisible] = useState(false);
  const [proofNote, setProofNote] = useState('');
  const [proofSubmitting, setProofSubmitting] = useState(false);
  // Customer follow-up tracking
  const [myCustomers, setMyCustomers] = useState<any[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const entertainmentThreshold = data?.entertainmentThreshold ?? 200;
  const belowEntertainment = data ? (data.todayRevenue < entertainmentThreshold) : true;

  // Listen for boot guide from Electron (TASK-06)
  useEffect(() => {
    const handler = () => {
      if (!sessionStorage.getItem('bootGuideShown')) {
        setBootGuideVisible(true);
        sessionStorage.setItem('bootGuideShown', '1');
      }
    };
    if ((window as any).electronAPI?.onBootGuide) {
      (window as any).electronAPI.onBootGuide(handler);
    }
    // Also listen for the raw IPC message
    const ipcHandler = (e: MessageEvent) => {
      if (e.data === 'nav:bootGuide') handler();
    };
    window.addEventListener('message', ipcHandler);
    return () => window.removeEventListener('message', ipcHandler);
  }, []);

  const handleProofSubmit = async () => {
    if (!proofNote.trim()) { message.warning('请填写申请说明'); return; }
    setProofSubmitting(true);
    try {
      await companionsApi.requestProofNoCustomer(proofNote);
      message.success('解锁申请已提交，请等待管理员审核');
      setProofVisible(false);
      setProofNote('');
    } catch (err: any) {
      message.error(err?.response?.data?.message || '提交失败');
    } finally { setProofSubmitting(false); }
  };

  const switchStatus = async (status: string) => {
    try {
      const { data: res } = await companionsApi.updateStatus(user?.companionId ?? '', status);
      if (res.data?.blocked) { setBlockedModal(res.data); return; }
      fetchData();
    } catch { /* ignore */ }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!data) return <Text type="secondary">加载失败</Text>;


  return (
    <div>
      {/* ① Status Header — compact inline */}
      <Card size="small" style={{ marginBottom: 16, border: '2px solid #00D4FF' }}>
        <Row align="middle" gutter={16}>
          <Col flex="auto">
            <Space size="middle">
              <Text strong style={{ fontSize: 18 }}>👤 {user?.username || '陪玩'} <Tag color="cyan" style={{ fontSize: 10 }}>NEW v2.0</Tag></Text>
              <Tag color={companionStatusConfig[data.currentStatus]?.color || 'default'} style={{ fontSize: 16, padding: '4px 16px', borderRadius: 10 }}>
                {companionStatusConfig[data.currentStatus]?.label || data.currentStatus}
              </Tag>
              <Text type="secondary">今日¥{data.todayRevenue} · 娱乐{data.entertainmentMinutes}min · {data.statusDurations?.entertainment || '00:00'}</Text>
            </Space>
          </Col>
          <Col>
            <Space>
              <Tooltip title={belowEntertainment ? `今日流水 ¥${data.todayRevenue}，达标 ¥${entertainmentThreshold} 后可切换` : undefined}>
                <Button icon={IconPlay} onClick={() => switchStatus('ENTERTAINMENT')} disabled={belowEntertainment}>娱乐</Button>
              </Tooltip>
              <Button type="primary" icon={IconSearch} onClick={() => switchStatus('AVAILABLE')}>空闲</Button>
              <Button icon={IconThunder} onClick={() => switchStatus('BUSY')}>接单</Button>
              <Button icon={IconCoffee} onClick={() => switchStatus('RESTING')}>休息</Button>
              <Button size="small" onClick={() => { fetchData(); fetchWallet(); fetchMyCustomers(); }} icon={React.createElement(ReloadOutlined)} />
            </Space>
          </Col>
        </Row>
      </Card>

      {/* ② Performance — left chart + right ranking */}
      <Title level={5} style={{ marginBottom: 12 }}>📊 业绩看板</Title>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col span={13}>
          <Card size="small" title="订单占比">
            <Row gutter={8}>
              {[{title:'📅 今日',stats:data?.todayStats,revenue:data?.todayRevenue},{title:'📆 全月',stats:data?.orderStats,revenue:data?.totalRevenue}].map(({title,stats,revenue}) => {
                const pieData = [{key:'NEW',name:'首单',color:'#1677ff'},{key:'RENEW',name:'续单',color:'#52c41a'},{key:'REPURCHASE',name:'复购',color:'#722ed1'},{key:'TIP',name:'礼物',color:'#fa8c16'}].map(t => ({name:t.name,value:stats?.[t.key]?.count||0,amount:stats?.[t.key]?.amount||0,color:t.color})).filter(d=>d.value>0);
                return (
                  <Col span={12} key={title} style={{textAlign:'center'}}>
                    <Text strong style={{fontSize:12}}>{title} ¥{(revenue||0).toFixed(0)}</Text>
                    {pieData.length > 0 ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart><Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={50} innerRadius={25} label={({name,value,percent,payload})=>`${name} ${value}单 ¥${payload.amount||0} ${(percent*100).toFixed(0)}%`} labelStyle={{fontSize:9}}>{pieData.map((d,i)=><Cell key={i} fill={d.color}/>)}</Pie></PieChart>
                      </ResponsiveContainer>
                    ) : <Empty description="暂无" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{margin:'20px 0'}}/>}
                  </Col>
                );
              })}
            </Row>
            <div style={{textAlign:'center',marginTop:8,fontSize:11}}>
              {(() => {
                const rn = data?.orderStats?.RENEW?.ratio || 0;
                const rp = data?.orderStats?.REPURCHASE?.ratio || 0;
                const tp = data?.orderStats?.TIP?.ratio || 0;
                const items = [
                  {label:'续单率',val:rn,target:30},
                  {label:'复购率',val:rp,target:30},
                  {label:'礼物占比',val:tp,target:15},
                ];
                return <Text type="secondary">🤖 AI建议：{items.map(({label,val,target},i)=><span key={label}>{i>0?' · ':''}{label}<Text strong style={{color:val>=target?'#52c41a':'#ff4d4f'}}>{val}%</Text>{val<target?<span style={{color:'#ff4d4f'}}>（低于{target}%）</span>:''}</span>)}</Text>;
              })()}
            </div>
          </Card>
        </Col>
        <Col span={11}>
          <Card size="small" title={<span>🏆 实力排行<Text type="secondary" style={{fontSize:10,marginLeft:8}}>续单×2+复购×3+礼物×2−首单×0.5</Text></span>} loading={rankingLoading} style={{height:'100%'}}>
            {ranking.length > 0 ? (
              <table style={{width:'100%',fontSize:11,borderCollapse:'collapse'}}>
                <thead><tr style={{color:'#999',borderBottom:'1px solid #f0f0f0'}}>
                  <th style={{textAlign:'left',padding:2}}>陪玩</th><th style={{padding:2}}>流水</th><th style={{padding:2}}>首单</th><th style={{padding:2}}>续单</th><th style={{padding:2}}>复购</th><th style={{padding:2}}>礼物</th><th style={{textAlign:'right',padding:2}}>评分</th>
                </tr></thead>
                <tbody>{[...ranking].sort((a:any,b:any)=>b.qualityScore-a.qualityScore).map((r:any,i:number)=>(<tr key={r.companionId} style={{background:r.companionId===user?.companionId?'#e6f7ff':'transparent'}}>
                  <td style={{padding:3}}>{['🥇','🥈','🥉'][i]||`${i+1}`} {r.name?.slice(0,6)}</td>
                  <td style={{color:'#1677ff',fontWeight:500,textAlign:'center'}}>¥{(r.totalAmount||0).toFixed(0)}</td>
                  <td style={{textAlign:'center'}}><Tag color={r.newRate>50?'red':r.newRate>30?'orange':'default'} style={{fontSize:10,margin:0}}>{r.newRate||0}%</Tag></td>
                  <td style={{textAlign:'center'}}><Tag color={r.renewRate>20?'green':'default'} style={{fontSize:10,margin:0}}>{r.renewRate||0}%</Tag></td>
                  <td style={{textAlign:'center'}}><Tag color={r.repurchaseRate>15?'green':'default'} style={{fontSize:10,margin:0}}>{r.repurchaseRate||0}%</Tag></td>
                  <td style={{textAlign:'center'}}><Tag color={r.tipRatio>10?'gold':'default'} style={{fontSize:10,margin:0}}>{r.tipRatio||0}%</Tag></td>
                  <td style={{textAlign:'right',fontWeight:600,color:r.qualityScore>50?'#52c41a':'#999'}}>{r.qualityScore||0}</td>
                </tr>))}</tbody>
              </table>
            ) : <Empty description="暂无排行" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>
      </Row>

      {/* ③ Pending Customers — prominent */}
      <Spin spinning={customersLoading}>
        <Title level={5} style={{ marginBottom: 8 }}>
          📋 待跟进客户
          {(() => {
            const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            const pending = myCustomers.filter((c: any) => {
              const spent = (c.totalSpent ?? 0) > 0;
              if (!spent) return true;
              const f = c.followUps?.[0];
              if (!f) return true;
              return new Date(f.createdAt) < sevenDaysAgo;
            });
            return <Tag color={pending.length > 0 ? 'red' : 'default'} style={{ marginLeft: 8 }}>{pending.length}人</Tag>;
          })()}
          <Button type="link" size="small" style={{ float: 'right' }} onClick={() => window.location.href = '/companion/customers'}>查看全部 →</Button>
        </Title>
        {(() => {
          const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          const pendingCustomers = myCustomers.filter((c: any) => {
            const spent = (c.totalSpent ?? 0) > 0;
            if (!spent) return true;
            const f = c.followUps?.[0];
            if (!f) return true;
            return new Date(f.createdAt) < sevenDaysAgo;
          });
          if (pendingCustomers.length === 0) return <Card size="small"><Empty description="暂无待跟进客户" image={Empty.PRESENTED_IMAGE_SIMPLE} /></Card>;
          return (
            <Table dataSource={pendingCustomers.slice(0, 5)} rowKey="id" size="small" pagination={false} style={{ marginBottom: 16 }}>
              <Table.Column title="编号" dataIndex="customerCode" width={100} render={(v: string) => <Text code>{v}</Text>} />
              <Table.Column title="微信" dataIndex="wechatId" width={100} render={(v: string) => v || '-'} />
              <Table.Column title="来源" dataIndex="platform" width={70} render={(v: string) => v ? <Tag>{v}</Tag> : '-'} />
              <Table.Column title="跟进" width={90} render={(_: any, c: any) => {
                const f = c.followUps?.[0];
                return f ? <Text style={{ fontSize: 11 }}>{new Date(f.createdAt).toLocaleDateString('zh-CN')}</Text> : <Tag color="red">未跟进</Tag>;
              }} />
              <Table.Column title="操作" width={60} render={(_: any, c: any) => (
                <Button type="link" size="small" onClick={() => window.location.href = `/companion/customers/${c.id}`}>跟进</Button>
              )} />
            </Table>
          );
        })()}
      </Spin>

      {/* ④ Banner: Billing + Ranking */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Text strong>💰 报账</Text><br />
            <Text>总流水 ¥{(wallet?.totalRevenue ?? 0).toFixed(0)} · 可支取 ¥{(wallet?.withdrawable ?? 0).toFixed(0)} · 押金 ¥{(wallet?.deposit ?? 0).toFixed(0)}</Text><br />
            <Button type="primary" size="small" style={{ marginTop: 8 }} onClick={() => window.location.href = '/companion/billing'}>进入报账系统 →</Button>
          </Col>
          <Col span={12}>
            <Text strong>🏆 本月排行</Text><br />
            <Button type="link" size="small" onClick={() => window.location.href = '/companion/companions'}>查看完整排行 →</Button>
          </Col>
        </Row>
      </Card>

      {/* Keep existing modals */}
      <Modal title="⚠️ 无法切换娱乐模式" open={!!blockedModal} onCancel={() => setBlockedModal(null)} footer={null}>
        <div style={{ lineHeight: 2.2 }}>
          <p>您当前没有未支取的余额，无法开启娱乐模式：</p>
          <div style={{ background: '#fff7e6', borderRadius: 8, padding: 12, marginTop: 8 }}>
            <div>📊 总流水：<Text strong>¥{blockedModal?.totalRevenue?.toFixed(2) ?? '0.00'}</Text></div>
            <div>🔢 可分账金额（{(blockedModal?.totalRevenue > 0 ? Math.round((blockedModal?.withdrawable / blockedModal.totalRevenue) * 100) : 50)}%）：<Text strong>¥{blockedModal?.withdrawable?.toFixed(2) ?? '0.00'}</Text></div>
            <div>💸 已支取：<Text strong>¥{blockedModal?.totalWithdrawn?.toFixed(2) ?? '0.00'}</Text></div>
            <div>🏦 剩余未支取：<Text strong style={{ color: '#ff4d4f' }}>¥{blockedModal?.remaining?.toFixed(2) ?? '0.00'}</Text></div>
            <div style={{ marginTop: 4 }}>💰 账户余额：¥{blockedModal?.totalBalance?.toFixed(2) ?? '0.00'}</div>
          </div>
          <p style={{ marginTop: 12 }}>请支取部分流水后，有剩余未支取余额即可开启娱乐模式。</p>
          <div style={{ marginTop: 16, textAlign: 'center' }}><Button type="primary" onClick={() => setBlockedModal(null)}>知道了</Button></div>
        </div>
      </Modal>

      {/* TASK-06: Boot Guide Modal */}
      <Modal title="📋 开工提醒" open={bootGuideVisible} onCancel={() => setBootGuideVisible(false)} footer={null}>
        <div style={{ lineHeight: 2.2 }}>
          <p>请优先联系你的私域客户，提高成单率！</p>
          <div style={{ background: '#f6ffed', borderRadius: 8, padding: 12, marginTop: 8 }}>
            <p>💡 <Text strong>建议流程：</Text></p>
            <p>① 打开客户管理 → 查看待跟进客户</p>
            <p>② 主动联系客户 → 了解游戏需求</p>
            <p>③ 促成下单 → 获取流水解锁订单池</p>
          </div>
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
            <Button type="primary" onClick={() => { setBootGuideVisible(false); window.location.href = '/companion/customers'; }}>去客户管理</Button>
            <Button onClick={() => setBootGuideVisible(false)}>稍后提醒</Button>
          </div>
        </div>
      </Modal>

      {/* TASK-08: No-Customer Proof Upload Modal */}
      <Modal title="📝 申请解锁订单池" open={proofVisible} onCancel={() => { setProofVisible(false); setProofNote(''); }} onOk={handleProofSubmit} confirmLoading={proofSubmitting} okText="提交申请" cancelText="取消">
        <div style={{ lineHeight: 2 }}>
          <p><Text type="secondary">如果您确实没有客户资源，可以申请临时解锁订单池权限。请说明情况并上传沟通证明截图（如有）。</Text></p>
          <div style={{ marginTop: 8 }}>
            <Text>申请说明：</Text>
            <Input.TextArea rows={4} value={proofNote} onChange={(e) => setProofNote(e.target.value)} placeholder="请说明您的情况，例如：已尝试联系XX位客户但均未回复..." style={{ marginTop: 4 }} />
          </div>
        </div>
      </Modal>

      {/* TASK-08: Apply unlock button - shown when below threshold */}
      {belowEntertainment && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button type="link" icon={IconLock} onClick={() => setProofVisible(true)}>
            没有客户？申请解锁订单池
          </Button>
        </div>
      )}
    </div>
  );
};

export default CompanionPage;
