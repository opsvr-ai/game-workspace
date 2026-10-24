// craftsman-ignore: TS001,TS002
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Col, Empty, Input, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import * as echarts from 'echarts';
import { trafficAccountApi, TrafficAccountItem } from '../../api/trafficAccount';
import { TRAFFIC_ACCOUNT_ROLES } from '../../constants/trafficStyles';
import PageHeader from '../../components/PageHeader';
import { BRAND, TEXT } from '../../styles/tokens';

const { Text } = Typography;

/** 常见热门城市坐标（用于地图打点；没有坐标的城市会在下方单独列出）。 */
const CITY_COORD: Record<string, [number, number]> = {
  北京: [116.4, 39.9], 上海: [121.47, 31.23], 广州: [113.26, 23.13], 深圳: [114.06, 22.55],
  杭州: [120.15, 30.28], 成都: [104.07, 30.67], 武汉: [114.3, 30.59], 南京: [118.78, 32.04],
  苏州: [120.58, 31.3], 重庆: [106.55, 29.56], 西安: [108.94, 34.34], 长沙: [112.94, 28.23],
  郑州: [113.62, 34.75], 青岛: [120.38, 36.07], 厦门: [118.09, 24.48], 福州: [119.3, 26.08],
  济南: [117.0, 36.65], 合肥: [117.28, 31.86], 昆明: [102.71, 25.04], 南宁: [108.37, 22.82],
  南昌: [115.89, 28.68], 天津: [117.2, 39.08], 沈阳: [123.43, 41.8], 大连: [121.62, 38.91],
  哈尔滨: [126.63, 45.75], 长春: [125.32, 43.82], 石家庄: [114.51, 38.04], 太原: [112.55, 37.87],
  贵阳: [106.71, 26.57], 海口: [110.35, 20.02], 兰州: [103.82, 36.06], 乌鲁木齐: [87.62, 43.82],
  呼和浩特: [111.75, 40.84], 银川: [106.23, 38.49], 西宁: [101.78, 36.62], 拉萨: [91.11, 29.65],
  三亚: [109.51, 18.25], 东莞: [113.75, 23.02], 佛山: [113.12, 23.02], 宁波: [121.55, 29.87],
  无锡: [120.3, 31.57], 常州: [119.97, 31.81], 温州: [120.7, 28.0], 嘉兴: [120.75, 30.75],
  金华: [119.65, 29.08], 泉州: [118.68, 24.87], 烟台: [121.39, 37.54], 潍坊: [119.16, 36.71],
  临沂: [118.35, 35.05], 洛阳: [112.45, 34.62], 襄阳: [112.14, 32.04], 宜昌: [111.29, 30.69],
  株洲: [113.13, 27.83], 惠州: [114.42, 23.11], 中山: [113.39, 22.52], 珠海: [113.58, 22.27],
  汕头: [116.68, 23.35], 桂林: [110.29, 25.27], 柳州: [109.42, 24.33], 遵义: [106.93, 27.73],
  绵阳: [104.68, 31.47], 德阳: [104.4, 31.13], 宜宾: [104.63, 28.77], 赣州: [114.94, 25.85],
  九江: [116.0, 29.7], 芜湖: [118.38, 31.33], 唐山: [118.18, 39.63], 保定: [115.46, 38.87],
  廊坊: [116.68, 39.52], 邯郸: [114.49, 36.61], 徐州: [117.18, 34.26], 扬州: [119.41, 32.39],
};

const HOT_CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '苏州', '重庆', '西安', '长沙'];

/** 风格卡片：有 emoji 当小图，没配过的风格用首字 + 稳定颜色。 */
const STYLE_META: Record<string, { emoji: string; color: string }> = {
  甜妹: { emoji: '🌸', color: '#ff85c0' },
  御姐: { emoji: '💃', color: '#9254de' },
  少御: { emoji: '🌷', color: '#eb2f96' },
  少萝: { emoji: '🎀', color: '#ff9c6e' },
  邻家: { emoji: '🌿', color: '#52c41a' },
  高冷: { emoji: '❄️', color: '#69b1ff' },
  搞笑女: { emoji: '😄', color: '#faad14' },
  技术大神: { emoji: '🎮', color: '#13c2c2' },
  CSO: { emoji: '🎯', color: '#2f54eb' },
  教学: { emoji: '📚', color: '#1677ff' },
  硬核: { emoji: '🔥', color: '#fa541c' },
  上分陪练: { emoji: '🏆', color: '#fa8c16' },
  避坑: { emoji: '🛡️', color: '#faad14' },
  干货: { emoji: '📌', color: '#52c41a' },
  测评: { emoji: '🔍', color: '#13c2c2' },
  攻略: { emoji: '🗺️', color: '#2f54eb' },
  科普: { emoji: '💡', color: '#faad14' },
};

