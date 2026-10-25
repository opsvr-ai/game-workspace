// craftsman-ignore: TS001
import { BadRequestException } from '@nestjs/common';
import { DEFAULT_CONFIGS, isOwnerOnlyKey } from './default-config';

/**
 * 配置中心：**118 个配置键的类型化定义 + 唯一校验入口**。
 *
 * 为什么要有这个文件（老板 2026-09-21 定下「配置默认归分店、只有安全与稳定性归老板」之后）：
 *  1. `default-config.ts` 只有「键 → 默认值」和「哪些键归老板」，**没有类型**。
 *     前端设置页可以往任意键里塞任意东西（字符串塞进数字、`null` 塞进布尔），
 *     存进库里以后由各自的 `?? 兜底` 与 `Number()` 默默吞掉 —— 出了怪数字没人知道是谁写坏的。
 *  2. 设置页保存是**一条 PUT 带十几个键**，散落在 controller 里的业务校验（分成比例、
 *     评分满分）只管得到其中几个键。其余键怎么写进库都没人看。
 *
 * 这个文件做的事：
 *  - 一份 `as const` 的**键名常量表** `CONFIG_KEYS`（118 个，跟 `DEFAULT_CONFIGS` 逐字一致）；
 *  - 每个键一条 `ConfigDefinition`：默认值、值类型、作用域（`SYSTEM` 老板级 / `STUDIO` 店长级）、
 *    约束（数值范围 / 枚举 / 结构校验）、可选说明；
 *  - `assertValidConfigEntries()` —— **写入前唯一校验入口**：非法值直接 `BadRequestException`
 *    并点出是哪几个键，一个字节都不会落库（`settings.controller.ts` 保存 / `studio-config.ts` 写入都走它）；
 *  - `configDefault()` / `configScopeOf()` —— 读路径与界面标注共用同一份定义（默认值只有一处真源）。
 *
 * 几条硬规矩：
 *  - **键名、默认值一个字都不许改**（改了等于改线上行为）。本文件里的默认值必须与
 *    `default-config.ts` 的 `DEFAULT_CONFIGS` 完全一致，`config-center.test.ts` 会逐键比对；
 *    `traffic.play_guide` / 分成阶梯 / 档位表这类**大结构**的默认值直接引用 `DEFAULT_CONFIGS`，
 *    避免同一段长文案维护两份。
 *  - **作用域必须与 `isOwnerOnlyKey()` 判定一致**：`SYSTEM` = 老板专属（密钥 / 版本号 /
 *    服务器级参数 / 店长考勤），`STUDIO` = 店长可写本店覆盖。测试逐键比对，防止两套名单漂移。
 *  - **未知键不拦**：历史/未来可能存在不在这 118 个里的动态键（`cs.client.version.<uid>`、
 *    `counter.global_code`、`excellence.tier_changes` 等由服务端自己写的状态），
 *    沿用老行为直接放行 —— 这里只管「有定义」的键。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 一、键名常量表（as const）：与 default-config.ts 的 118 个键逐字一致
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG_KEYS = [
  'pool.popup_seconds',
  'ws.token_grace_hours',
  'ws.offline_grace_seconds',
  'revenue.free_threshold',
  'revenue.low_warning',
  'revenue.unlock_threshold',
  'revenue.share_tiers',
  'withdraw.advance_ratio',
  'withdraw.default_deposit',
  'withdraw.monthly_limit',
  'entertainment.revenue_threshold',
  'entertainment.deposit_threshold',
  'entertainment.hourly_rate',
  'options.contact_results',
  'options.finish_results',
  'options.fail_reasons',
  'traffic.account_types',
  'traffic.account_columns',
  'games',
  'ranks',
  'identity.app_code',
  'identity.app_key',
  'identity.app_secret',
  'turn.url',
  'turn.username',
  'turn.credential',
  'blacklist.enabled',
  'blacklist.companion_overrides',
  'agent.latest_version',
  'agent.latest_download_url',
  'ai.provider',
  'ai.deepseek_api_key',
  'ai.doubao_api_key',
  'ai.doubao_model',
  'ai.doubao_vision_model',
  'traffic.note_benchmarks',
  'traffic.play_guide',
  'traffic.risk_reasons',
  'capture.interval_min_minutes',
  'capture.interval_max_minutes',
  'capture.first_delay_min_minutes',
  'capture.first_delay_max_minutes',
  'capture.black_jpeg_kb',
  'capture.expected_per_hour',
  'capture.min_rate_percent',
  'capture.black_rate_max_percent',
  'attendance.companion.enabled',
  'attendance.workStart',
  'attendance.workEnd',
  'attendance.cs.enabled',
  'attendance.cs.workStart',
  'attendance.cs.workEnd',
  'attendance.manager.enabled',
  'attendance.manager.workStart',
  'attendance.manager.workEnd',
  'notification.sound',
  'notification.desktop',
  'notification.badge',
  'pool.unlock_revenue_enabled',
  'pool.unlock_revenue_threshold',
  'pool.success_rate_gate_enabled',
  'pool.success_rate_gate_threshold',
  'pool.priority_delay_seconds',
  'pool.bridge_delay_seconds',
  'pool.middle_delay_seconds',
  'pool.low_delay_seconds',
  'pool.online_delay_seconds',
  'pool.online_first_release_minutes',
  'pool.offline_first_bridge_minutes',
  'pool.immediate_disappear_minutes',
  'pool.scheduled_disappear_minutes',
  'pool.bridge_return_jueju_cents',
  'service.stale_session_hours',
  'service.auto_end_after_reminder_minutes',
  'service.end_buffer_minutes',
  'service.voice_reminder_text',
  'anomaly.revenue_drop_percent',
  'anomaly.hours_drop_percent',
  'anomaly.spend_drop_percent',
  'anomaly.price_tier_downgrade_enabled',
  'billing.report_diff_warning_yuan',
  'billing.cs_access',
  'studio.day_start_hour',
  'expense.monthly_items',
  'dispatch.top_tier_daily_new_limit',
  'dispatch.middle_tier_daily_new_limit',
  'dispatch.low_tier_daily_new_limit',
  'dispatch.break_even_hours',
  'excellence.excellent_threshold',
  'excellence.middle_tier_threshold',
  'excellence.revenue_floor',
  'excellence.battle_screenshot_bonus',
  'excellence.battle_screenshot_bonus_cap',
  'excellence.low_tier_auto_resign_days',
  'excellence.revenue_tiers',
  'excellence.renew_tiers',
  'excellence.repurchase_tiers',
  'excellence.first_success_tiers',
  'dispatch.bridge_return_jueju_cents',
  'bridge.secret_price_yuan',
  'bridge.jueju_net_yuan',
  'commission.cs_bridge_per_order_yuan',
  'commission.cs_base_salary_yuan',
  'dispatch.game_break_even_hours',
  'commission.cs_offline_rate_percent',
  'revenue.club_companion_share',
  'commission.cs_bridge_min_threshold',
  'commission.cs_bridge_tier3_threshold',
  'commission.cs_bridge_tier5_threshold',
  'commission.cs_bridge_tier3_yuan',
  'commission.cs_bridge_tier5_yuan',
  'commission.cs_full_attendance_bonus_yuan',
  'commission.cs_early_leave_deduction_yuan',
  'commission.cs_daily_bridge_target',
  'commission.admin_offline_rate_percent',
  'commission.admin_online_rate_percent',
  'commission.cs_offline_floor_cents',
  'commission.cs_online_per_order_yuan',
  'commission.cs_online_rate_percent',
  'commission.cs_online_mode',
  'commission.cs_include_renewal',
  'commission.cs_offline_per_order_cap_cents',
] as const;

/** 配置键联合类型（`'revenue.free_threshold' | …`，共 118 个）。 */
export type ConfigKey = (typeof CONFIG_KEYS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// 二、类型定义
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 配置归谁写：
 *  - `SYSTEM`：老板专属（密钥 / 一份值绑住全站 / 服务器级状态 / 店长考勤），店长写本店会被跳过；
 *  - `STUDIO`：店长可写本店覆盖（店长不写就跟随老板的全局默认）。
 *
 * 判定口径与 `default-config.ts` 的 `isOwnerOnlyKey()` **完全一致**（测试逐键比对）。
 */
export type ConfigScope = 'SYSTEM' | 'STUDIO';

/**
 * 值类型。基础类型之外，几个「结构型」配置单独给类型，好让校验器知道该查哪些字段：
 *  - `share_tiers`：分成阶梯 `{ min, max, studio, companion }[]`；
 *  - `score_tiers`：综合评分档位 `{ min, score }[]`；
 *  - `account_columns`：平台账号自定义列 `{ key, label, custom }[]`；
 *  - `note_benchmarks`：笔记数据基准（嵌套对象）；
 *  - `expense_items`：每月固定支出项 `{ id, name, amount }[]`；
 *  - `game_hours`：各游戏盈亏平衡时长 `{ game, hours }[]`；
 *  - `boolean_map`：`{ [id]: boolean }`（按人特批）；
 *  - `enum`：只允许 `enumValues` 里的值（大小写不敏感）。
 */
export type ConfigValueType =
  | 'number'
  | 'integer'
  | 'boolean'
  | 'string'
  | 'enum'
  | 'string[]'
  | 'object'
  | 'boolean_map'
  | 'share_tiers'
  | 'score_tiers'
  | 'account_columns'
  | 'note_benchmarks'
  | 'expense_items'
  | 'game_hours';

/** 单条配置的类型化定义。 */
export interface ConfigDefinition<T = any> {
  /** 键名（与 CONFIG_KEYS 一致） */
  readonly key: ConfigKey;
  /** 值类型 */
  readonly type: ConfigValueType;
  /** 归谁写 */
  readonly scope: ConfigScope;
  /** 内置默认值（与 `DEFAULT_CONFIGS[key]` 一致） */
  readonly default: T;
  /** 数值下限（含），仅 number / integer */
  readonly min?: number;
  /** 数值上限（含），仅 number / integer */
  readonly max?: number;
  /** 枚举可选值（大小写不敏感），仅 enum */
  readonly enumValues?: readonly string[];
  /** 字符串最大长度，仅 string */
  readonly maxLength?: number;
  /** 补充说明（给人看的，不参与校验） */
  readonly description?: string;
  /** 结构型配置的附加校验：返回错误文案，通过返回 null */
  readonly validate?: (value: any) => string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、轻量校验器（不引入 zod 等第三方依赖，手写就够）
// ─────────────────────────────────────────────────────────────────────────────

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isPlainObject = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** 分成阶梯：`{ min: number; max: number | null; studio: number; companion: number }[]` */
function validateShareTiers(value: any): string | null {
  if (!Array.isArray(value)) return '应为档位数组';
  if (!value.length) return '至少要有 1 档';
  for (let i = 0; i < value.length; i++) {
    const t = value[i];
    if (!isPlainObject(t)) return `第 ${i + 1} 档不是对象`;
    if (!isFiniteNumber(t.min)) return `第 ${i + 1} 档的 min 应为数字`;
    // 最上档的 max 允许 null / 不填（老数据里就有只写 min 的档位），只拦「类型不对」。
    if (!(t.max === null || t.max === undefined || isFiniteNumber(t.max))) {
      return `第 ${i + 1} 档的 max 应为数字或 null`;
    }
    if (!isFiniteNumber(t.companion)) return `第 ${i + 1} 档的 companion 应为数字`;
    if (!isFiniteNumber(t.studio)) return `第 ${i + 1} 档的 studio 应为数字`;
  }
  return null;
}

/** 评分档位：`{ min: number; score: number }[]` */
function validateScoreTiers(value: any): string | null {
  if (!Array.isArray(value)) return '应为档位数组';
  if (!value.length) return '至少要有 1 档';
  for (let i = 0; i < value.length; i++) {
    const t = value[i];
    if (!isPlainObject(t)) return `第 ${i + 1} 档不是对象`;
    if (!isFiniteNumber(t.min)) return `第 ${i + 1} 档的 min 应为数字`;
    if (!isFiniteNumber(t.score)) return `第 ${i + 1} 档的 score 应为数字`;
  }
  return null;
}

/** 平台账号自定义列：`{ key: string; label: string; custom: boolean }[]` */
function validateAccountColumns(value: any): string | null {
  if (!Array.isArray(value)) return '应为列定义数组';
  if (!value.length) return '至少要有 1 列';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (!isPlainObject(c)) return `第 ${i + 1} 列不是对象`;
    if (typeof c.key !== 'string' || !c.key) return `第 ${i + 1} 列的 key 应为非空字符串`;
    if (typeof c.label !== 'string') return `第 ${i + 1} 列的 label 应为字符串`;
    if (typeof c.custom !== 'boolean') return `第 ${i + 1} 列的 custom 应为布尔值`;
  }
  return null;
}

/** 笔记数据基准：`{ [指标]: { [档位]: number } }`（只查结构，不查具体档位名） */
function validateNoteBenchmarks(value: any): string | null {
  if (!isPlainObject(value)) return '应为对象';
  for (const [group, thresholds] of Object.entries(value)) {
    if (!isPlainObject(thresholds)) return `${group} 应为对象`;
    for (const [name, n] of Object.entries(thresholds as Record<string, any>)) {
      if (!isFiniteNumber(n)) return `${group}.${name} 应为数字`;
    }
  }
  return null;
}

/** 每月固定支出项：`{ id: string; name: string; amount: number }[]` */
function validateExpenseItems(value: any): string | null {
  if (!Array.isArray(value)) return '应为支出项数组';
  for (let i = 0; i < value.length; i++) {
    const it = value[i];
    if (!isPlainObject(it)) return `第 ${i + 1} 项不是对象`;
    if (typeof it.id !== 'string' || !it.id) return `第 ${i + 1} 项的 id 应为非空字符串`;
    if (typeof it.name !== 'string') return `第 ${i + 1} 项的 name 应为字符串`;
    if (!isFiniteNumber(it.amount)) return `第 ${i + 1} 项的 amount 应为数字`;
  }
  return null;
}

/** 各游戏盈亏平衡时长：`{ game: string; hours: number }[]`（game 允许空串：设置页可能刚加了一行还没填） */
function validateGameHours(value: any): string | null {
  if (!Array.isArray(value)) return '应为数组';
  for (let i = 0; i < value.length; i++) {
    const it = value[i];
    if (!isPlainObject(it)) return `第 ${i + 1} 项不是对象`;
    if (typeof it.game !== 'string') return `第 ${i + 1} 项的 game 应为字符串`;
    if (!isFiniteNumber(it.hours)) return `第 ${i + 1} 项的 hours 应为数字`;
  }
  return null;
}

/** 「按人特批」表：`{ [companionId]: boolean }` */
function validateBooleanMap(value: any): string | null {
  if (!isPlainObject(value)) return '应为对象（键 = 陪玩 id，值 = true/false）';
  for (const [id, flag] of Object.entries(value)) {
    if (typeof flag !== 'boolean') return `${id} 的值应为布尔值`;
  }
  return null;
}

/** 单个已定义键的值校验：通过返回 null，不通过返回原因。 */
export function configValueError(key: string, value: any): string | null {
  const def = getConfigDefinition(key);
  // 没定义过的键（动态键 / 服务端自己写的状态）沿用老行为：不拦。
  if (!def) return null;
  if (value === null) return '不能为 null';

  switch (def.type) {
    case 'number':
    case 'integer': {
      if (!isFiniteNumber(value)) return '应为数字';
      if (def.type === 'integer' && !Number.isInteger(value)) return '应为整数';
      if (def.min !== undefined && value < def.min) return `不能小于 ${def.min}`;
      if (def.max !== undefined && value > def.max) return `不能大于 ${def.max}`;
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') return '应为 true / false';
      break;
    case 'string':
      if (typeof value !== 'string') return '应为字符串';
      if (def.maxLength !== undefined && value.length > def.maxLength) {
        return `长度不能超过 ${def.maxLength}`;
      }
      break;
    case 'enum': {
      if (typeof value !== 'string') return '应为字符串';
      const allowed = def.enumValues || [];
      if (!allowed.some((v) => v.toUpperCase() === value.toUpperCase())) {
        return `只能是 ${allowed.join(' / ')}`;
      }
      break;
    }
    case 'string[]':
      if (!Array.isArray(value)) return '应为字符串数组';
      if (value.some((v) => typeof v !== 'string')) return '数组里每一项都应为字符串';
      break;
    case 'object':
      if (!isPlainObject(value)) return '应为对象';
      break;
    case 'boolean_map': {
      const err = validateBooleanMap(value);
      if (err) return err;
      break;
    }
    // 结构型：交给各配置自带的 validate（下面统一再跑一遍）
    case 'share_tiers':
    case 'score_tiers':
    case 'account_columns':
    case 'note_benchmarks':
    case 'expense_items':
    case 'game_hours':
      if (!Array.isArray(value) && def.type !== 'note_benchmarks') return '应为数组';
      if (def.type === 'note_benchmarks' && !isPlainObject(value)) return '应为对象';
      break;
  }

  if (def.validate) {
    const err = def.validate(value);
    if (err) return err;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、118 个键的类型化定义
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 键 → 定义。`as const satisfies Record<ConfigKey, ConfigDefinition>` 让 TypeScript
 * 在编译期就保证 **CONFIG_KEYS 与定义表一一对应**（少一个 / 多一个都编译不过）。
 *
 * 默认值：基础类型逐字写出（改动会被 `config-center.test.ts` 抓到），
 * 大结构（长文案、阶梯表、列定义）引用 `DEFAULT_CONFIGS`，避免同一段内容维护两份。
 */
const CONFIG_DEFINITIONS = {
  // ── 派单弹窗 / 连接宽限 ──
  'pool.popup_seconds': {
    type: 'integer',
    scope: 'STUDIO',
    default: 15,
    description: '新单弹窗停留秒数',
  },
  'ws.token_grace_hours': {
    type: 'integer',
    scope: 'SYSTEM',
    default: 168,
    description: 'WebSocket 令牌宽限期（小时），一份值绑住全站',
  },
  'ws.offline_grace_seconds': {
    type: 'integer',
    scope: 'SYSTEM',
    default: 60,
    description: '断开后多久才真正置离线（秒），服务器级判定',
  },

  // ── 业绩 / 支取 / 娱乐 ──
  'revenue.free_threshold': { type: 'integer', scope: 'STUDIO', default: 300, description: '业绩免费门槛' },
  'revenue.low_warning': { type: 'integer', scope: 'STUDIO', default: 300, description: '低业绩预警线' },
  'revenue.unlock_threshold': { type: 'integer', scope: 'STUDIO', default: 200, description: '业绩解锁门槛' },
  'revenue.share_tiers': {
    type: 'share_tiers',
    scope: 'STUDIO',
    default: DEFAULT_CONFIGS['revenue.share_tiers'],
    validate: validateShareTiers,
    description: '分润阶梯（工作室 / 陪玩）',
  },
  'withdraw.advance_ratio': { type: 'number', scope: 'STUDIO', default: 50, description: '预支比例（%）' },
  'withdraw.default_deposit': { type: 'number', scope: 'STUDIO', default: 500, description: '默认押金' },
  'withdraw.monthly_limit': { type: 'integer', scope: 'STUDIO', default: 2, description: '每月支取次数上限' },
  'entertainment.revenue_threshold': { type: 'number', scope: 'STUDIO', default: 200, description: '娱乐费免单业绩门槛' },
  'entertainment.deposit_threshold': { type: 'number', scope: 'STUDIO', default: 500, description: '娱乐费押金门槛' },
  'entertainment.hourly_rate': { type: 'number', scope: 'STUDIO', default: 60, description: '娱乐费时薪' },

  // ── 选项字典 ──
  'options.contact_results': {
    type: 'string[]',
    scope: 'STUDIO',
    default: ['现在玩', '改天玩', '未回消息', '好友未通过', '被客户删除'],
    description: '联系结果选项',
  },
  'options.finish_results': {
    type: 'string[]',
    scope: 'STUDIO',
    default: ['正常完成', '客户续单', '变声器退款', '技术差退款'],
    description: '完成结果选项',
  },
  'options.fail_reasons': {
    type: 'string[]',
    scope: 'STUDIO',
    default: ['抢单未加微信', '好友未通过', '客户不回消息', '客户删除', '客户说不打', '其他'],
    description: '失败原因选项',
  },

  // ── 引流账号 ──
  'traffic.account_types': {
    type: 'string[]',
    scope: 'STUDIO',
    default: ['抖音', '小红书', '视频号', '快手', '咸鱼', 'B站'],
    description: '平台账号类型',
  },
  'traffic.account_columns': {
    type: 'account_columns',
    scope: 'STUDIO',
    default: DEFAULT_CONFIGS['traffic.account_columns'],
    validate: validateAccountColumns,
    description: '平台账号自定义列',
  },
  games: {
    type: 'string[]',
    scope: 'STUDIO',
    default: ['英雄联盟', '王者荣耀', '无畏契约', 'CS2', 'DOTA2', '永劫无间', '绝地求生', 'Apex英雄'],
    description: '游戏列表',
  },
  ranks: {
    type: 'string[]',
    scope: 'STUDIO',
    default: ['青铜', '白银', '黄金', '铂金', '钻石', '大师', '宗师', '王者'],
    description: '段位列表',
  },

  // ── 密钥 / 凭据（只有老板能改）──
  'identity.app_code': { type: 'string', scope: 'SYSTEM', default: '', description: '实名认证 AppCode' },
  'identity.app_key': { type: 'string', scope: 'SYSTEM', default: '', description: '实名认证 AppKey' },
  'identity.app_secret': { type: 'string', scope: 'SYSTEM', default: '', description: '实名认证 AppSecret' },
  'turn.url': { type: 'string', scope: 'SYSTEM', default: '', description: 'TURN 语音服务器地址' },
  'turn.username': { type: 'string', scope: 'SYSTEM', default: '', description: 'TURN 用户名' },
  'turn.credential': { type: 'string', scope: 'SYSTEM', default: '', description: 'TURN 凭据' },

  // ── 进程黑名单（本店开关，店长自己拨）──
  'blacklist.enabled': {
    type: 'boolean',
    scope: 'STUDIO',
    default: false,
    description: '本店黑名单是否生效（唯一杀进程开关，店长自己拨）',
  },
  'blacklist.companion_overrides': {
    type: 'boolean_map',
    scope: 'STUDIO',
    default: {},
    description: '按人特批（键 = 陪玩 id，值 = 是否单独生效）',
  },

  // ── 客户端版本（一份值绑住全站）──
  'agent.latest_version': { type: 'string', scope: 'SYSTEM', default: '1.0.0', description: '陪玩端客户端最新版本' },
  'agent.latest_download_url': {
    type: 'string',
    scope: 'SYSTEM',
    default: '/uploads/chunlv-latest.zip',
    description: '陪玩端客户端下载地址',
  },

  // ── AI ──
  'ai.provider': { type: 'string', scope: 'SYSTEM', default: 'doubao', description: 'AI 供应商' },
  'ai.deepseek_api_key': { type: 'string', scope: 'SYSTEM', default: '', description: 'DeepSeek API Key' },
  'ai.doubao_api_key': { type: 'string', scope: 'SYSTEM', default: '', description: '豆包 API Key' },
  'ai.doubao_model': { type: 'string', scope: 'SYSTEM', default: 'doubao-pro-32k', description: '豆包文本模型' },
  'ai.doubao_vision_model': {
    type: 'string',
    scope: 'SYSTEM',
    default: 'Doubao-1.5-vision-pro',
    description: '豆包视觉模型',
  },
  'traffic.note_benchmarks': {
    type: 'note_benchmarks',
    scope: 'STUDIO',
    default: DEFAULT_CONFIGS['traffic.note_benchmarks'],
    validate: validateNoteBenchmarks,
    description: '小红书笔记数据基准',
  },
  'traffic.play_guide': {
    type: 'string',
    scope: 'STUDIO',
    default: DEFAULT_CONFIGS['traffic.play_guide'],
    description: '小红书图文矩阵玩法（长文案）',
  },
  'traffic.risk_reasons': {
    type: 'string[]',
    scope: 'STUDIO',
    default: DEFAULT_CONFIGS['traffic.risk_reasons'],
    description: '账号风险原因下拉选项',
  },

  // ── 截图（会话监拍）──
  'capture.interval_min_minutes': { type: 'integer', scope: 'STUDIO', default: 12, description: '截图最小间隔（分钟）' },
  'capture.interval_max_minutes': { type: 'integer', scope: 'STUDIO', default: 18, description: '截图最大间隔（分钟）' },
  'capture.first_delay_min_minutes': { type: 'integer', scope: 'STUDIO', default: 1, description: '首张截图最小延迟' },
  'capture.first_delay_max_minutes': { type: 'integer', scope: 'STUDIO', default: 3, description: '首张截图最大延迟' },
  'capture.black_jpeg_kb': { type: 'integer', scope: 'STUDIO', default: 15, description: '黑屏图判定大小（KB）' },
  'capture.expected_per_hour': { type: 'integer', scope: 'STUDIO', default: 4, description: '每小时预期截图数' },
  'capture.min_rate_percent': { type: 'integer', scope: 'STUDIO', default: 50, description: '截图达标率下限（%）' },
  'capture.black_rate_max_percent': { type: 'integer', scope: 'STUDIO', default: 30, description: '黑屏率上限（%）' },

  // ── 考勤（店长考勤只有老板能改）──
  'attendance.companion.enabled': { type: 'boolean', scope: 'STUDIO', default: false, description: '陪玩是否开考勤' },
  'attendance.workStart': { type: 'string', scope: 'STUDIO', default: '09:00', description: '陪玩上班时间' },
  'attendance.workEnd': { type: 'string', scope: 'STUDIO', default: '18:00', description: '陪玩下班时间' },
  'attendance.cs.enabled': { type: 'boolean', scope: 'STUDIO', default: true, description: '客服是否开考勤' },
  'attendance.cs.workStart': { type: 'string', scope: 'STUDIO', default: '09:00', description: '客服上班时间' },
  'attendance.cs.workEnd': { type: 'string', scope: 'STUDIO', default: '18:00', description: '客服下班时间' },
  'attendance.manager.enabled': { type: 'boolean', scope: 'SYSTEM', default: true, description: '店长是否开考勤（老板专属）' },
  'attendance.manager.workStart': { type: 'string', scope: 'SYSTEM', default: '09:00', description: '店长上班时间（老板专属）' },
  'attendance.manager.workEnd': { type: 'string', scope: 'SYSTEM', default: '18:00', description: '店长下班时间（老板专属）' },

  // ── 通知偏好 ──
  'notification.sound': { type: 'boolean', scope: 'STUDIO', default: true, description: '新消息声音提醒' },
  'notification.desktop': { type: 'boolean', scope: 'STUDIO', default: true, description: '桌面通知' },
  'notification.badge': { type: 'boolean', scope: 'STUDIO', default: true, description: '角标提醒' },

  // ── 抢单池 / 派单节奏 ──
  'pool.unlock_revenue_enabled': { type: 'boolean', scope: 'STUDIO', default: true, description: '业绩解锁开关' },
  'pool.unlock_revenue_threshold': { type: 'integer', scope: 'STUDIO', default: 200, description: '业绩解锁门槛' },
  'pool.success_rate_gate_enabled': { type: 'boolean', scope: 'STUDIO', default: true, description: '成功率门槛开关' },
  'pool.success_rate_gate_threshold': { type: 'integer', scope: 'STUDIO', default: 90, description: '成功率门槛（%）' },
  'pool.priority_delay_seconds': { type: 'integer', scope: 'STUDIO', default: 0, description: '优先级延迟（秒）' },
  'pool.bridge_delay_seconds': { type: 'integer', scope: 'STUDIO', default: 30, description: '桥接延迟（秒）' },
  'pool.middle_delay_seconds': { type: 'integer', scope: 'STUDIO', default: 60, description: '中等马延迟（秒）' },
  'pool.low_delay_seconds': { type: 'integer', scope: 'STUDIO', default: 120, description: '下等马延迟（秒）' },
  'pool.online_delay_seconds': { type: 'integer', scope: 'STUDIO', default: 180, description: '线上延迟（秒）' },
  'pool.online_first_release_minutes': {
    type: 'integer',
    scope: 'STUDIO',
    default: 5,
    description: '线上→线下流转单先给线上几分钟',
  },
  'pool.offline_first_bridge_minutes': {
    type: 'integer',
    scope: 'STUDIO',
    default: 3,
    description: '线下→线上流转单本店线下先抢几分钟',
  },
  'pool.immediate_disappear_minutes': {
    type: 'integer',
    scope: 'STUDIO',
    default: 10,
    description: '立即单多少分钟后消失',
  },
  'pool.scheduled_disappear_minutes': {
    type: 'integer',
    scope: 'STUDIO',
    default: 60,
    description: '预约单多少分钟后消失',
  },
  'pool.bridge_return_jueju_cents': {
    type: 'integer',
    scope: 'STUDIO',
    default: 1500,
    description: '绝密单线上返款（分/小时）',
  },
  'service.stale_session_hours': {
    type: 'integer',
    scope: 'SYSTEM',
    default: 24,
    description: '服务中会话自动清理小时数（服务器级兜底）',
  },
  'service.auto_end_after_reminder_minutes': {
    type: 'integer',
    scope: 'STUDIO',
    default: 20,
    min: 1,
    max: 180,
    description: '到点提醒后多少分钟仍未处理就自动结束',
  },
  'service.end_buffer_minutes': {
    type: 'integer',
    scope: 'STUDIO',
    default: 3,
    min: 0,
    max: 30,
    description: '结束服务后保持接单中、留多久给陪玩切模式',
  },
  'service.voice_reminder_text': {
    type: 'string',
    scope: 'STUDIO',
    default: '服务时间到了，请结束服务',
    description: '到点语音提醒的播报内容',
  },

  // ── 异常预警 / 报账 / 营业日 ──
  'anomaly.revenue_drop_percent': { type: 'integer', scope: 'STUDIO', default: 50, description: '业绩下滑预警（%）' },
  'anomaly.hours_drop_percent': { type: 'integer', scope: 'STUDIO', default: 50, description: '时长下滑预警（%）' },
  'anomaly.spend_drop_percent': { type: 'integer', scope: 'STUDIO', default: 50, description: '消费下滑预警（%）' },
  'anomaly.price_tier_downgrade_enabled': { type: 'boolean', scope: 'STUDIO', default: true, description: '单价档位降级预警' },
  'billing.report_diff_warning_yuan': { type: 'number', scope: 'STUDIO', default: 10, description: '报账差额预警（元）' },
  'billing.cs_access': { type: 'boolean', scope: 'STUDIO', default: true, description: '客服是否可进报账' },
  'studio.day_start_hour': { type: 'integer', scope: 'STUDIO', default: 12, description: '营业日起点（点）' },
  'expense.monthly_items': {
    type: 'expense_items',
    scope: 'STUDIO',
    default: DEFAULT_CONFIGS['expense.monthly_items'],
    validate: validateExpenseItems,
    description: '每月固定支出项',
  },

  // ── 派单名额 / 盈亏平衡 ──
  'dispatch.top_tier_daily_new_limit': { type: 'integer', scope: 'STUDIO', default: 999, description: '上等马每日新单上限' },
  'dispatch.middle_tier_daily_new_limit': { type: 'integer', scope: 'STUDIO', default: 2, description: '中等马每日新单上限' },
  'dispatch.low_tier_daily_new_limit': { type: 'integer', scope: 'STUDIO', default: 1, description: '下等马每日新单上限' },
  'dispatch.break_even_hours': { type: 'number', scope: 'STUDIO', default: 2.5, description: '盈亏平衡时长（小时）' },
  'dispatch.bridge_return_jueju_cents': { type: 'integer', scope: 'STUDIO', default: 1500, description: '桥接首单绝密返还（分/小时）' },
  'dispatch.game_break_even_hours': {
    type: 'game_hours',
    scope: 'STUDIO',
    default: DEFAULT_CONFIGS['dispatch.game_break_even_hours'],
    validate: validateGameHours,
    description: '各游戏盈亏平衡时长',
  },

  // ── 综合评分（优秀度）──
  'excellence.excellent_threshold': { type: 'integer', scope: 'STUDIO', default: 85, description: '上等马分数线' },
  'excellence.middle_tier_threshold': { type: 'integer', scope: 'STUDIO', default: 60, description: '中等马分数线' },
  'excellence.revenue_floor': { type: 'number', scope: 'STUDIO', default: 5200, description: '最近 30 天业绩硬门槛' },
  'excellence.battle_screenshot_bonus': { type: 'number', scope: 'STUDIO', default: 1, description: '每张战绩图加分' },
  'excellence.battle_screenshot_bonus_cap': { type: 'integer', scope: 'STUDIO', default: 10, description: '战绩图加分上限' },
  'excellence.low_tier_auto_resign_days': { type: 'integer', scope: 'STUDIO', default: 0, description: '末位淘汰连续天数' },
  'excellence.revenue_tiers': {
    type: 'score_tiers',
    scope: 'STUDIO',
    default: DEFAULT_CONFIGS['excellence.revenue_tiers'],
    validate: validateScoreTiers,
    description: '业绩档位分',
  },
  'excellence.renew_tiers': {
    type: 'score_tiers',
    scope: 'STUDIO',
    default: DEFAULT_CONFIGS['excellence.renew_tiers'],
    validate: validateScoreTiers,
    description: '续单率档位分',
  },
  'excellence.repurchase_tiers': {
    type: 'score_tiers',
    scope: 'STUDIO',
    default: DEFAULT_CONFIGS['excellence.repurchase_tiers'],
    validate: validateScoreTiers,
    description: '复购率档位分',
  },
  'excellence.first_success_tiers': {
    type: 'score_tiers',
    scope: 'STUDIO',
    default: DEFAULT_CONFIGS['excellence.first_success_tiers'],
    validate: validateScoreTiers,
    description: '首单成功率档位分',
  },

  // ── 桥接价格 ──
  'bridge.secret_price_yuan': { type: 'number', scope: 'STUDIO', default: 35, description: '机密单价格（元）' },
  'bridge.jueju_net_yuan': { type: 'number', scope: 'STUDIO', default: 30, description: '绝密单到手价（元）' },

  // ── 客服 / 店长提成 ──
  'commission.cs_bridge_per_order_yuan': { type: 'number', scope: 'STUDIO', default: 1, description: '桥接单每单提成（元）' },
  'commission.cs_base_salary_yuan': { type: 'number', scope: 'STUDIO', default: 0, description: '客服底薪（元）' },
  'commission.cs_offline_rate_percent': { type: 'number', scope: 'STUDIO', default: 1, description: '客服线下提成（%）' },
  'revenue.club_companion_share': { type: 'number', scope: 'STUDIO', default: 80, description: '线上俱乐部陪玩分成（%）' },
  'commission.cs_bridge_min_threshold': { type: 'number', scope: 'STUDIO', default: 130, description: '桥接单量最低档门槛' },
  'commission.cs_bridge_tier3_threshold': { type: 'number', scope: 'STUDIO', default: 182, description: '桥接三档门槛' },
  'commission.cs_bridge_tier5_threshold': { type: 'number', scope: 'STUDIO', default: 260, description: '桥接五档门槛' },
  'commission.cs_bridge_tier3_yuan': { type: 'number', scope: 'STUDIO', default: 3, description: '桥接三档单价（元）' },
  'commission.cs_bridge_tier5_yuan': { type: 'number', scope: 'STUDIO', default: 5, description: '桥接五档单价（元）' },
  'commission.cs_full_attendance_bonus_yuan': { type: 'number', scope: 'STUDIO', default: 0, description: '客服全勤奖（元）' },
  'commission.cs_early_leave_deduction_yuan': { type: 'number', scope: 'STUDIO', default: 0, description: '客服早退扣款（元）' },
  'commission.cs_daily_bridge_target': { type: 'integer', scope: 'STUDIO', default: 10, description: '客服每日桥接目标单量' },
  'commission.admin_offline_rate_percent': { type: 'number', scope: 'STUDIO', default: 0, description: '店长线下分成（%）' },
  'commission.admin_online_rate_percent': { type: 'number', scope: 'STUDIO', default: 0, description: '店长线上分成（%）' },
  'commission.cs_offline_floor_cents': { type: 'number', scope: 'STUDIO', default: 200, description: '客服线下单保底（分）' },
  'commission.cs_online_per_order_yuan': { type: 'number', scope: 'STUDIO', default: 1, description: '线上按单提成（元）' },
  'commission.cs_online_rate_percent': { type: 'number', scope: 'STUDIO', default: 1, description: '线上按业绩提成（%）' },
  'commission.cs_online_mode': {
    type: 'enum',
    scope: 'STUDIO',
    default: 'RATE',
    enumValues: ['RATE', 'PER_ORDER'],
    description: '线上客服提成口径：按业绩比例 / 按单量',
  },
  'commission.cs_include_renewal': {
    type: 'boolean',
    scope: 'STUDIO',
    default: false,
    description: '客服提成是否算续单 / 复购 / 打赏',
  },
  'commission.cs_offline_per_order_cap_cents': {
    type: 'number',
    scope: 'STUDIO',
    default: 0,
    description: '客服线下每单提成上限（分，0 = 不封顶）',
  },
} as const satisfies Record<ConfigKey, Omit<ConfigDefinition, 'key'>>;

// ─────────────────────────────────────────────────────────────────────────────
// 五、对外查询 / 校验入口
// ─────────────────────────────────────────────────────────────────────────────

type DefinitionTable = typeof CONFIG_DEFINITIONS;

export const CONFIG_KEY_NAMES: readonly ConfigKey[] = CONFIG_KEYS;

const DEFINITION_MAP: Record<string, ConfigDefinition> = Object.fromEntries(
  CONFIG_KEYS.map((key) => [key, { key, ...CONFIG_DEFINITIONS[key] } as ConfigDefinition]),
);

/** 这个键有没有类型化定义（118 个键之外的一律 false）。 */
export function isKnownConfigKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEFINITION_MAP, key);
}

/** 取一个键的定义；未定义的动态键返回 undefined。 */
export function getConfigDefinition(key: string): ConfigDefinition | undefined {
  return DEFINITION_MAP[key];
}

/**
 * 键的生效默认值。
 *
 * 已定义键 = 类型化定义里的默认值（与 `DEFAULT_CONFIGS[key]` 一致，测试逐键比对）；
 * 未定义的动态键退回 `DEFAULT_CONFIGS`，保持老读法完全兼容。
 */
export function configDefault(key: string): any {
  const def = DEFINITION_MAP[key];
  if (def) return def.default;
  return DEFAULT_CONFIGS[key];
}

/** 这个键归谁写（未定义的动态键：按老规矩「不是老板专属就是分店的」）。 */
export function configScopeOf(key: string): ConfigScope {
  const def = DEFINITION_MAP[key];
  if (def) return def.scope;
  return isOwnerOnlyKey(key) ? 'SYSTEM' : 'STUDIO';
}

/** 这个键店长能不能写本店覆盖（与 `isStudioScopedKey()` 同口径）。 */
export function isStudioWritableConfigKey(key: string): boolean {
  return configScopeOf(key) === 'STUDIO';
}

/**
 * **写入前的唯一值校验入口**。
 *
 * - 只校验「有定义」的键；未知动态键放行（沿用老行为）；
 * - 值不合法 → `BadRequestException`，消息里点出所有出问题的**键名与原因**；
 * - 一次保存里只要有任何一个键不合法，**整次不落库**（不是跳过坏的存好的）：
 *   设置页一次 PUT 带十几个键，部分落库会让人以为「保存成功了」，反而更难查。
 */
export function assertValidConfigEntries(entries: Record<string, any>): void {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(entries || {})) {
    if (value === undefined) continue;
    const reason = configValueError(key, value);
    if (reason) problems.push(`${key}（${reason}）`);
  }
  if (problems.length) {
    throw new BadRequestException(`以下配置的值不合法，本次没有保存：${problems.join('；')}`);
  }
}

/**
 * 作用域校验：`STUDIO` 作用域里不许写 `SYSTEM` 键（老板专属的密钥 / 版本号 / 店长考勤）。
 *
 * 返回被拒绝的键；`throwOnError` 为 true 时直接抛 `BadRequestException`（点出键名）。
 * 注：老代码用 `default-config.assertStudioScopedKeys()` 做同一件事，这里只是把
 * 「类型化定义里的 scope」也纳入同一个入口，两套名单由测试保证不漂移。
 */
export function studioScopeViolations(entries: Record<string, any>): string[] {
  return Object.keys(entries || {}).filter(
    (key) => entries[key] !== undefined && !isStudioWritableConfigKey(key),
  );
}

/** 作用域校验（抛异常版）。 */
export function assertStudioWritableEntries(entries: Record<string, any>): void {
  const bad = studioScopeViolations(entries);
  if (bad.length) {
    throw new BadRequestException(
      `这些配置影响数据安全与稳定性，只有老板能改：${bad.join('、')}`,
    );
  }
}

/**
 * 页面读到的键集合与类型定义的交叉检查（测试 / 诊断用）：
 * 返回「在 DEFAULT_CONFIGS 里但没定义」「定义了但不在 DEFAULT_CONFIGS 里」两组键。
 */
export function configDefinitionDrift(): { missingDefinitions: string[]; extraDefinitions: string[] } {
  const defined = new Set<string>(CONFIG_KEYS);
  const actual = Object.keys(DEFAULT_CONFIGS);
  const actualSet = new Set(actual);
  return {
    missingDefinitions: actual.filter((key) => !defined.has(key)),
    extraDefinitions: [...defined].filter((key) => !actualSet.has(key)),
  };
}

/** 类型表（给测试 / 工具遍历用，避免直接引用私有常量）。 */
export function allConfigDefinitions(): ConfigDefinition[] {
  return CONFIG_KEYS.map((key) => DEFINITION_MAP[key]);
}

/** `DefinitionTable` 导出给类型层用（避免 TS 把私有常量报 unused）。 */
export type ConfigDefinitionTable = DefinitionTable;
