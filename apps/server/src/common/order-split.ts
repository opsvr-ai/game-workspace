import { BadRequestException } from '@nestjs/common';

/**
 * 一单流水的「四个人分成」口径（老板 2026-09-21 拍板）：
 *
 * > 不管线下工作室还是线上俱乐部，流水有 **工作室、店长、客服、陪玩** 这四个人分。
 *
 * 规则：
 * - **陪玩**：线下按阶梯（`revenue.share_tiers`）、线上按固定比例（`revenue.club_companion_share`），
 *   这一栏是**已经生效的口径**，本函数只接收、不改写；
 * - **客服 / 店长**：按流水比例（`commission.cs_offline_rate_percent`、
 *   `commission.admin_offline_rate_percent` / `commission.admin_online_rate_percent`）；
 * - **工作室**：拿**剩下的**（100% − 陪玩 − 客服 − 店长），所以四个人加起来永远是 100%；
 * - 三者加起来超过 100% 直接报错，不允许保存。
 *
 * 线上俱乐部目前给客服的是「每单固定金额」（元/单），那部分金额从工作室那份里出，
 * 所以线上调用时 `cs` 传 0，金额在 `commission.service.ts` 里另算。
 */

export interface RoleSplitInput {
  companion: number;
  cs?: number;
  admin?: number;
}

export interface RoleSplitResult {
  companion: number;
  cs: number;
  admin: number;
  studio: number;
}

/** 比例必须落在 0-100，且必须是数字。 */
export function parsePercent(value: unknown, label: string): number {
  // 没填（null / undefined / 空字符串）一律当 0，等于「这一项不参与分成」。
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    throw new BadRequestException(`${label}必须在 0-100 之间`);
  }
  return Math.round(n * 100) / 100;
}

/** 四人口径：工作室 = 100 - 陪玩 - 客服 - 店长。 */
export function splitRoles(input: RoleSplitInput): RoleSplitResult {
  const companion = parsePercent(input.companion, '陪玩分成比例');
  const cs = parsePercent(input.cs ?? 0, '客服分成比例');
  const admin = parsePercent(input.admin ?? 0, '店长分成比例');
  const used = Math.round((companion + cs + admin) * 100) / 100;
  if (used > 100) {
    throw new BadRequestException(
      `四个人分成加起来不能超过 100%（陪玩 ${companion}% + 客服 ${cs}% + 店长 ${admin}% = ${used}%）`,
    );
  }
  return { companion, cs, admin, studio: Math.round((100 - used) * 100) / 100 };
}

export interface RoleSplitAmounts {
  percents: RoleSplitResult;
  /** 单位：分 */
  cents: { total: number; companion: number; cs: number; admin: number; studio: number };
  /** 单位：元 */
  yuan: { total: number; companion: number; cs: number; admin: number; studio: number };
}

/**
 * 按金额拆四个人。工作室拿余额，**保证四个人加起来刚好等于这笔钱**（不丢分、不多分）。
 * 比例刚好凑满 100% 时，四舍五入的零头从最大的那一份里扣，避免工作室出现 -0.01。
 */
export function splitAmountYuan(amountYuan: number, input: RoleSplitInput): RoleSplitAmounts {
  const percents = splitRoles(input);
  const total = Math.round(Number(amountYuan || 0) * 100);
  const parts = {
    companion: Math.round((total * percents.companion) / 100),
    cs: Math.round((total * percents.cs) / 100),
    admin: Math.round((total * percents.admin) / 100),
  };
  let studio = total - parts.companion - parts.cs - parts.admin;
  if (studio < 0) {
    // 只有比例凑满 100% 且四舍五入多算了几分时才会走到这里；从最大的一份里抹平。
    const keys: Array<keyof typeof parts> = ['companion', 'cs', 'admin'];
    const biggest = keys.reduce((a, b) => (parts[a] >= parts[b] ? a : b));
    parts[biggest] += studio;
    studio = 0;
  }
  const toYuan = (cents: number) => Math.round(cents) / 100;
  return {
    percents,
    cents: { total, companion: parts.companion, cs: parts.cs, admin: parts.admin, studio },
    yuan: {
      total: toYuan(total),
      companion: toYuan(parts.companion),
      cs: toYuan(parts.cs),
      admin: toYuan(parts.admin),
      studio: toYuan(studio),
    },
  };
}
