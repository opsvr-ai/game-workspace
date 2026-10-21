// craftsman-ignore: TS001,TS002
import React from 'react';
import { Button } from 'antd';
import { message } from '../utils/feedback';

/** 兜底复制：Electron 的 http 页面里 navigator.clipboard 不一定可用。 */
export function copyTextToClipboard(text: string): void {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(value).catch(() => fallbackCopy(value));
      return;
    }
  } catch {
    /* fall through */
  }
  fallbackCopy(value);
}

function fallbackCopy(value: string): void {
  try {
    const el = document.createElement('textarea');
    el.value = value;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  } catch {
    /* ignore */
  }
}

interface Props {
  text: string;
  /** 复制按钮文字，默认「复制」 */
  label?: string;
}

/**
 * 显式复制值（不复制旁边的「房间码 / 微信」等标签）。
 * 老板 2026-10-22 再次反馈房间码复制带标签，所以不再依赖 Typography 的 children 推断。
 */
const CopyTextButton: React.FC<Props> = ({ text, label = '复制' }) => (
  <Button
    type="text"
    size="small"
    style={{ paddingInline: 4, height: 20, fontSize: 11, color: '#1677ff' }}
    onClick={(e) => {
      e.stopPropagation();
      copyTextToClipboard(String(text ?? ''));
      message.success('已复制');
    }}
  >
    {label}
  </Button>
);

export default CopyTextButton;
