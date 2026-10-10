import React from 'react';
import { BRAND, TEXT } from '../styles/tokens';

/**
 * 统计卡（看板顶部那一排「一个大数字」）。
 *
 * 为什么要有它：设计规范里其实早就有 `.stat-card`（styles/global.css），但看板各写各的 ——
 * 同一套系统里同时存在四种长相：
 *   ① 运营看板：白卡 + 左侧竖条 + 圆点标签 + 彩色大数字；
 *   ② 陪玩端首页：antd Card + 彩色大数字（没竖条、没圆点）；
 *   ③ 客户看板：淡色底 + 同色描边 + 彩色大数字；
 *   ④ 支出审核：antd Card + antd Statistic（系统默认样式，没有常量的颜色）。
 * 老板在北京看板 / 运营看板 / 客户看板之间来回切，同一个「今日消费」一会儿一个长相。
 * 这一层把它收成一个形状：**只允许传颜色、尺寸和内容，不要再自己拼 div**。
 *
 * 用法与实物见 /ui-kit 的「卡片 / 统计卡」。
 */

/** 把 token 的 #RRGGBB 调成带透明度的颜色（令牌都是 6 位十六进制）。 */
function withAlpha(hex: string, ratio: number): string {
  const a = Math.round(Math.max(0, Math.min(1, ratio)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

export interface StatCardProps {
  /** 卡左上角那行小字（如「今日业绩」）。 */
  label: React.ReactNode;
  /** 大数字本身（金额 / 人数 / 时长，自己格式化好再传进来）。 */
  value: React.ReactNode;
  /** 数字下面那行小字（如「本月 ¥1,234」）。 */
  sub?: React.ReactNode;
  /** 主题色：左侧竖条、标签圆点、数字颜色都跟着它。默认品牌紫。 */
  tint?: string;
  /**
   * plain（默认）：白卡 + 左侧竖条，适合「一排同类数字一起看」；
   * tinted：淡色底 + 同色描边，适合「这一排数字要一眼分得开」（客户看板）。
   */
  variant?: 'plain' | 'tinted';
  /** 数字字号：md = 24px（默认），sm = 20px（窄屏 / 一排挤很多个时用）。 */
  size?: 'sm' | 'md';
  /** 右上角小图标（可选）。 */
  icon?: React.ReactNode;
  /** 整卡可点（如点进去看明细）。 */
  onClick?: () => void;
  /** 悬浮提示。 */
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  sub,
  tint = BRAND.primary,
  variant = 'plain',
  size = 'md',
  icon,
  onClick,
  title,
  className,
  style,
}) => {
  const tinted = variant === 'tinted';
  const valueSize = size === 'sm' ? 20 : 24;

  return (
    <div
      data-stat-card=""
      className={['ui-panel', className].filter(Boolean).join(' ')}
      title={title}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      style={{
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        padding: size === 'sm' ? '10px 12px' : '12px 14px',
        borderRadius: 14,
        cursor: onClick ? 'pointer' : undefined,
        // 淡色底那套：底和描边都用同一个主题色的极低透明度，保证「一排看着像一家」
        ...(tinted ? { background: withAlpha(tint, 0.07), border: `1px solid ${withAlpha(tint, 0.18)}` } : null),
        ...style,
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          background: `linear-gradient(180deg, ${tint}, ${withAlpha(tint, 0.4)})`,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: TEXT.secondary }}>
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: 2, background: tint, flex: '0 0 auto' }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {icon ? <span style={{ marginLeft: 'auto', color: tint, display: 'inline-flex', alignItems: 'center' }}>{icon}</span> : null}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: valueSize,
          fontWeight: 700,
          letterSpacing: '-0.5px',
          lineHeight: 1.25,
          color: tint,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {sub ? <div style={{ marginTop: 2, fontSize: 12, color: TEXT.tertiary }}>{sub}</div> : null}
    </div>
  );
};

export default StatCard;