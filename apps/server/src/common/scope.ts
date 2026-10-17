// craftsman-ignore: TS001
import { ForbiddenException } from '@nestjs/common';

/**
 * 统一作用域（ScopeContext）——**平台唯一的作用域判定入口**。
 *
 * 为什么要有它：
 *   全站「这条数据该给谁看」的判定原本散在每个 service 里各写一遍：
 *   `studioId ? { studioId } : {}`、`user.role !== 'OWNER'`、`if (!user.studioId) return []`、
 *   `studioId: { in: [own, ...bridged] }`……同一个意思有十几种写法，多写一个 `!` 就是一次越权或一次空看板。
 *   老板 2026-10-04 报的「全站老板点排行榜直接 500」就是其中一种（`in: [null]`）。
 *
 * 口径（老板 2026-09-21 / 2026-10-04 拍板，**改之前先问**）：
 *  1. **老板（OWNER）**：全站，不加店铺过滤；
 *  2. **店长（ADMIN）/ 客服（CS）**：本店；带桥接关系时可以看到**桥接工作室**（方便派单 / 邀请）；
 *  3. **陪玩（COMPANION）**：只看自己（`companionId = 我`），本店同事的数据也不给；
 *  4. **没挂工作室的店长 / 客服**：宁可给空，也绝不能因为 `studioId` 为空把全站漏出去。
 *
 * 这些函数是**纯函数**：不查库、不读环境变量、不碰 Prisma 实例，方便单测与复用。
 * 桥接关系仍由调用方通过 `BridgeService.getBridgedStudioIds()` 查好再传进来
 * （原因：桥接表有缓存与权限函数，作用域层不该反向依赖 studios 模块）。
 *
 * 兼容说明：`scopeWhere()` 产出的 where 片段与老代码**逐字等价**，包括：
 *  - 单店时是裸字符串 `{ studioId: 's1' }`（不是 `{ in: [...] }`）；
 *  - 传了 `bridgedIds` 时保持 `{ studioId: { in: [本店, ...桥接] } }` 的形状；
 *  - 店长 / 客服没有 `studioId` 时是 `{ studioId: null }`（跟老代码 `where.studioId = user.studioId` 一致）。
 */

// ─────────────────────────────────────────────────────────────────────────────
// 一、Actor：一次请求「我是谁」
// ─────────────────────────────────────────────────────────────────────────────

export type ActorRole = 'OWNER' | 'ADMIN' | 'CS' | 'COMPANION';

/**
 * 当前操作者。
 *
 * - `id`：用户 id（客服「只看自己经手的单」之类需要）；
 * - `role`：角色；`null` / `undefined` 表示匿名 —— **按最保守处理**（不是老板）；
 * - `studioId`：所属工作室；老板 / 没挂店的账号是 `null`；
 * - `companionId`：陪玩档案 id（只有陪玩有；**故意保留 `undefined` 与 `null` 的区别**：
 *   `undefined` = 这个账号压根没有陪玩档案，老代码 `where.companionId = undefined` 会被 Prisma 忽略，
 *   而 `null` = 明确只看「未分配」的数据，两者不能混）。
 */
export interface Actor {
  readonly id: string;
  readonly role: ActorRole | string | null | undefined;
  readonly studioId: string | null;
  readonly companionId?: string | null;
}

/** 作用域选项。 */
export interface ScopeOptions {
  /** 店铺外键字段名，默认 `'studioId'`（订单 / 客户 / 陪玩表都是它）。 */
  readonly field?: string;
  /**
   * 桥接工作室 id（`BridgeService.getBridgedStudioIds()` 的结果）。
   *
   * - **不传 / `undefined`**：只看本店，`scopeWhere` 产出裸值 `{ studioId: 's1' }`；
   * - **传了（含空数组）**：本店 + 桥接店，产出 `{ studioId: { in: [...] } }`
   *   —— 跟老代码 `{ in: [user.studioId, ...bridgedIds] }` 的形状一致，行为等价。
   * - 老板忽略它（老板本来就看全站）。
   */
  readonly bridgedIds?: readonly string[] | null;
  /**
   * 陪玩「只看自己」时用的外键字段（例如 `'companionId'`）。
   *
   * 传了它，陪玩角色会得到 `{ [ownField]: actor.companionId }`（**不再加店铺过滤**，
   * 跟老代码「陪玩只看自己的客户 / 自己的单」一致）；店长 / 客服 / 老板不受影响。
   */
  readonly ownField?: string | null;
}

