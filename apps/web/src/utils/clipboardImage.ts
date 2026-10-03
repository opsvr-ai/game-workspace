import type React from 'react';

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|bmp|webp|heic|heif|tiff?)$/i;

/**
 * 判断一个文件是不是图片。
 * 优先看 MIME；Windows 上微信/桌面截图粘过来经常没有 MIME（file.type === ''），
 * 这时按扩展名兜底，避免图片被静默丢掉。
 */
export function isImageFile(file: File | null | undefined): file is File {
  if (!file) return false;
  if ((file.type || '').startsWith('image/')) return true;
  return IMAGE_EXT_RE.test(file.name || '');
}

/**
 * 从剪贴板事件里取出**所有**图片，支持一次粘贴多张截图。
 */
export function getImagesFromClipboard(e: ClipboardEvent | React.ClipboardEvent): File[] {
  const cd: DataTransfer | null | undefined = (e as any)?.clipboardData;
  if (!cd) return [];

  const out: File[] = [];
  // 注意：不能按 名字|大小|时间 去重 —— 浏览器从剪贴板取出的多张截图经常
  // 同名（clipboard.png）、同大小、同时间戳，去重会把第二张直接丢掉。
  const push = (file: File | null) => {
    if (!isImageFile(file)) return;
    out.push(file);
  };

  Array.from(cd.items || []).forEach((item) => {
    if (item.kind === 'file') push(item.getAsFile());
  });
  // 兜底：个别浏览器 items 拿不到图片，但 files 里有。
  if (!out.length) Array.from(cd.files || []).forEach(push);

  return out;
}

/**
 * 取剪贴板里的第一张图片（兼容旧调用方，例如只收一张的二维码/收款码）。
 */
export function getImageFileFromClipboard(e: React.ClipboardEvent): File | null {
  return getImagesFromClipboard(e)[0] ?? null;
}
