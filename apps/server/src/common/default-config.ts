import { BadRequestException } from '@nestjs/common';

/**
 * 系统配置的「内置默认值」+「哪些配置是分店的」。
 *
 * 老板 2026-09-21 拍板：**以后进来的租赁线下工作室、线上俱乐部，所有数据由他们自己的店长填写**。
 * 所以配置分两层，任何一处读配置都必须走 `common/studio-config.ts` 的解析器：
 *  1. **分店自己的值**（`StudioConfig` 表，店长填）——优先；
 *  2. **老板给的默认值**（`SystemConfig` 表 / 这里的 DEFAULT_CONFIGS）——分店没填就用它。
 *
 * 这里只放「会影响这家店的钱和派单」的键（见 STUDIO_SCOPED_PREFIXES）；
 * 全站唯一的键（JWT、AI key、前端版本、老板手动开关的黑名单等）不进分店层。
 */

export const DEFAULT_CONFIGS: Record<string, any> = {
  // 新单弹窗停留秒数（老板 2026-09-20 起可配，比原来写死的 15 秒更灵活）
  'pool.popup_seconds': 20,
  // WebSocket 令牌宽限期（小时）：客户端拿着过期令牌重连时，只要令牌确实是本服务器签发的
  // 就允许先连上（HTTP 接口不受影响），否则陪玩端弹窗会断在「accessToken 15 分钟过期」上。
  'ws.token_grace_hours': 168,
  // 断开后多久才真的置「离线」（秒）：客户端刷新页面 / 网络抖动 / 服务端发版重启时
  // 不希望在控制台闪出「掉线」，宽限期内连回来就当没掉过。
  'ws.offline_grace_seconds': 60,
  'revenue.free_threshold': 300,
  'revenue.low_warning': 300,
  // 分润阶梯一律以「系统设置里老板填的」为准，这里只做首次初始化的默认值。
  'revenue.share_tiers': [
    { min: 0, max: 5999.9, studio: 50, companion: 50 },
    { min: 6000, max: 9999, studio: 40, companion: 60 },
    { min: 10000, max: null, studio: 30, companion: 70 },
  ],
  'withdraw.advance_ratio': 50,
  'withdraw.default_deposit': 500,
  'entertainment.revenue_threshold': 200,
  'entertainment.deposit_threshold': 500,
  'entertainment.hourly_rate': 60,
  'options.contact_results': ['现在玩', '改天玩', '未回消息', '好友未通过', '被客户删除'],
  'options.finish_results': ['正常完成', '客户续单', '变声器退款', '技术差退款'],
  'options.fail_reasons': ['抢单未加微信', '好友未通过', '客户不回消息', '客户删除', '客户说不打', '其他'],
  'traffic.account_types': ['抖音', '小红书', '视频号', '快手', '咸鱼', 'B站'],
  'traffic.account_columns': [
    { key: 'type', label: '平台', custom: false },
    { key: 'code', label: '编号', custom: false },
    { key: 'trafficLevel', label: '流量', custom: false },
    { key: 'nickname', label: '昵称', custom: false },
    { key: 'accountId', label: 'ID', custom: false },
    { key: 'wifi', label: 'WiFi', custom: false },
    { key: 'wifiNote', label: 'WiFi备注', custom: true },
    { key: 'wifiRegion', label: 'WiFi地区', custom: false },
    { key: 'purchaseDate', label: '购买时间', custom: true },
    { key: 'riskPopped', label: '弹过风险', custom: false },
    { key: 'riskNote', label: '风险备注', custom: false },
    { key: 'banned', label: '封禁过', custom: false },
    { key: 'banNote', label: '封禁备注', custom: false },
    { key: 'phone', label: '注册手机号', custom: false },
    { key: 'promotionContact', label: '地推联系人', custom: false },
    { key: 'realName', label: '实名', custom: false },
    { key: 'registerDate', label: '注册日期', custom: false },
    { key: 'banDate', label: '封禁日期', custom: false },
    { key: 'imageSourceNote', label: '图片来源备注', custom: false },
    { key: 'otherNote', label: '其他备注', custom: false },
  ],
  games: ['英雄联盟', '王者荣耀', '无畏契约', 'CS2', 'DOTA2', '永劫无间', '绝地求生', 'Apex英雄'],
  ranks: ['青铜', '白银', '黄金', '铂金', '钻石', '大师', '宗师', '王者'],
  'identity.app_code': '',
  'identity.app_key': '',
  'identity.app_secret': '',
  'turn.url': '',
  'turn.username': '',
  'turn.credential': '',
  // 陪玩处于「空闲/娱乐」等状态时，客户端是否自动结束状态黑名单里的进程。
  // 默认关闭：名单只记录不杀，避免把正在玩游戏的陪玩误杀（见 2026-09-20 误杀事故）。
  'blacklist.auto_kill': false,
  'agent.latest_version': '1.0.0',
  'agent.latest_download_url': '/uploads/chunlv-latest.zip',
  'ai.provider': 'doubao',
  'ai.deepseek_api_key': '',
  'ai.doubao_api_key': '',
  'ai.doubao_model': 'doubao-pro-32k',
  'ai.doubao_vision_model': 'Doubao-1.5-vision-pro',
  'traffic.note_benchmarks': {
    clickRate: { eliminate: 2.5, pass: 4.5, good: 4.5 },
    interactionRate: { eliminate: 2, pass: 3.5, good: 3.5 },
    dmRate: { eliminate: 0.5, pass: 1.5, good: 3 },
    searchRatio: { min: 10, idealLow: 20, idealHigh: 40 },
    profileRatio: { ok: 10, warn: 20 },
    readCompletionRate: { min: 40 },
  },
  'traffic.play_guide': `三角洲陪玩 · 小红书图文矩阵打法

一、账号分工（不要全做成一样）
- 情绪娱乐号（50%）：会聊天、心态好，主打排位破防、队友摆烂、娱乐组队，吃首页推荐。
- 技术上分号（35%）：技术打手，主打护航/上分/刷哈弗币/过任务，吃搜索流量，是私信主力。
- 避坑干货号（15%）：老玩家，写避坑/技巧/踩坑经验，提信任、吃长尾搜索词。
- 禁止全账号统一头像/简介/文案，容易被批量关联限流。

二、封面与标题（决定点击率）
- 封面 3:4 竖版，文字必带关键词：三角洲、上分、排位坐牢、护航。
- 封面两种：①痛点提问「三角洲排位坐牢怎么办？」②场景共鸣「打三角洲天天被队友搞破防」。
- 标题公式：核心词+痛点+情绪提问；别写硬广「三角洲陪玩接单速来」。

三、正文四段式（图文 3-6 张最佳，别写长文）
- 开头：场景痛点，埋关键词；中间：对局感受/段位困境+截图；结尾：弱互动钩子；标签带长尾词。
- 同一选题分发不同账号必须改写+换图，相似度控制在 30% 以内。

四、发布节奏
- 单账号每日 1-2 篇；多账号错峰 30-90 分钟；集中在 12-14 点、19-23 点。
- 新选题先 1-2 个号测试，数据跑合格再批量改写分发。

五、硬性风控
- 一机一号一卡独立网络，不共用 WiFi、不用机房 VPN/代理 IP；中兴手机尽量不解 BL 锁。
- 禁止互赞互评互@；笔记/简介不放微信、不站外导流；评论区不写「扣1」；不刷赞刷评。

六、数据淘汰标准（48 小时看结果）
- 点击率：<2.5% 淘汰 · 2.5-4.5% 铺量及格 · >4.5% 优质复用
- 互动率（赞藏评/浏览）：<2% 淘汰 · 2-3.5% 及格 · >3.5% 优质
- 搜索来源占比：<10% 淘汰 · 10-20% 及格 · >20% 优质
- 个人主页来源占比：>20% 淘汰 · ≤10% 达标
- 淘汰档换封面标题重写；优质档改写后全矩阵复用。

七、判断笔记有没有进入搜索【综合池】
注意：不要用发布本机/同账号去搜，账号缓存会优先展示自己作品，测试不准，要用无关设备。
1. 拿一台普通私人手机（未登录你的账号、不是矩阵设备），退出登录或用无关小号。
2. 搜索框输入目标词（如「三角洲陪玩」），保持「综合」标签（别点「最新」），下滑翻页找你的笔记。
- ✅ 综合页能搜到：已进入搜索综合池，关键词被收录，能持续吃搜索长尾流量。
- ❌ 综合翻不到、只有「最新」能看到：只发布成功、没拿到搜索权重，搜索占比再高也难持续来客。
- 常见原因：文案相似度高、硬广太重、关键词堆砌、账号风控、阅读完成率过低。

补充判断（看专业号后台）：
- 发布 24-48 小时后看「搜索占比」：≥10% 基本已进综合池；<5% 大概率只待在最新池。
- 48h 搜索占比一直很低 + 换小号综合页搜不到：改写标题+正文重新发布，别死扛。

小知识点：
- 刚发 0-6 小时多只在「最新」，等系统收录至少 24 小时再判断。
- 进综合池不是永久排名，同行大量发会掉排名，所以要持续产新笔记抢位置。
- 别用自己账号搜自己笔记反复点，会干扰后台数据、产生无效浏览。`,
  'capture.interval_min_minutes': 12,
  'capture.interval_max_minutes': 18,
  'capture.first_delay_min_minutes': 1,
  'capture.first_delay_max_minutes': 3,
  'capture.black_jpeg_kb': 15,
  'capture.expected_per_hour': 4,
  'capture.min_rate_percent': 50,
  'capture.black_rate_max_percent': 30,
  'attendance.workStart': '09:00',
  'attendance.workEnd': '18:00',
  'notification.sound': true,
  'notification.desktop': true,
  'notification.badge': true,
  'pool.unlock_revenue_enabled': true,
  'pool.unlock_revenue_threshold': 200,
  'pool.success_rate_gate_enabled': true,
  'pool.success_rate_gate_threshold': 90,
  'pool.priority_delay_seconds': 0,
  'pool.bridge_delay_seconds': 30,
  'pool.middle_delay_seconds': 60,
  'pool.low_delay_seconds': 120,
  'pool.online_delay_seconds': 180,
  'pool.immediate_disappear_minutes': 10,
  'pool.scheduled_disappear_minutes': 60,
  'service.stale_session_hours': 24,
  'anomaly.revenue_drop_percent': 50,
  'anomaly.hours_drop_percent': 50,
  'anomaly.spend_drop_percent': 50,
  'anomaly.price_tier_downgrade_enabled': true,
  'billing.report_diff_warning_yuan': 10,
  'dispatch.bridge_immediate_window_sec': 60,
  'dispatch.top_tier_daily_new_limit': 999,
  'dispatch.middle_tier_daily_new_limit': 2,
  'dispatch.low_tier_daily_new_limit': 1,
  'dispatch.break_even_hours': 2.5,
  'dispatch.studio_share_percent': 30,
  // 综合评分权重（默认：月流水50 + 续单20 + 复购20 + 首单10，上等马线50）
  'excellence.revenue_weight': 50,
  'excellence.revenue_cap_yuan': 10000,
  'excellence.renew_weight': 20,
  'excellence.repurchase_weight': 20,
  'excellence.first_success_weight': 10,
  'excellence.excellent_threshold': 50,
  'excellence.middle_tier_threshold': 25,
  'excellence.battle_screenshot_bonus': 1,
  'excellence.low_tier_auto_resign_days': 0,
  'excellence.revenue_tiers': [
    { min: 0, score: 0 },
    { min: 3000, score: 20 },
    { min: 6000, score: 40 },
    { min: 10000, score: 50 },
  ],
  'excellence.renew_tiers': [
    { min: 0, score: 0 },
    { min: 30, score: 10 },
    { min: 60, score: 20 },
  ],
  'excellence.repurchase_tiers': [
    { min: 0, score: 0 },
    { min: 30, score: 10 },
    { min: 60, score: 20 },
  ],
  'excellence.first_success_tiers': [
    { min: 0, score: 0 },
    { min: 40, score: 5 },
    { min: 70, score: 10 },
  ],
  // 桥接工作室首单返还（仅适用于桥接线下工作室）：首单 = 第一个小时。机密首单不结（0）；绝密按 15 元/小时/陪玩返还（双陪×2）。
  'dispatch.bridge_return_jimi_cents': 0,
  'dispatch.bridge_return_jueju_cents': 1500,
  'bridge.secret_price_yuan': 35,
  'bridge.jueju_net_yuan': 30,
  'commission.cs_bridge_per_order_yuan': 1,
  'commission.cs_base_salary_yuan': 0,
  'dispatch.game_break_even_hours': [
    { game: '三角洲行动', hours: 1.75 },
    { game: '无畏契约', hours: 0 },
    { game: '绝地求生', hours: 0 },
    { game: 'CS2', hours: 0 },
    { game: '永劫无间', hours: 0 },
    { game: '王者荣耀', hours: 0 },
    { game: '英雄联盟', hours: 0 },
    { game: '金铲铲', hours: 0 },
    { game: '三角洲手游', hours: 0 },
    { game: '和平精英', hours: 0 },
  ],
  'commission.cs_offline_rate_percent': 1,
  // 下面这批键原来只在代码里写死兜底值，配置表里没有 —— 结果是「店长填了 70、
  // 「分账规则」页还是显示 80」这种显示与生效不一致的老毛病（老板反复踩过）。
  // 统一登记进来：页面上看到的就是实际参与算钱的数字。
  'revenue.club_companion_share': 80,
  'commission.cs_bridge_min_threshold': 130,
  'commission.cs_bridge_tier3_threshold': 182,
  'commission.cs_bridge_tier5_threshold': 260,
  'commission.cs_bridge_tier3_yuan': 3,
  'commission.cs_bridge_tier5_yuan': 5,
  'commission.cs_full_attendance_bonus_yuan': 0,
  'commission.cs_early_leave_deduction_yuan': 0,
  'commission.cs_daily_bridge_target': 10,
  'commission.cs_bridge_miss_commission_rate': 50,
  'commission.cs_bridge_miss_salary_rate': 80,
  // 店长分成比例（% 流水，老板 2026-09-21：一单流水由 工作室/店长/客服/陪玩 四个人分）。
  // 默认 0 = 店长暂不参与分成（老口径不变），在「利润分成」页里填。
  'commission.admin_offline_rate_percent': 0,
  'commission.admin_online_rate_percent': 0,
  'commission.cs_offline_floor_cents': 200,
  'commission.cs_online_per_order_yuan': 1,
  'commission.cs_offline_per_order_cap_cents': 0,
  'commission.attribution_window': 'month',
};


