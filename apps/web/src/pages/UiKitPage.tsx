// craftsman-ignore: TS001,TS002
import React from 'react';
import { Alert, Badge, Button, Card, Col, Input, Row, Segmented, Select, Space, Switch, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import TableSkeleton from '../components/TableSkeleton';
import CardSkeleton from '../components/CardSkeleton';
import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { BG, BORDER, BRAND, FONT, GRADIENTS, MODULE_TINTS, RADIUS, ROLE_TINT, SEMANTIC, SHADOW, SPACE, TEXT, TIER_TINT } from '../styles/tokens';
import TierBadge from '../components/TierBadge';
import { tierMeta } from '../constants/tiers';

const { Text, Title, Paragraph } = Typography;

/**
 * 内部「设计校对页」（/ui-kit）—— 不在任何菜单里，给开发 / UI 改版对照用。
 *
 * 为什么要有它：这套系统改界面**没法在本机截图**（进页面要登录、还要连数据库），
 * 于是颜色 / 圆角 / 字号 / 表格样式这种「全站统一」的东西，改完只能靠人肉点页面才发现漂了。
 * 这一页把令牌与常见控件按真实主题（main.tsx 的 ConfigProvider）摆出来，
 * **不需要登录、不需要后端**，起个 preview 就能截一张图对照，改版前后各截一张即可。
 *
 * 注意：这些区块用的是和 AppLayout 相同的壳（.app-shell / .app-content），
 * 所以看到的就是登录后内容区真正的样子。
 */

const Section: React.FC<{ id: string; title: string; hint?: string; children: React.ReactNode }> = ({ id, title, hint, children }) => (
  <div id={id} style={{ marginBottom: SPACE.xxl, scrollMarginTop: SPACE.xl }}>
    <div className="ui-section-title" style={{ marginBottom: SPACE.sm }}>
      <span className="ui-dot" style={{ background: GRADIENTS.accentBar }} />
      {title}
      {hint ? <Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>{hint}</Text> : null}
    </div>
    {children}
  </div>
);

const Swatch: React.FC<{ name: string; value: string }> = ({ name, value }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, minWidth: 168 }}>
    <span style={{ width: 22, height: 22, borderRadius: RADIUS.xs, background: value, border: `1px solid ${BORDER.base}` }} />
    <span style={{ fontSize: 12, color: TEXT.secondary }}>
      {name}
      <br />
      <span style={{ color: TEXT.tertiary, fontFamily: 'monospace' }}>{value}</span>
    </span>
  </div>
);

const rows = [
  { key: '1', code: 'A20261007-001', customer: '小鹿', companion: '阿伟', amount: 128, status: '接单中' },
  { key: '2', code: 'A20261007-002', customer: '橙子', companion: '——', amount: 88, status: '待抢单' },
  { key: '3', code: 'A20261007-003', customer: '七喜', companion: '阿伟', amount: 258, status: '已完成' },
];

const columns = [
  { title: '订单号', dataIndex: 'code', key: 'code', width: 160 },
  { title: '客户', dataIndex: 'customer', key: 'customer', width: 100 },
  { title: '陪玩', dataIndex: 'companion', key: 'companion', width: 100 },
  { title: '金额', dataIndex: 'amount', key: 'amount', width: 90, render: (v: number) => `￥${v}` },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 110,
    render: (v: string) => (
      <Tag color={v === '已完成' ? 'success' : v === '接单中' ? 'processing' : 'warning'} style={{ borderRadius: RADIUS.pill }}>
        {v}
      </Tag>
    ),
  },
];

