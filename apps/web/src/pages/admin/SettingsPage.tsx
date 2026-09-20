// craftsman-ignore: TS001,TS002
import React, { useMemo, useState } from 'react';
import { Input, Typography, Empty } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import RevenueSettings from '../settings/RevenueSettings';
import PaymentSettings from '../settings/PaymentSettings';
import StudioSettings from '../settings/StudioSettings';
import NotificationSettings from '../settings/NotificationSettings';
import AttendanceSettings from '../settings/AttendanceSettings';
import CaptureSettings from '../settings/CaptureSettings';
import DispatchCommissionSettings from '../settings/DispatchCommissionSettings';
import GameBreakEvenSettings from '../settings/GameBreakEvenSettings';
import DispatchTimingSettings from '../settings/DispatchTimingSettings';
import VoiceSettings from '../settings/VoiceSettings';
import ExcellenceSettings from '../settings/ExcellenceSettings';
import AiSettings from '../settings/AiSettings';
import NoteBenchmarkSettings from '../settings/NoteBenchmarkSettings';
import StudioConfigScopeBar from '../../components/settings/StudioConfigScopeBar';
import { useAuthStore } from '../../stores/authStore';

const { Text } = Typography;

/**
 * 设置中心：13 个设置项原来平铺成一长排 Tab，找一个设置要横着数一遍，
 * 而且分组毫无规律（钱、派单、客户端、通知混在一起）。
 *
 * 现在改成「左侧分组导航 + 顶部搜索 + 右侧内容」：
 * - 按「钱 → 派单 → 客户端 → 门店」四组归位，同类的挨在一起；
 * - 搜索框支持按名字和关键词找（如「分账」「截图」「提成」「TURN」）；
 * - 只挂载当前打开的那一项，不用的组件不渲染、不进内存。
 */
interface SettingItem {
  key: string;
  label: string;
  hint: string;
  keywords: string;
  /** 只有老板能改的项（密钥 / 凭据）：店长看不到，也不会误改。 */
  ownerOnly?: boolean;
  render: () => React.ReactNode;
}
interface SettingGroup {
  title: string;
  /** 分组配色：左边导航的色点、选中项的光条都取这个色（老板 2026-09-21 要求「有层次感」）。 */
  tint: string;
  items: SettingItem[];
}

const GROUPS: SettingGroup[] = [
  {
    title: '钱 · 分账', tint: '#10B981',
    items: [
      {
        key: 'revenue',
        label: '流水与价格',
        hint: '单价、支取、押金',
        keywords: '流水 价格 单价 支取 提现 押金 钱包 结算',
        render: () => <RevenueSettings />,
      },
      {
        key: 'payment',
        label: '分账规则',
        hint: '按流水档位分工作室 / 陪玩',
        keywords: '分账 分成 档位 比例 分润',
        render: () => <PaymentSettings />,
      },
      {
        key: 'game-break-even',
        label: '游戏盈亏平衡点',
        hint: '各游戏每小时成本',
        keywords: '盈亏 平衡点 成本 游戏',
        render: () => <GameBreakEvenSettings />,
      },
    ],
  },
  {
    title: '派单 · 等级', tint: '#00B8D9',
    items: [
      {
        key: 'dispatch',
        label: '派单与提成',
        hint: '工作室分成、名额、桥接返款',
        keywords: '派单 提成 分成 名额 桥接 返款 机密 绝密',
        render: () => <DispatchCommissionSettings />,
      },
      {
        key: 'dispatch-timing',
        label: '各等级等待时间',
        hint: '上等马 / 桥接 / 中等马 / 下等马',
        keywords: '等待 延迟 等级 上等马 中等马 下等马 桥接 线上 订单消失',
        render: () => <DispatchTimingSettings />,
      },
      {
        key: 'excellence',
        label: '评分与名额',
        hint: '分数线、段位名额、末位处理',
        keywords: '评分 分数 名额 上等马 中等马 下等马 离职 战绩图',
        render: () => <ExcellenceSettings />,
      },
      {
        key: 'note-benchmark',
        label: '图文笔记及格线',
        hint: '笔记判级标准',
        keywords: '笔记 及格线 判级 图文',
        render: () => <NoteBenchmarkSettings />,
      },
    ],
  },
  {
    title: '陪玩端 · 客户端', tint: '#7C4DFF',
    items: [
      {
        key: 'capture',
        label: '截图阈值',
        hint: '截图间隔、黑屏判定',
        keywords: '截图 间隔 黑屏 阈值 采集 证据',
        render: () => <CaptureSettings />,
      },
      {
        key: 'voice',
        label: '语音通话',
        hint: 'TURN 穿透配置（老板专属）',
        keywords: '语音 通话 turn 穿透 麦克风',
        ownerOnly: true,
        render: () => <VoiceSettings />,
      },
      {
        key: 'ai',
        label: 'AI 分析',
        hint: '模型与密钥（老板专属）',
        keywords: 'ai 模型 密钥 分析 豆包 智能',
        ownerOnly: true,
        render: () => <AiSettings />,
      },
      {
        key: 'attendance',
        label: '考勤设置',
        hint: '上下班与工时口径',
        keywords: '考勤 上班 下班 工时 打卡',
        render: () => <AttendanceSettings />,
      },
    ],
  },
  {
    title: '门店 · 通知', tint: '#F59E0B',
    items: [
      {
        key: 'studio',
        label: '运营设置',
        hint: '娱乐门槛、结算时间、下拉选项、游戏段位',
        keywords: '运营 娱乐 门槛 结算 时间 选项 游戏 段位 下拉',
        render: () => <StudioSettings />,
      },
      {
        key: 'notification',
        label: '通知设置',
        hint: '提示音与弹窗',
        keywords: '通知 提醒 声音 弹窗 铃铛',
        render: () => <NotificationSettings />,
      },
    ],
  },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.title })));

const SettingsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'OWNER';
  const [activeKey, setActiveKey] = useState('revenue');
  const [keyword, setKeyword] = useState('');

  // 密钥 / 凭据类（AI、TURN）只有老板能改，店长连入口都不显示，避免误改与泄露。
  const groupsForRole = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((it) => isOwner || !it.ownerOnly),
      })).filter((g) => g.items.length > 0),
    [isOwner],
  );

  const kw = keyword.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (!kw) return groupsForRole;
    return groupsForRole.map((g) => ({
      ...g,
      items: g.items.filter(
        (it) => `${it.label} ${it.hint} ${it.keywords} ${g.title}`.toLowerCase().includes(kw),
      ),
    })).filter((g) => g.items.length > 0);
  }, [kw, groupsForRole]);

  // 搜索时如果当前打开的这一项被过滤掉了，就自动切到第一条命中项，
  // 否则会出现「左边只剩一项、右边还显示着别的内容」的错位感。
  // 「共 N 项」按当前身份实际能看到几项算（老板比店长多出 AI / 语音这两项）
  const availableCount = groupsForRole.reduce((n, g) => n + g.items.length, 0);
  const visibleItems = visibleGroups.flatMap((g) => g.items);
  const activeInView = visibleItems.some((it) => it.key === activeKey);
  const active = activeInView
    ? ALL_ITEMS.find((it) => it.key === activeKey)!
    : visibleItems[0] || ALL_ITEMS[0];

  return (
    <div>
      <StudioConfigScopeBar />
      <div style={{ marginBottom: 12 }}>
        <span className="ui-section-title" style={{ fontSize: 16 }}>
          <span className="ui-dot" style={{ background: 'linear-gradient(135deg,#00e5ff,#7c4dff)' }} />
          系统设置
        </span>
        <Text type="secondary" style={{ marginLeft: 10, fontSize: 12 }}>
          修改后即时生效 · 共 {availableCount} 项，左边选分类，或者直接搜
        </Text>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div
          className="ui-panel"
          style={{
            width: 196,
            flex: '0 0 196px',
            position: 'sticky',
            top: 12,
            padding: 8,
          }}
        >
          <Input
            allowClear
            size="small"
            prefix={<SearchOutlined style={{ color: '#94a3b8' }} />}
            placeholder="搜索设置项"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ marginBottom: 8 }}
          />

          {visibleGroups.length === 0 && (
            <div style={{ padding: '16px 4px', textAlign: 'center' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                没有匹配的设置项
              </Text>
            </div>
          )}

          {visibleGroups.map((g) => (
            <div key={g.title} style={{ marginBottom: 6 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  color: '#94a3b8',
                  padding: '6px 8px 4px',
                  letterSpacing: 0.5,
                }}
              >
                <span className="ui-dot" style={{ background: g.tint, width: 7, height: 7 }} />
                {g.title}
              </div>
              {g.items.map((it) => {
                const on = it.key === activeKey;
                return (
                  <div
                    key={it.key}
                    onClick={() => setActiveKey(it.key)}
                    style={{
                      cursor: 'pointer',
                      borderRadius: 8,
                      padding: '6px 8px',
                      marginBottom: 2,
                      // 选中项用本组的主题色做一层淡渐变 + 左侧光条，看起来有「层级」
                      background: on
                        ? `linear-gradient(90deg, ${g.tint}1F, ${g.tint}0A 70%, transparent)`
                        : 'transparent',
                      borderLeft: `3px solid ${on ? g.tint : 'transparent'}`,
                      transition: 'background 0.18s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!on) e.currentTarget.style.background = '#f6f8fc';
                    }}
                    onMouseLeave={(e) => {
                      if (!on) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        color: on ? g.tint : '#334155',
                        fontWeight: on ? 600 : 400,
                      }}
                    >
                      {it.label}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{it.hint}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {visibleGroups.length === 0 ? (
            <Empty description={<Text type="secondary">换个词试试，例如「分账」「截图」「提成」</Text>} />
          ) : (
            active.render()
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
