import type React from 'react';

/**
 * 从剪贴板粘贴事件中取出第一张图片，方便陪玩/客服直接把微信、桌面截图
 * Ctrl+V 粘贴到上传区，省去“保存文件 → 选择文件”的步骤。
 */
export function getImageFileFromClipboard(e: React.ClipboardEvent): File | null {
  const items = Array.from(e.clipboardData?.items || []);
  const imageItem = items.find((i) => i.type.startsWith('image/'));
  if (imageItem) return imageItem.getAsFile();

  // Windows 上部分截图工具（微信/桌面截图）粘贴时可能没有标准 image/* 类型，
  // 而是给一个 file item，再由 getAsFile() 返回实际图片文件。
  const fileItem = items.find((i) => i.kind === 'file');
  const file = fileItem?.getAsFile();
  return file?.type.startsWith('image/') ? file : null;
}