const UiKitPage: React.FC = () => (
  <div className="app-shell" style={{ minHeight: '100vh', padding: SPACE.xl }}>
    <div className="app-content" style={{ padding: SPACE.xl, borderRadius: RADIUS.xl }}>
      <Title level={4} style={{ marginTop: 0, marginBottom: 2, ...{ background: GRADIENTS.brand, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } }}>
        设计校对页
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: SPACE.xl }}>
        /ui-kit · 内部页，不在菜单里。改界面之后在这一页对照：颜色 / 圆角 / 字号 / 表格 / 按钮 / 标签是不是都从令牌来、是不是还整齐。
      </Paragraph>

      <Section id="brand" title="品牌与主色" hint="BRAND / GRADIENTS · 全站只认这一套紫">
        <Space size={SPACE.xl} wrap>
          <Swatch name="primary" value={BRAND.primary} />
          <Swatch name="primaryHover" value={BRAND.primaryHover} />
          <Swatch name="primaryBlue" value={BRAND.primaryBlue} />
          <Swatch name="accent" value={BRAND.accent} />
          <Swatch name="soft" value={BRAND.soft} />
          <Swatch name="sider" value={BRAND.sider} />
        </Space>
        <Space size={SPACE.md} style={{ marginTop: SPACE.md }} wrap>
          <div style={{ width: 180, height: 40, borderRadius: RADIUS.md, background: GRADIENTS.brand }} />
          <div style={{ width: 180, height: 40, borderRadius: RADIUS.md, background: GRADIENTS.header }} />
          <div style={{ width: 180, height: 40, borderRadius: RADIUS.md, background: GRADIENTS.siderSelected }} />
        </Space>
      </Section>

      <Section id="text" title="文字 / 背景 / 描边" hint="TEXT / BG / BORDER">
        <Space size={SPACE.xl} wrap>
          <Swatch name="text.primary" value={TEXT.primary} />
          <Swatch name="text.secondary" value={TEXT.secondary} />
          <Swatch name="text.tertiary" value={TEXT.tertiary} />
          <Swatch name="bg.base" value={BG.base} />
          <Swatch name="bg.content" value={BG.content} />
          <Swatch name="border.base" value={BORDER.base} />
          <Swatch name="border.light" value={BORDER.light} />
        </Space>
        <div style={{ marginTop: SPACE.md, background: BG.base, border: `1px solid ${BORDER.base}`, borderRadius: RADIUS.md, padding: SPACE.lg }}>
          <div style={{ color: TEXT.primary, fontWeight: 600 }}>一级文字：订单 A20261007-001 已接单</div>
          <div style={{ color: TEXT.secondary }}>二级文字：客户 小鹿 · 王者荣耀 · 2 小时</div>
          <div style={{ color: TEXT.tertiary, fontSize: 12 }}>三级文字：2026-10-07 13:20 由客服 小美 发布</div>
        </div>
      </Section>

      <Section id="semantic" title="语义色 / 状态色" hint="SEMANTIC · 代表含义，不要拿去当装饰色">
        <Space size={SPACE.xl} wrap>
          <Swatch name="success" value={SEMANTIC.success} />
          <Swatch name="warning" value={SEMANTIC.warning} />
          <Swatch name="danger" value={SEMANTIC.danger} />
          <Swatch name="info" value={SEMANTIC.info} />
        </Space>
        <div style={{ marginTop: SPACE.lg, fontSize: 12, color: TEXT.tertiary }}>
          同一个含义的深浅档 —— 深的是「当字用」、亮的是「当数字用」，别混
        </div>
        <Space size={SPACE.xl} style={{ marginTop: SPACE.sm }} wrap>
          <Swatch name="success.deep" value={SEMANTIC.successDeep} />
          <Swatch name="success.bright" value={SEMANTIC.successBright} />
          <Swatch name="danger.mid" value={SEMANTIC.dangerMid} />
          <Swatch name="danger.strong" value={SEMANTIC.dangerStrong} />
          <Swatch name="danger.deep" value={SEMANTIC.dangerDeep} />
          <Swatch name="warning.strong" value={SEMANTIC.warningStrong} />
          <Swatch name="warning.deep" value={SEMANTIC.warningDeep} />
          <Swatch name="orange.deeper" value={SEMANTIC.orangeDeeper} />
          <Swatch name="info.bright" value={SEMANTIC.infoBright} />
          <Swatch name="info.deep" value={SEMANTIC.infoDeep} />
          <Swatch name="teal" value={SEMANTIC.teal} />
          <Swatch name="direct" value={SEMANTIC.direct} />
          <Swatch name="online" value={SEMANTIC.online} />
          <Swatch name="busy" value={SEMANTIC.busy} />
          <Swatch name="idle" value={SEMANTIC.idle} />
        </Space>
        <div style={{ marginTop: SPACE.lg, fontSize: 12, color: TEXT.tertiary }}>
          淡底 + 同色描边那一套 —— 标签 / 告警条 / 统计卡底用的
        </div>
        <Space size={SPACE.xl} style={{ marginTop: SPACE.sm }} wrap>
          <Swatch name="success.soft" value={SEMANTIC.successSoft} />
          <Swatch name="success.border" value={SEMANTIC.successBorder} />
          <Swatch name="warning.soft" value={SEMANTIC.warningSoft} />
          <Swatch name="orange.soft" value={SEMANTIC.orangeSoft} />
          <Swatch name="danger.soft" value={SEMANTIC.dangerSoft} />
          <Swatch name="danger.border" value={SEMANTIC.dangerBorder} />
          <Swatch name="danger.edge" value={SEMANTIC.dangerEdge} />
          <Swatch name="danger.edgeSoft" value={SEMANTIC.dangerEdgeSoft} />
          <Swatch name="info.soft" value={SEMANTIC.infoSoft} />
          <Swatch name="info.border" value={SEMANTIC.infoBorder} />
          <Swatch name="info.softBlue" value={SEMANTIC.infoSoftBlue} />
          <Swatch name="teal.soft" value={SEMANTIC.tealSoft} />
          <Swatch name="direct.soft" value={SEMANTIC.directSoft} />
          <Swatch name="direct.border" value={SEMANTIC.directBorder} />
          <Swatch name="bg.brandSoft" value={BG.brandSoft} />
          <Swatch name="bg.error" value={BG.error} />
        </Space>
        <Space size={SPACE.sm} style={{ marginTop: SPACE.md }} wrap>
          <Tag color="success">已完成</Tag>
          <Tag color="processing">接单中</Tag>
          <Tag color="warning">待抢单</Tag>
          <Tag color="error">已取消</Tag>
          <Tag color="default">已挂起</Tag>
        </Space>
        {/* 状态点：绿点 = 在线（外面那圈呼吸光环是 pulse-glow，颜色跟点同色） */}
        <Space size={SPACE.xl} style={{ marginTop: SPACE.md }} wrap>
          <span style={{ fontSize: 12, color: TEXT.secondary }}>
            <span className="status-dot online" /> 在线（呼吸光环）
          </span>
          <span style={{ fontSize: 12, color: TEXT.secondary }}>
            <span className="status-dot busy" /> 忙碌
          </span>
          <span style={{ fontSize: 12, color: TEXT.secondary }}>
            <span className="status-dot offline" /> 离线
          </span>
        </Space>
      </Section>

      <Section id="tier" title="段位（马级）" hint="TIER_TINT / constants/tiers.ts · 金 / 银 / 铜，全站唯一一份">
        <Space size={SPACE.xl} wrap>
          <Swatch name="tier.top" value={TIER_TINT.top} />
          <Swatch name="tier.middle" value={TIER_TINT.middle} />
          <Swatch name="tier.low" value={TIER_TINT.low} />
        </Space>
        <Space size={SPACE.lg} style={{ marginTop: SPACE.md }} wrap>
          {(['TOP', 'MIDDLE', 'LOW'] as const).map((tier) => (
            <span key={tier} style={{ display: 'inline-flex', alignItems: 'center', gap: SPACE.sm }}>
              <TierBadge tier={tier} showLabel />
              <Tag color={tierMeta(tier).color} style={{ borderRadius: RADIUS.pill }}>
                {tierMeta(tier).label}
              </Tag>
            </span>
          ))}
        </Space>
      </Section>

      <Section id="modules" title="模块色（左栏一级菜单）" hint="MODULE_TINTS · 按菜单 key 后半段取色">
        <Space size={SPACE.lg} wrap>
          {Object.entries(MODULE_TINTS).map(([key, value]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TEXT.secondary }}>
              <span className="ui-dot" style={{ background: value }} />
              {key}
            </div>
          ))}
        </Space>
        <div style={{ marginTop: SPACE.lg, fontSize: 12, color: TEXT.tertiary }}>
          角色身份色 —— ROLE_TINT（按「人是谁」上色，别跟上面按「菜单」上色的混）
        </div>
        <Space size={SPACE.lg} wrap style={{ marginTop: SPACE.sm }}>
          {Object.entries(ROLE_TINT).map(([key, value]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: TEXT.secondary }}>
              <span className="ui-dot" style={{ background: value }} />
              {key}
            </div>
          ))}
        </Space>
      </Section>

      <Section id="controls" title="按钮 / 输入 / 开关">
        <Space size={SPACE.md} wrap>
          <Button type="primary">主要按钮</Button>
          <Button>次要按钮</Button>
          <Button type="primary" ghost>幽灵按钮</Button>
          <Button danger>删除</Button>
          <Button type="primary" danger>删除订单</Button>
          <Button type="primary" icon={<PlusOutlined />}>新建订单</Button>
          <Button icon={<ReloadOutlined />} />
          <Button type="link">文字链接</Button>
          <Button type="primary" disabled>不可用</Button>
        </Space>
        <Space size={SPACE.md} style={{ marginTop: SPACE.md }} wrap>
          <Input placeholder="搜索订单号 / 客户" prefix={<SearchOutlined />} style={{ width: 240 }} />
          <Select defaultValue="全部" style={{ width: 140 }} options={[{ value: '全部' }, { value: '待抢单' }, { value: '已完成' }]} />
          <Segmented options={['今日', '本周', '本月']} />
          <Switch defaultChecked />
          <Badge count={7} />
          <Tooltip title="鼠标停在这里会显示说明">
            <Tag style={{ borderRadius: RADIUS.pill }}>带提示的标签</Tag>
          </Tooltip>
        </Space>
      </Section>

      <Section id="cards" title="卡片 / 统计卡" hint=".ui-panel / .stat-card">
        <Row gutter={SPACE.lg}>
          <Col span={8}>
            <Card className="stat-card" size="small">
              <Text type="secondary">今日流水</Text>
              <div style={{ fontSize: 26, fontWeight: 700, color: TEXT.primary }}>￥12,860</div>
              <Text type="secondary" style={{ fontSize: 12 }}>较昨日 +8%</Text>
            </Card>
          </Col>
          <Col span={8}>
            <Card className="stat-card" size="small">
              <Text type="secondary">待抢单</Text>
              <div style={{ fontSize: 26, fontWeight: 700, color: BRAND.primary }}>6</div>
              <Text type="secondary" style={{ fontSize: 12 }}>最久等了 12 分钟</Text>
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <div className="ui-section-title" style={{ marginBottom: SPACE.sm }}>面板标题</div>
              <div className="ui-chip" style={{ background: BRAND.soft, color: BRAND.primary }}>胶囊</div>
              <div style={{ marginTop: SPACE.sm, color: TEXT.secondary, fontSize: 12 }}>普通卡片（不带左侧色条）</div>
            </Card>
          </Col>
        </Row>
      </Section>

      <Section id="table" title="表格 / 标签页 / 空状态">
        <Tabs
          items={[
            { key: 'a', label: '订单列表', children: <Table size="small" pagination={false} columns={columns} dataSource={rows} /> },
            { key: 'b', label: '空数据的样子', children: <EmptyState description="今天还没有单" /> },
            { key: 'd', label: '加载中的样子', children: (
              <Space direction="vertical" size={SPACE.md} style={{ width: '100%' }}>
                <Text type="secondary">页面 / 区块「第一次加载」一律用 LoadingState（转圈 + 文案，显式占高，内容回来不跳）</Text>
                <Card size="small"><LoadingState minHeight={120} /></Card>
                <Card size="small"><LoadingState size="large" minHeight={200} /></Card>
                <Text type="secondary">形状可预判的地方用骨架屏（表格 / 卡片），比转圈更稳、看着更「快」</Text>
                <TableSkeleton columns={4} rows={3} />
                <CardSkeleton lines={3} />
              </Space>
            ) },
            { key: 'c', label: '提示条', children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Alert type="success" showIcon message="对账完成，38 张单全部核对通过" />
                <Alert type="warning" showIcon message="有 2 张单快超时了，尽快处理" />
                <Alert type="error" showIcon message="客户端 3 台离线超过 10 分钟" />
                <Alert type="info" showIcon message="版本 v1001 已发布，客户端会自行升级" />
              </Space>
            ) },
          ]}
        />
      </Section>

      <Section id="tokens" title="圆角 / 间距 / 字号" hint="RADIUS / SPACE / FONT">
        <Space size={SPACE.md} wrap>
          {Object.entries(RADIUS).map(([k, v]) => (
            <div key={k} style={{ textAlign: 'center', fontSize: 11, color: TEXT.secondary }}>
              <div style={{ width: 56, height: 40, background: BRAND.soft, border: `1px solid ${BRAND.primary}`, borderRadius: v }} />
              {k} {v}
            </div>
          ))}
        </Space>
        <div style={{ marginTop: SPACE.md, color: TEXT.secondary, fontSize: 12 }}>
          间距档位：{Object.entries(SPACE).map(([k, v]) => `${k}=${v}`).join(' · ')}
        </div>
        <div style={{ marginTop: SPACE.sm }}>
          <span style={{ fontSize: FONT.sizeLG }}>16 标题</span>
          <span style={{ fontSize: FONT.size, marginLeft: SPACE.md }}>14 正文</span>
          <span style={{ fontSize: FONT.sizeSM, marginLeft: SPACE.md }}>12 说明</span>
          <span style={{ marginLeft: SPACE.md, color: TEXT.tertiary, fontSize: 12 }}>阴影：{Object.keys(SHADOW).join(' / ')}</span>
        </div>
      </Section>
    </div>
  </div>
);

export default UiKitPage;