/**
 * 分店可以自己填的配置前缀（其余都是全站唯一的）。
 * 判定：**影响这家店的钱 / 派单 / 计费口径** 的配置，交给店长自己填。
 */
/**
 * **分店可以自己填的配置**（老板 2026-09-21 拍板：以后进来的租赁线下工作室、线上俱乐部，
 * 所有数据由他们自己的店长填写）。
 *
 * 只列「已经真的按店生效」的键 —— 每个键都有人读（见 `studio-config.ts` 的解析器接线处），
 * 不放进来的键仍然是全站同一份，只有老板能改（店长保存时会被直接拒绝，不会默默不生效）。
 *
 * 下一批准备按店拆的：`pool.*`（订单池等待时间 / 弹窗时长 / 抢单退回）、`capture.*`（截图阈值）、
 * `excellence.*`（评分与名额）、`attendance.*`（考勤时间）。
 */
export const STUDIO_SCOPED_KEYS = [
  // ── 分成（陪玩 / 工作室）──
  'revenue.share_tiers',            // 线下阶梯（陪玩比例，工作室 = 100 − 陪玩）
  'revenue.club_companion_share',   // 线上俱乐部固定比例（陪玩）
  'revenue.free_threshold',         // 免单线（流水达标免单/免娱乐费）
  'revenue.low_warning',            // 低流水预警线
  // ── 客服 / 店长提成 ──
  'commission.cs_offline_rate_percent',
  'commission.cs_offline_floor_cents',
  'commission.cs_offline_per_order_cap_cents',
  'commission.cs_online_per_order_yuan',
  'commission.cs_bridge_per_order_yuan',
  'commission.cs_bridge_min_threshold',
  'commission.cs_bridge_tier3_threshold',
  'commission.cs_bridge_tier5_threshold',
  'commission.cs_bridge_tier3_yuan',
  'commission.cs_bridge_tier5_yuan',
  'commission.cs_base_salary_yuan',
  'commission.cs_full_attendance_bonus_yuan',
  'commission.cs_early_leave_deduction_yuan',
  'commission.cs_daily_bridge_target',
  'commission.cs_bridge_miss_commission_rate',
  'commission.cs_bridge_miss_salary_rate',
  'commission.admin_offline_rate_percent',
  'commission.admin_online_rate_percent',
  // ── 桥接单价 ──
  'bridge.secret_price_yuan',
  'bridge.jueju_net_yuan',
  // ── 派单名额与桥接窗口 / 返款 ──
  'dispatch.top_tier_daily_new_limit',
  'dispatch.middle_tier_daily_new_limit',
  'dispatch.low_tier_daily_new_limit',
  // ── 娱乐计费 ──
  'entertainment.hourly_rate',
  'entertainment.revenue_threshold',
  'entertainment.deposit_threshold',
  // 注意（老板 2026-09-21）：下面这几个键**没有任何代码读它们**，
  // 放进来会变成「店长填了不生效」，所以故意不放：
  //   dispatch.bridge_immediate_window_sec / dispatch.bridge_return_jimi_cents / dispatch.bridge_return_jueju_cents
  //     （线上实际走的是 pool.bridge_return_*，见 finance/reconciliation.service.ts）
  //   commission.attribution_window（全库无读取点）
] as const;

const STUDIO_SCOPED_KEY_SET = new Set<string>(STUDIO_SCOPED_KEYS);

/** 这个键是不是「分店自己的」。 */
export function isStudioScopedKey(key: string): boolean {
  return STUDIO_SCOPED_KEY_SET.has(key);
}

/** 只保留分店能自己填的键；全站唯一的键混进来直接报错，避免店长改到全站配置。 */
export function assertStudioScopedKeys(keys: string[]): void {
  const bad = keys.filter((key) => !isStudioScopedKey(key));
  if (bad.length) {
    throw new BadRequestException(`这些配置全站只有一份，只有老板能改：${bad.join('、')}`);
  }
}