export interface StudioAccessOptions {
  /** 允许访问的桥接工作室 id（传了才算「桥接店可访问」）。 */
  readonly bridgedIds?: readonly string[] | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、从请求 / 老签名构造 Actor
// ─────────────────────────────────────────────────────────────────────────────

/** 从 `req.user`（JWT payload）构造 Actor；`user` 为空时得到「匿名、无店」的最保守 actor。 */
export function actorOfUser(user: any | null | undefined): Actor {
  return {
    id: (user?.id as string) || '',
    role: (user?.role as ActorRole | string | null | undefined) ?? null,
    studioId: (user?.studioId as string | null | undefined) ?? null,
    // 保留 undefined（见 Actor.companionId 的说明），不要 `?? null`
    companionId: user?.companionId as string | null | undefined,
  };
}

/**
 * 从「只有一个 studioId」的老签名构造 Actor（迁移期用）。
 *
 * **为什么 `null` 映射成 OWNER**：老代码里 `studioId ? { studioId } : {}` 这个写法中，
 * `null` 的含义就是「不加店铺过滤 = 全站」，只有老板会走到这里（店长 / 客服都有店）。
 * 换成 scope 之后仍按这个老口径走，保证看板 / 统计的数字**一个都不变**；
 * 有新代码要区分「老板」与「没挂店的店长」时，请用 `actorOfUser(user)` 而不是这个。
 */
export function actorOfStudio(
  studioId: string | null | undefined,
  role: ActorRole | string = studioId ? 'ADMIN' : 'OWNER',
): Actor {
  return {
    id: '',
    role,
    studioId: studioId || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、作用域纯函数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 这个 actor 能看到的工作室 id 列表。
 *
 * - 老板（或 actor 为空）→ `null`，表示**全站、不加过滤**；
 * - 其余角色 → `[本店, ...桥接店]`（去重、保序；本店为空时只留桥接店，可能为空数组）。
 *
 * 注意：陪玩也走这条（实时看板要能看到桥接工作室的人，方便被邀请），
 * 陪玩「只看自己」的收敛由 `scopeWhere(actor, { ownField })` 或业务层自己处理。
 */
export function visibleStudioIds(
  actor: Actor | null | undefined,
  bridgedIds: readonly string[] | null | undefined = null,
): string[] | null {
  if (!actor || actor.role === 'OWNER') return null;
  const out: string[] = [];
  const push = (id: string | null | undefined) => {
    if (id && !out.includes(id)) out.push(id);
  };
  push(actor.studioId);
  for (const id of bridgedIds || []) push(id);
  return out;
}

/**
 * 生成 Prisma `where` 的店铺作用域片段（**行为等价替换** `studioId ? { studioId } : {}` 等写法）。
 *
 * 返回：
 * | actor | 返回 |
 * | --- | --- |
 * | 老板 | `{}`（全站） |
 * | 陪玩 + `opts.ownField` | `{ [ownField]: companionId }`（只看自己） |
 * | 店长 / 客服 / 陪玩（带店） | `{ studioId: '本店' }` 或 `{ studioId: { in: [...] } }` |
 * | 店长 / 客服（没挂店） | `{ studioId: null }` —— 跟老代码一样，一条都不多给 |
 *
 * `actor` 为 `null` 时返回 `{}`：仅用于明确「没有身份 = 旧逻辑不加过滤」的老调用点
 * （例如某些内部统计方法的 `studioId` 可空），**新的读写路径不要传 null**。
 */
export function scopeWhere(
  actor: Actor | null | undefined,
  opts: ScopeOptions = {},
): Record<string, any> {
  if (!actor) return {};
  if (actor.role === 'OWNER') return {};
  if (opts.ownField && actor.role === 'COMPANION') {
    // 陪玩：只看自己（老代码 `where.companionId = user.companionId`，未挂档案时是 undefined）
    return { [opts.ownField]: actor.companionId };
  }

  const field = opts.field || 'studioId';
  const ids = visibleStudioIds(actor, opts.bridgedIds) || [];
  // 桥接模式：保持老代码 `{ in: [本店, ...桥接] }` 的形状（哪怕只有本店一个）
  if (opts.bridgedIds !== undefined && opts.bridgedIds !== null) {
    return { [field]: { in: ids } };
  }
  if (!ids.length) return { [field]: null };
  if (ids.length === 1) return { [field]: ids[0] };
  return { [field]: { in: ids } };
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、访问断言（写路径 / 单条数据详情用）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 这个 actor 能不能访问某家工作室的数据。
 *
 * 老板恒为 true；店长 / 客服 / 陪玩只能访问本店；传了 `bridgedIds` 时桥接店也算。
 * 目标工作室为空 / 不存在 → false（宁可拒绝，也不要「空 id 等于全站」）。
 */
export function canAccessStudio(
  actor: Actor | null | undefined,
  targetStudioId: string | null | undefined,
  opts: StudioAccessOptions = {},
): boolean {
  if (!targetStudioId) return false;
  if (!actor) return false;
  if (actor.role === 'OWNER') return true;
  if (actor.studioId && actor.studioId === targetStudioId) return true;
  const bridged = opts.bridgedIds || [];
  return bridged.some((id) => id === targetStudioId);
}

/**
 * 访问断言：不允许就抛 `ForbiddenException`（Nest 会变成 403）。
 *
 * 错误消息只带「当前账号的工作室」，不泄露目标数据的其他信息。
 */
export function assertStudioAccess(
  actor: Actor | null | undefined,
  targetStudioId: string | null | undefined,
  opts: StudioAccessOptions = {},
): void {
  if (canAccessStudio(actor, targetStudioId, opts)) return;
  if (!targetStudioId) {
    throw new ForbiddenException('缺少工作室信息，无法判断这条数据属于谁');
  }
  if (!actor) {
    throw new ForbiddenException('未登录，无法访问该工作室的数据');
  }
  throw new ForbiddenException(
    `无权访问该工作室的数据（当前工作室：${actor.studioId || '未绑定'}）`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 五、小工具
// ─────────────────────────────────────────────────────────────────────────────

/** 是不是全站角色（老板）。 */
export function isAllStudiosActor(actor: Actor | null | undefined): boolean {
  return !!actor && actor.role === 'OWNER';
}

/** 这个 actor 是不是陪玩。 */
export function isCompanionActor(actor: Actor | null | undefined): boolean {
  return !!actor && actor.role === 'COMPANION';
}

/**
 * 陪玩「只看自己」的 where 片段（不传 ownField 时的便捷写法）。
 * 非陪玩返回 `{}`（调用方应同时用 `scopeWhere` 限店）。
 */
export function selfWhere(actor: Actor | null | undefined, field = 'companionId'): Record<string, any> {
  if (!isCompanionActor(actor)) return {};
  return { [field]: actor!.companionId };
}

/**
 * 把 where 片段的店铺条件改写到别的字段（例如 `companion.studioId`）。
 * 仅做键名替换，不改判定逻辑。
 */
export function remapScopeField(where: Record<string, any>, field: string, toField: string): Record<string, any> {
  if (!(field in where)) return where;
  const { [field]: value, ...rest } = where;
  return { ...rest, [toField]: value };
}
