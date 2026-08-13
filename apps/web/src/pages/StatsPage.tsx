// craftsman-ignore: TS001,TS002,TS003
import React, { useState, useEffect } from 'react';
import { Card, Typography, Button, Row, Col, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { statsApi } from '../api/stats';

const { Title, Text } = Typography;

const StatsPage: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showOrders, setShowOrders] = useState(false);
  const [mode, setMode] = useState('today');

  const today = dayjs().format('YYYY-MM-DD');
  const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
  const weekAgo = dayjs().subtract(6, 'day').format('YYYY-MM-DD');

  const doLoad = (from: string, to: string) => {
    setLoading(true);
    statsApi.getDaily({ dateFrom: from, dateTo: to })
      .then(res => { setData((res.data as any)?.data || null); setLoading(false); })
      .catch(() => { setData(null); setLoading(false); });
  };

  useEffect(() => { doLoad(today, today); }, []);

  const handleRefresh = () => {
    if (mode === 'yesterday') doLoad(yesterday, yesterday);
    else if (mode === 'week') doLoad(weekAgo, today);
    else doLoad(today, today);
  };

  if (loading || !data) return <Card><Text>加载中...</Text></Card>;
  const s = data.summary;
  const csList = data.csList || [];
  const orders = data.orders || [];

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div>
          <Title level={4} style={{margin:0}}>每日统计</Title>
          <Text type="secondary">{data.dateFrom} ~ {data.dateTo}</Text>
        </div>
        <Space>
          <Button size="small" type={mode==='today'?'primary':'default'} onClick={() => { setMode('today'); doLoad(today, today); }}>今天</Button>
          <Button size="small" type={mode==='yesterday'?'primary':'default'} onClick={() => { setMode('yesterday'); doLoad(yesterday, yesterday); }}>昨天</Button>
          <Button size="small" type={mode==='week'?'primary':'default'} onClick={() => { setMode('week'); doLoad(weekAgo, today); }}>近7天</Button>
          <Button icon={<ReloadOutlined />} onClick={handleRefresh}>刷新</Button>
        </Space>
      </div>

      <Row gutter={[12,12]} style={{marginBottom:16}}>
        {(() => { const m=new Map(); for(const cs of csList) for(const b of(cs.studioBreakdown||[])) { const p=m.get(b.studioName)||{c:0,a:0,t:b.studioType};p.c+=b.count;p.a+=b.amount;m.set(b.studioName,p); } return Array.from(m.entries()).map(([name,info]:any)=>(<Col xs={12} sm={6} key={name}><Card size="small"><Text type="secondary">{name}</Text><div><Text strong style={{fontSize:18,color:info.t==='RENTAL'?'#722ed1':'#52c41a'}}>{info.c}单 ¥{info.a.toFixed(0)}</Text></div></Card></Col>)); })()}
        <Col xs={12} sm={6}><Card size="small"><Text type="secondary">发单总数</Text><div><Text strong style={{fontSize:24}}>{s.totalOrders} 单</Text></div></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Text type="secondary">客服认领</Text><div><Text strong style={{fontSize:24,color:'#722ed1'}}>{s.claimedCount || 0} 单</Text></div></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Text type="secondary">总金额</Text><div><Text strong style={{fontSize:24,color:'#cf1322'}}>¥{s.totalAmount.toFixed(0)}</Text></div></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Text type="secondary">未接单</Text><div><Text strong style={{fontSize:24,color:s.unassignedCount>0?'#faad14':'#8c8c8c'}}>{s.unassignedCount} 单</Text></div></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Text type="secondary">已付 / 未付</Text><div><Text strong style={{fontSize:22}}>{s.feePaidCount} / {s.feeUnpaidCount}</Text></div></Card></Col>
        <Col xs={12} sm={6}><Card size="small"><Text type="secondary">微信 / 支付宝</Text><div><Text strong style={{fontSize:18}}>{s.wechatCount}笔 / {s.alipayCount}笔</Text></div></Card></Col>
      </Row>

      <Card title={`客服汇总（${csList.length}人）`} size="small" style={{marginBottom:16}}>
        <div style={{border:'1px solid #f0f0f0',borderRadius:6,overflow:'hidden'}}>
          {csList.map((cs: any, i: number) => (
            <div key={cs.csUserId} style={{padding:'8px 12px',borderBottom:i<csList.length-1?'1px solid #f0f0f0':'none',background:i%2===0?'#fafafa':'#fff'}}>
              <Row gutter={[12,4]} align="middle">
                <Col xs={24} sm={3}>
                  <Text strong>{cs.csDisplayName || cs.csName}</Text>
                  {cs.unassignedCount > 0 && <Text style={{color:'#faad14',fontSize:12,marginLeft:4,fontWeight:'bold'}}>⚠未接{cs.unassignedCount}</Text>}
                </Col>
                <Col xs={12} sm={2}><Text>发单 {cs.totalOrders}</Text></Col>
                <Col xs={12} sm={2}><Text style={{color:'#722ed1'}}>认领 {cs.claimedCount || 0}</Text></Col>
                <Col xs={12} sm={2}><Text style={{color:'#cf1322'}}>¥{cs.totalAmount.toFixed(0)}</Text></Col>
                <Col xs={24} sm={4}>
                  {(cs.studioBreakdown||[]).map((b:any) => (
                    <Text key={b.studioName} style={{display:'inline-block',background:b.isOwn?'#f6ffed':b.studioType==='RENTAL'?'#f9f0ff':'#e6f4ff',padding:'0 6px',borderRadius:3,marginRight:4,fontSize:12,border:'1px solid '+(b.isOwn?'#b7eb8f':b.studioType==='RENTAL'?'#d3adf7':'#91caff')}}>{b.studioName} {b.count}单 ¥{b.amount.toFixed(0)}</Text>
                  ))}
                </Col>
                <Col xs={8} sm={2}><Text style={{color:'#52c41a'}}>已付{cs.feePaidCount}</Text><Text style={{color:'#faad14',marginLeft:4}}>未付{cs.feeUnpaidCount}</Text></Col>
                <Col xs={8} sm={2}><Text style={{color:'#07c160',fontSize:12}}>微信{cs.wechatCount}笔 ¥{cs.wechatAmount.toFixed(0)}</Text></Col>
                <Col xs={8} sm={2}><Text style={{color:'#1677ff',fontSize:12}}>支付宝{cs.alipayCount}笔 ¥{cs.alipayAmount.toFixed(0)}</Text></Col>
              </Row>
            </div>
          ))}
        </div>
      </Card>

      {orders.length > 0 && (
        <>
          <Button type="link" onClick={() => setShowOrders(!showOrders)} style={{padding:0,marginBottom:8}}>{showOrders?'收起':'展开'}订单明细（{orders.length}单）</Button>
          {showOrders && (
            <Card size="small">
              <div style={{border:'1px solid #f0f0f0',borderRadius:6,overflow:'hidden'}}>
                {orders.map((o:any, i:number) => (
                  <div key={o.id} style={{padding:'4px 12px',borderBottom:i<orders.length-1?'1px solid #f0f0f0':'none',background:i%2===0?'#fafafa':'#fff'}}>
                    <Text type="secondary" style={{width:80,display:'inline-block'}}>{dayjs(o.createdAt).format('MM/DD HH:mm')}</Text>
                    <Text style={{width:80,display:'inline-block'}}>{o.gameName}</Text>
                    <Text strong style={{width:60,display:'inline-block'}}>¥{o.amount}</Text>
                    <Text style={{width:60,display:'inline-block'}}>{o.csName}</Text>
                    <Text style={{width:60,display:'inline-block'}}>{o.companionName||'—'}</Text>
                    {o.companionStudio && <Text style={{display:'inline-block',background:o.companionStudioType==='RENTAL'?'#f9f0ff':'#f6ffed',padding:'0 6px',borderRadius:3,fontSize:12,marginRight:4}}>{o.companionStudio}</Text>}
                    <Text style={{display:'inline-block',background:o.companionFeeStatus==='PAID'?'#f6ffed':'#fff7e6',padding:'0 6px',borderRadius:3,fontSize:12}}>{o.companionFeeStatus==='PAID'?'已付':'未付'}</Text>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default StatsPage;
