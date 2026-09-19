import type React from 'react';

/**
 * 表格「整行可点」时，判断这次点击要不要忽略。
 *
 * 行本身点一下就能进详情/修改，但行内还有按钮、输入框、下拉、开关、图片预览等
 * 交互元素——点它们不应该顺带把详情弹窗也带出来（否则点「退款」会同时弹出修改窗）。
 */
export function isRowClickIgnored(e: React.MouseEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest(
    [
      'button',
      'a',
      'input',
      'textarea',
      'select',
      '.ant-btn',
      '.ant-select',
      '.ant-switch',
      '.ant-picker',
      '.ant-checkbox-wrapper',
      '.ant-radio-wrapper',
      '.ant-image',
      '.ant-upload',
      '.ant-popover',
      '.ant-dropdown',
      '.ant-pagination',
      '[data-row-click="ignore"]',
    ].join(','),
  );
}
