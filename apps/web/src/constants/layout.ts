import type { CSSProperties } from 'react';

/**
 * 全局布局常量 — 各页面共用同一份数值，避免同类面板在不同页面写死成不同宽度。
 *
 * 之前"人员"这一列在客服派单页写死 240px、在订单池页写死 220px，
 * 客服和店长看同一个列表宽度却不一样，所以统一收敛到这里。
 */

/** 派单页左侧「人员」列宽度（px） */
export const PERSONNEL_COLUMN_WIDTH = 246;

/** 派单页右侧「快捷统计」列宽度（px） */
export const QUICK_STATS_COLUMN_WIDTH = 150;

/** 生成 antd Col 的 flex 写法：宽度固定，不随窗口拉伸 */
export function fixedColumnFlex(width: number): string {
  return `0 0 ${width}px`;
}

/**
 * 固定宽度列的样式。
 *
 * 只写 flex 是不够的：flex 项默认 min-width:auto，列表里的长名字/长工作室名
 * 会把这一列顶得比设定值更宽（实测写 220px 实际渲染 252px，窗口变窄还会变 268px），
 * 于是同一个"人员"列表在不同账号、不同窗口下宽度都不一样。
 * 这里同时锁死 width/minWidth/maxWidth，并让内部内容自己省略号截断。
 */
export function fixedColumnStyle(width: number): CSSProperties {
  return { width, minWidth: 0, maxWidth: width, flex: `0 0 ${width}px` };
}