function styleOf(item: TrafficAccountItem): string {
  return (item.accountStyle || item.accountRole || '未填写').trim() || '未填写';
}

function styleMeta(style: string): { emoji: string; color: string } {
  return STYLE_META[style] || { emoji: style.slice(0, 1) || '🙂', color: '#8c8c8c' };
}

function cityOf(item: TrafficAccountItem): string {
  const extra = item.extra || {};
  const raw = String(extra.ipCity || extra.city || item.wifiRegion || extra.ipAddress || '').trim();
  if (!raw) return '未标注';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return 'IP未解析';
  const found = Object.keys(CITY_COORD).find((c) => raw.includes(c));
  return found || raw.replace(/省|市|自治区|特别行政区/g, '').slice(0, 6) || '未标注';
}

function riskNotesOf(item: TrafficAccountItem): any[] {
  const notes = item.extra?.riskNotes;
  return Array.isArray(notes) ? notes : [];
}

const TrafficAccountOverviewPage: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<TrafficAccountItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<string | undefined>();
  const [style, setStyle] = useState<string | undefined>();
  const [risk, setRisk] = useState<string | undefined>();
  const [riskReason, setRiskReason] = useState<string | undefined>();
  const [platform, setPlatform] = useState<string | undefined>();
  const [city, setCity] = useState<string | undefined>();
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await trafficAccountApi.list();
      setItems(data.data || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      if (!chartRef.current) return;
      chartInstance.current = echarts.init(chartRef.current);
      try {
        const res = await fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const geo = await res.json();
        if (cancelled) return;
        echarts.registerMap('china', geo);
        setMapReady(true);
      } catch {
        if (!cancelled) setMapError('地图边界加载失败，下面按城市列表展示');
      }
    };
    void init();
    const onResize = () => chartInstance.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      chartInstance.current?.dispose();
      chartInstance.current = null;
    };
  }, []);

  const filtered = useMemo(() => items.filter((it) => {
    if (role && it.accountRole !== role) return false;
    if (style && styleOf(it) !== style) return false;
    if (platform && it.type !== platform) return false;
    if (city && cityOf(it) !== city) return false;
    if (risk === '风险' && it.riskPopped !== '是' && !riskNotesOf(it).length) return false;
    if (risk === '封禁' && it.banned !== '是') return false;
    if (risk === '有风险记录' && !riskNotesOf(it).length) return false;
    if (riskReason) {
      const all = [it.riskNote, it.banNote, ...riskNotesOf(it).map((n) => n.note)].filter(Boolean).join(' ');
      if (!all.includes(riskReason)) return false;
    }
    if (search) {
      const text = `${it.nickname} ${it.code || ''} ${it.accountId || ''} ${it.wifiRegion || ''} ${it.riskNote || ''} ${riskNotesOf(it).map((n) => n.note).join(' ')}`.toLowerCase();
      if (!text.includes(search.toLowerCase())) return false;
    }
    return true;
  }), [items, role, style, risk, riskReason, platform, city, search]);

  const cityStats = useMemo(() => {
    const map = new Map<string, TrafficAccountItem[]>();
    for (const it of filtered) {
      const c = cityOf(it);
      map.set(c, [...(map.get(c) || []), it]);
    }
    return map;
  }, [filtered]);

  /**
   * 先按 3 个大类分组，再在大类下统计细分风格：
   * 这样「情绪娱乐号 → 甜妹 5 / 御姐 3 / 少御 2」一眼能对上层级。
   */
  const styleGroups = useMemo(() => {
    const types = [...TRAFFIC_ACCOUNT_ROLES, '未分类'];
    return types.map((type) => {
      const list = filtered.filter((it) => (it.accountRole || '未分类') === type);
      const styles = new Map<string, TrafficAccountItem[]>();
      for (const it of list) {
        const s = styleOf(it);
        styles.set(s, [...(styles.get(s) || []), it]);
      }
      return {
        type,
        total: list.length,
        styles: [...styles.entries()].sort((a, b) => b[1].length - a[1].length),
      };
    }).filter((g) => g.total > 0);
  }, [filtered]);

  const banStats = useMemo(() => {
    const map = new Map<string, TrafficAccountItem[]>();
    for (const it of filtered) {
      if (it.banned !== '是' && !it.banNote) continue;
      const reason = String(it.banNote || '未填写原因').split(/[；;。]/)[0].slice(0, 24);
      map.set(reason, [...(map.get(reason) || []), it]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const unusedHot = HOT_CITIES.filter((c) => !cityStats.has(c));

  useEffect(() => {
    if (!mapReady || !chartInstance.current) return;
    const points = [...cityStats.entries()]
      .filter(([c]) => CITY_COORD[c])
      .map(([c, list]) => ({
        name: c,
        value: [...CITY_COORD[c], list.length],
        accounts: list.map((it) => it.nickname || it.code || it.accountId || '未命名'),
      }));
    chartInstance.current.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => {
          const accounts = p?.data?.accounts || [];
          return `<b>${p?.name}</b><br/>${accounts.length} 个账号<br/>${accounts.slice(0, 8).join('<br/>')}${accounts.length > 8 ? '<br/>…' : ''}`;
        },
      },
      geo: {
        map: 'china',
        roam: true,
        zoom: 1.1,
        itemStyle: { areaColor: '#eef4ff', borderColor: '#b9cdf2' },
        emphasis: { itemStyle: { areaColor: '#dbe8ff' }, label: { show: false } },
      },
      series: [{
        name: '账号IP',
        type: 'effectScatter',
        coordinateSystem: 'geo',
        data: points,
        symbolSize: (v: any) => Math.min(42, 14 + Number(v[2] || 0) * 6),
        showEffectOn: 'render',
        rippleEffect: { brushType: 'stroke', scale: 2.6 },
        label: {
          show: true,
          position: 'right',
          formatter: (p: any) => `${p.name} ${p.value?.[2] || 0}`,
          color: '#24436f',
          fontSize: 11,
          fontWeight: 600,
        },
        itemStyle: { color: BRAND.primary, shadowBlur: 8, shadowColor: 'rgba(22,119,255,.35)' },
      }],
    }, true);
  }, [mapReady, cityStats]);

  const roleOptions = [...new Set(items.map((i) => i.accountRole).filter(Boolean))] as string[];
  const styleOptions = [...new Set(items.map((i) => styleOf(i)).filter(Boolean))] as string[];
  const platformOptions = [...new Set(items.map((i) => i.type).filter(Boolean))] as string[];
  const riskReasonOptions = [...new Set(items.flatMap((i) => [
    i.riskNote,
    i.banNote,
    ...riskNotesOf(i).map((n) => n.note),
  ]).filter(Boolean).map((v) => String(v)))].slice(0, 60);

  return (
    <div>
      <PageHeader
        title="账号总览"
        subtitle="按 IP/地区看账号分布、看人设结构、看风险与封号原因"
        extra={<Space><Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button><Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/traffic-accounts')}>返回账号管理</Button></Space>}
      />
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Input allowClear prefix={<SearchOutlined />} placeholder="搜昵称 / 编号 / 城市 / 风险" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 260 }} />
          <Select allowClear placeholder="人设" value={role} onChange={setRole} options={roleOptions.map((v) => ({ value: v, label: v }))} style={{ width: 160 }} />
          <Select allowClear placeholder="账号风格" value={style} onChange={setStyle} options={styleOptions.map((v) => ({ value: v, label: v }))} style={{ width: 150 }} />
          <Select allowClear placeholder="风险/封禁" value={risk} onChange={setRisk} options={[{ value: '风险', label: '有风险' }, { value: '封禁', label: '已封禁' }, { value: '有风险记录', label: '有风险记录' }]} style={{ width: 150 }} />
          <Select allowClear showSearch placeholder="风险原因" value={riskReason} onChange={setRiskReason} options={riskReasonOptions.map((v) => ({ value: v, label: v }))} style={{ width: 180 }} />
          <Select allowClear placeholder="平台" value={platform} onChange={setPlatform} options={platformOptions.map((v) => ({ value: v, label: v }))} style={{ width: 130 }} />
          <Select allowClear placeholder="城市" value={city} onChange={setCity} options={[...cityStats.keys()].map((v) => ({ value: v, label: v }))} style={{ width: 140 }} />
        </Space>
      </Card>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={4}><Card size="small"><Statistic title="账号总数" value={filtered.length} /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title="覆盖城市" value={cityStats.size} /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title="有风险" value={filtered.filter((i) => i.riskPopped === '是' || riskNotesOf(i).length).length} valueStyle={{ color: '#d46b08' }} /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title="已封禁" value={filtered.filter((i) => i.banned === '是').length} valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col span={5}><Card size="small"><Statistic title="未使用热门城市" value={unusedHot.length} valueStyle={{ color: '#1677ff' }} /></Card></Col>
      </Row>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={15}>
          <Card size="small" title="账号 IP 分布" extra={<Text type="secondary" style={{ fontSize: 12 }}>圆点越大账号越多，点/悬浮看账号名</Text>}>
            <div ref={chartRef} style={{ width: '100%', height: 430 }} />
            {mapError && <Text type="secondary">{mapError}</Text>}
            <div style={{ marginTop: 8 }}>
              {[...cityStats.entries()].sort((a, b) => b[1].length - a[1].length).map(([c, list]) => (
                <Tag key={c} color={CITY_COORD[c] ? 'blue' : 'default'} style={{ marginBottom: 6 }}>
                  {c} {list.length}
                </Tag>
              ))}
            </div>
          </Card>
        </Col>
        <Col span={9}>
          <Card size="small" title="大类 → 细分风格（一眼看几个甜妹 / 御姐 / 少御）">
            {styleGroups.length ? styleGroups.map((group) => (
              <div key={group.type} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text strong>{group.type}</Text>
                  <Tag color="blue">{group.total} 个</Tag>
                </div>
                <Row gutter={[8, 8]}>
                  {group.styles.map(([s, list]) => {
                    const meta = styleMeta(s);
                    return (
                      <Col span={12} key={s}>
                        <div
                          onClick={() => setStyle(style === s ? undefined : s)}
                          style={{
                            cursor: 'pointer',
                            border: `1px solid ${style === s ? meta.color : '#eee'}`,
                            borderRadius: 10,
                            padding: '7px 9px',
                            background: `linear-gradient(135deg, ${meta.color}18, #fff)`,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ fontSize: 22, lineHeight: 1 }}>{meta.emoji}</span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700, color: TEXT.primary }}>{s}</div>
                              <div style={{ fontSize: 11, color: TEXT.tertiary }}>{list.length} 个</div>
                            </div>
                          </div>
                          <div style={{ marginTop: 4, fontSize: 11, color: TEXT.secondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {list.map((it) => it.nickname || it.code || '未命名').join('、')}
                          </div>
                        </div>
                      </Col>
                    );
                  })}
                </Row>
              </div>
            )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
          <Card size="small" title="热门城市缺口" style={{ marginTop: 12 }}>
            {unusedHot.length ? unusedHot.map((c) => <Tag key={c} color="gold" style={{ marginBottom: 6 }}>{c}</Tag>) : <Text type="secondary">热门城市都有账号</Text>}
          </Card>
        </Col>
      </Row>

      <Row gutter={12}>
        <Col span={12}>
          <Card size="small" title="封号/风险原因">
            {banStats.length ? banStats.map(([reason, list]) => (
              <div key={reason} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <Text ellipsis style={{ maxWidth: '75%' }}>{reason}</Text>
                <Space size={4} wrap>{list.map((it) => <Tag key={it.id}>{it.nickname}</Tag>)}</Space>
              </div>
            )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title="账号明细">
            <Table
              rowKey="id"
              size="small"
              loading={loading}
              dataSource={filtered}
              pagination={{ pageSize: 8 }}
              columns={[
                { title: '账号', key: 'name', render: (_: unknown, r) => <Space direction="vertical" size={0}><Text strong>{r.nickname}</Text><Text type="secondary" style={{ fontSize: 11 }}>{r.code || r.accountId || '-'}</Text></Space> },
                { title: '人设', dataIndex: 'accountRole', width: 100, render: (v: string) => v || '-' },
                { title: '风格', key: 'style', width: 90, render: (_: unknown, r) => { const s = styleOf(r); const m = styleMeta(s); return <Tag color={m.color}>{m.emoji} {s}</Tag>; } },
                { title: '城市', key: 'city', width: 100, render: (_: unknown, r) => cityOf(r) },
                { title: '风险', key: 'risk', width: 100, render: (_: unknown, r) => r.riskPopped === '是' ? <Tag color="orange">有风险</Tag> : '-' },
                { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => <Tag color={v === 'ACTIVE' ? 'green' : 'default'}>{v === 'ACTIVE' ? '正常' : '弃用'}</Tag> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default TrafficAccountOverviewPage;
